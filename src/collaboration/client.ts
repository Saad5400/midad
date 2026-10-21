import { exportDocument } from '../document/codec.js';
import type { NativeDocument } from '../document/model.js';
import type { NativeSelection } from '../editing/selection.js';
import { blockText, textBlocks } from '../editing/text.js';
import { SharedNativeDocument, type SharedCaret } from './document.js';
import { canonicalSharedJson, decodeSharedBytes, encodeSharedBytes } from './values.js';

export interface SyncReply {
    epoch: string;
    number: number;
    state?: string;
    update?: string;
    vector?: string;
    changed: boolean;
    persisted?: boolean;
    writable?: boolean;
    peers?: readonly PresencePeer[];
}
export interface PresencePeer {
    client_id: string;
    user: string;
    name: string;
    color: string;
    writable: boolean;
    anchor: { block: string; position: string } | null;
    focus: { block: string; position: string } | null;
}
export interface NativePeer {
    id: string;
    user: string;
    name: string;
    color: string;
    writable: boolean;
    selection: NativeSelection | null;
}
export interface SyncState {
    status: 'loading' | 'saved' | 'pending' | 'saving' | 'offline' | 'error' | 'conflict' | 'forbidden';
    dirty: boolean;
    version: number;
    canUndo: boolean;
    canRedo: boolean;
    reason?: string;
    peers: readonly NativePeer[];
}
export interface SyncEditor {
    failure?: (error: unknown) => void;
    initial(document: NativeDocument): Promise<NativeDocument | void>;
    prepare(document: NativeDocument): Promise<NativeDocument>;
    preview(document: NativeDocument): Promise<void>;
    lock(): NativeSelection | null | false;
    apply(document: NativeDocument, selection: NativeSelection | null): Promise<void>;
    unlock(): void;
    undoLocal(): Promise<void>;
    selection?: () => NativeSelection | null;
}
export interface SyncTransport {
    read(input: { vector?: string; since_number?: number; epoch?: string }, budget?: number): Promise<SyncReply>;
    write(
        input: {
            epoch: string;
            update: string;
            vector: string;
            base_number: number;
            request_id: string;
            restored_from_number?: number;
        },
        budget?: number,
    ): Promise<SyncReply>;
    presence?: (input: {
        client_id: string;
        anchor: PresencePeer['anchor'];
        focus: PresencePeer['focus'];
    }) => Promise<{ peers: readonly PresencePeer[]; self?: string }>;
    leave?: (clientId: string) => Promise<void>;
}
class SyncTransportFailure extends Error {
    constructor(readonly original: unknown) {
        super('The collaboration request failed');
    }
}

class SyncDeadline extends Error {}

export class NativeSyncClient {
    private shared?: SharedNativeDocument;
    private shadow?: SharedNativeDocument;
    private pending?: NativeDocument;
    private restoredFrom?: number;
    private active?: Promise<boolean>;
    private delay?: ReturnType<typeof setTimeout>;
    private poll?: ReturnType<typeof setTimeout>;
    private closed = false;
    private sequence = 0;
    private acknowledged = 0;
    private base = 0;
    private number = 0;
    private acknowledgedVector: Uint8Array = new Uint8Array();
    private status: SyncState['status'] = 'loading';
    private reason?: string;
    private invalidLocal = false;
    private readonly clientId = crypto.randomUUID();
    private peerCache: readonly PresencePeer[] = [];
    private ownUser?: string;
    private presenceTimer?: ReturnType<typeof setTimeout>;
    private lastPresence = '';
    private lastPresenceAt = 0;
    private outbound?: { input: Parameters<SyncTransport['write']>[0]; sent: number };
    private inbound?: { reply: SyncReply; sent: number; dirty: boolean };

    constructor(
        private readonly id: string,
        private readonly writable: boolean,
        private readonly transport: SyncTransport,
        private readonly editor: SyncEditor,
        private readonly changed: (state: SyncState) => void,
        private readonly interval = 800,
    ) {}

    state(): SyncState {
        return {
            status: this.status,
            dirty: !!this.pending || this.sequence !== this.acknowledged,
            version: this.number,
            canUndo: this.writable && (!!this.pending || !!this.shared?.canUndo),
            canRedo: this.writable && !!this.shared?.canRedo,
            reason: this.reason,
            peers: this.peerCache
                .filter((peer) => peer.client_id !== this.clientId || (!!this.ownUser && peer.user !== this.ownUser))
                .map((peer) => {
                    let selection: NativeSelection | null = null;
                    try {
                        const anchor =
                            peer.anchor &&
                            this.shared?.resolve({
                                block: peer.anchor.block,
                                position: decodeSharedBytes(peer.anchor.position, 6144),
                            });
                        const focus =
                            peer.focus &&
                            this.shared?.resolve({
                                block: peer.focus.block,
                                position: decodeSharedBytes(peer.focus.position, 6144),
                            });
                        if (anchor && focus) selection = { anchor, focus };
                    } catch {
                        selection = null;
                    }
                    return {
                        id: `${peer.user}:${peer.client_id}`,
                        user: peer.user,
                        name: peer.name,
                        color: /^#[a-f0-9]{6}$/i.test(peer.color) ? peer.color : '#7c3aed',
                        writable: peer.writable,
                        selection,
                    };
                }),
        };
    }
    async start(): Promise<void> {
        this.status = 'loading';
        this.publish();
        clearTimeout(this.poll);
        const reply = await this.transport.read({});
        if (this.closed) return;
        if (!reply.state || !reply.vector) throw new Error('The collaboration snapshot is incomplete');
        this.shared?.destroy();
        this.shadow?.destroy();
        this.shared = SharedNativeDocument.fromState(decodeSharedBytes(reply.state), this.id);
        this.shadow = SharedNativeDocument.fromState(decodeSharedBytes(reply.state), this.id);
        if (this.shared.epoch() !== reply.epoch) throw new Error('The collaboration snapshot identity differs');
        this.number = reply.number;
        this.base = reply.number;
        this.acknowledgedVector = decodeSharedBytes(reply.vector);
        this.peerCache = reply.peers ?? [];
        const received = this.shared.document();
        const initial = await this.editor.initial(received);
        if (reply.writable !== undefined && reply.writable !== this.writable) {
            this.status = 'forbidden';
            this.reason = 'access_changed';
            this.publish();
            return;
        }
        if (
            this.writable &&
            initial &&
            canonicalSharedJson(exportDocument(initial)) !== canonicalSharedJson(exportDocument(received))
        ) {
            const prepared = await this.editor.prepare(initial);
            if (this.closed) return;
            this.shadow.receive(this.shared.publish(prepared, false));
            this.sequence++;
        }
        this.status = this.state().dirty ? 'pending' : 'saved';
        if (this.writable && reply.persisted === false) {
            this.sequence++;
            this.status = 'pending';
        }
        this.publish();
        this.schedule();
        if (this.writable && this.state().dirty) {
            clearTimeout(this.delay);
            this.delay = setTimeout(() => void this.flush(), 0);
        }
        void this.presence();
    }
    queue(document: NativeDocument, restoredFrom?: number): void {
        if (this.closed || !this.writable || this.status === 'conflict' || this.status === 'forbidden') return;
        if (!this.state().dirty) this.base = this.number;
        this.pending = document;
        this.restoredFrom = restoredFrom ?? this.restoredFrom;
        if (!this.active) this.status = 'pending';
        this.publish();
        clearTimeout(this.delay);
        this.delay = setTimeout(() => void this.flush(), 350);
    }
    flush(): Promise<boolean> {
        clearTimeout(this.delay);
        clearTimeout(this.poll);
        if (this.closed || !this.shared || this.status === 'conflict' || this.status === 'forbidden')
            return Promise.resolve(false);
        if (this.active) return this.active;
        this.active = this.synchronize().finally(() => {
            this.active = undefined;
            this.schedule();
        });
        return this.active;
    }
    async undo(): Promise<void> {
        if (!this.writable || !this.shared || this.status === 'conflict' || this.status === 'forbidden') return;
        if (this.pending && this.invalidLocal) {
            await this.editor.undoLocal();
            return;
        }
        if (!(await this.local(Date.now() + 5000))) {
            if (this.invalidLocal) await this.editor.undoLocal();
            return;
        }
        await this.history('undo');
    }
    async redo(): Promise<void> {
        if (
            !this.writable ||
            !this.shared ||
            this.status === 'conflict' ||
            this.status === 'forbidden' ||
            !(await this.local(Date.now() + 5000))
        )
            return;
        await this.history('redo');
    }
    private async history(direction: 'undo' | 'redo'): Promise<void> {
        const locked = this.editor.lock();
        if (locked === false || !this.shared) return;
        const anchors = this.capture(locked);
        try {
            if (!this.state().dirty) this.base = this.number;
            const document = this.shared[direction]();
            this.shadow!.receive(this.shared.state(this.shadow!.vector()));
            this.sequence++;
            await this.editor.apply(document, this.resolve(anchors));
            this.status = 'pending';
            this.publish();
        } finally {
            this.editor.unlock();
        }
        void this.flush();
    }
    private capture(selection: NativeSelection | null): {
        anchor: SharedCaret | null;
        focus: SharedCaret | null;
        scopeId?: string;
        cells?: NativeSelection['cells'];
    } | null {
        if (!selection || !this.shared) return null;
        const blocks = textBlocks(this.shared.document().root).map((block) => block.id);
        const collapsed =
            selection.anchor.blockId === selection.focus.blockId && selection.anchor.offset === selection.focus.offset;
        const forward =
            selection.anchor.blockId === selection.focus.blockId
                ? selection.anchor.offset < selection.focus.offset
                : blocks.indexOf(selection.anchor.blockId) < blocks.indexOf(selection.focus.blockId);
        return {
            anchor: this.shared.caret(selection.anchor, collapsed || !forward ? -1 : 0),
            focus: this.shared.caret(selection.focus, collapsed || forward ? -1 : 0),
            scopeId: selection.scopeId,
            cells: selection.cells,
        };
    }
    private resolve(selection: ReturnType<NativeSyncClient['capture']>): NativeSelection | null {
        const anchor = selection?.anchor && this.shared?.resolve(selection.anchor),
            focus = selection?.focus && this.shared?.resolve(selection.focus);
        return anchor && focus ? { anchor, focus, scopeId: selection?.scopeId, cells: selection?.cells } : null;
    }
    private async timebox<T>(job: Promise<T>, deadline: number): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                job,
                new Promise<T>((_, reject) => {
                    timer = setTimeout(() => reject(new SyncDeadline()), Math.max(0, deadline - Date.now()));
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    }
    private async local(deadline: number): Promise<boolean> {
        while (this.pending && !this.closed) {
            const document = this.pending;
            let prepared: NativeDocument;
            try {
                prepared = await this.timebox(this.editor.prepare(document), deadline);
            } catch (error) {
                if (error instanceof SyncDeadline) {
                    this.status = 'pending';
                    this.publish();
                    return false;
                }
                this.invalidLocal = true;
                this.status = 'error';
                this.reason = 'invalid_content';
                this.publish();
                return false;
            }
            if (this.pending !== document) continue;
            try {
                this.shadow!.receive(this.shared!.publish(prepared));
            } catch {
                this.status = 'conflict';
                this.reason = 'invalid_merge';
                this.publish();
                return false;
            }
            this.pending = undefined;
            this.invalidLocal = false;
            this.sequence++;
        }
        return !this.closed;
    }
    private async adopt(reply: SyncReply, deadline: number): Promise<boolean> {
        const fresh =
            reply.state && reply.vector
                ? reply
                : await this.timebox(
                      this.transfer(() => this.transport.read({}, deadline - Date.now())),
                      deadline,
                  );
        if (!fresh.state || !fresh.vector || fresh.epoch !== reply.epoch)
            throw new Error('The replacement snapshot is incomplete');
        if (fresh.writable !== undefined && fresh.writable !== this.writable) {
            this.status = 'forbidden';
            this.reason = 'access_changed';
            this.publish();
            return false;
        }
        let candidate: SharedNativeDocument | undefined = SharedNativeDocument.fromState(
            decodeSharedBytes(fresh.state),
            this.id,
        );
        try {
            if (candidate.epoch() !== fresh.epoch) throw new Error('The replacement identity differs');
            await this.timebox(this.editor.preview(candidate.document()), deadline);
            let selected = this.editor.lock();
            for (
                let attempt = 0;
                selected === false && attempt < 40 && !this.closed && Date.now() < deadline;
                attempt++
            ) {
                await new Promise((resolve) => setTimeout(resolve, 25));
                if (this.state().dirty) break;
                selected = this.editor.lock();
            }
            if (this.closed) {
                if (selected !== false) this.editor.unlock();
                return false;
            }
            if (selected === false) {
                if (this.state().dirty) {
                    this.status = 'conflict';
                    this.reason = 'content_changed';
                    this.publish();
                }
                return false;
            }
            try {
                if (this.state().dirty) {
                    this.status = 'conflict';
                    this.reason = 'content_changed';
                    this.publish();
                    return false;
                }
                const blocks = new Map(textBlocks(candidate.document().root).map((block) => [block.id, block]));
                const clamp = (point: NativeSelection['anchor']) => {
                    const block = blocks.get(point.blockId);
                    if (!block) return null;
                    const text = blockText(block),
                        offset = Math.min(point.offset, text.length);
                    const boundaries = [
                        0,
                        ...Array.from(
                            new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text),
                            (part) => part.index,
                        ),
                        text.length,
                    ];
                    return {
                        blockId: point.blockId,
                        offset: boundaries.findLast((boundary) => boundary <= offset) ?? 0,
                    };
                };
                const anchor = selected && clamp(selected.anchor),
                    focus = selected && clamp(selected.focus);
                await this.editor.apply(candidate.document(), anchor && focus ? { anchor, focus } : null);
                this.shared!.destroy();
                this.shadow!.destroy();
                this.shared = candidate;
                candidate = undefined;
                this.shadow = SharedNativeDocument.fromState(this.shared.state(), this.id);
                this.number = fresh.number;
                this.base = fresh.number;
                this.acknowledgedVector = decodeSharedBytes(fresh.vector);
                this.sequence = this.writable && fresh.persisted === false ? 1 : 0;
                this.acknowledged = 0;
                this.outbound = undefined;
                this.inbound = undefined;
                this.peerCache = fresh.peers ?? reply.peers ?? [];
                this.lastPresence = '';
                this.lastPresenceAt = 0;
                this.status = this.state().dirty ? 'pending' : 'saved';
                this.reason = undefined;
                this.publish();
                return true;
            } finally {
                this.editor.unlock();
            }
        } finally {
            candidate?.destroy();
        }
    }
    private async synchronize(): Promise<boolean> {
        const deadline = Date.now() + 5000;
        try {
            if (!(await this.local(deadline)) || !this.shared) return false;
            let iterations = 0;
            do {
                if (Date.now() >= deadline) throw new SyncDeadline();
                let sent = this.sequence;
                const dirty = this.inbound?.dirty ?? (this.sequence !== this.acknowledged || !!this.outbound);
                this.status = dirty ? 'saving' : 'saved';
                this.publish();
                if (dirty && !this.outbound && !this.inbound)
                    this.outbound = {
                        sent,
                        input: {
                            epoch: this.shared!.epoch(),
                            update: encodeSharedBytes(this.shared.state(this.acknowledgedVector)),
                            vector: encodeSharedBytes(this.shared!.vector()),
                            base_number: this.base,
                            request_id: crypto.randomUUID(),
                            ...(this.restoredFrom ? { restored_from_number: this.restoredFrom } : {}),
                        },
                    };
                const reply =
                    this.inbound?.reply ??
                    (this.outbound
                        ? await this.timebox(
                              this.transfer(() => this.transport.write(this.outbound!.input, deadline - Date.now())),
                              deadline,
                          )
                        : await this.timebox(
                              this.transfer(() =>
                                  this.transport.read(
                                      {
                                          vector: encodeSharedBytes(this.shared!.vector()),
                                          since_number: this.number,
                                          epoch: this.shared!.epoch(),
                                      },
                                      deadline - Date.now(),
                                  ),
                              ),
                              deadline,
                          ));
                sent = this.inbound?.sent ?? this.outbound?.sent ?? sent;
                this.inbound = { reply, sent, dirty };
                this.peerCache = reply.peers ?? this.peerCache;
                this.outbound = undefined;
                if (this.closed) return false;
                if (reply.writable !== undefined && reply.writable !== this.writable) {
                    this.status = 'forbidden';
                    this.reason = 'access_changed';
                    this.publish();
                    return false;
                }
                if (reply.epoch !== this.shared.epoch()) {
                    if (!dirty && !this.state().dirty) {
                        const adopted = await this.adopt(reply, deadline);
                        if (!adopted && !['conflict', 'forbidden'].includes(this.status)) {
                            this.status = 'pending';
                            this.publish();
                        }
                        return adopted && !this.state().dirty;
                    }
                    this.status = 'conflict';
                    this.reason = 'content_changed';
                    this.publish();
                    return false;
                }
                if (reply.update) this.shadow!.receive(decodeSharedBytes(reply.update));
                if (!(await this.local(deadline))) return false;
                await this.timebox(this.editor.preview(this.shadow!.document()), deadline);
                while (this.pending) {
                    if (!(await this.local(deadline))) return false;
                    await this.timebox(this.editor.preview(this.shadow!.document()), deadline);
                }
                let selection: NativeSelection | null | false = this.editor.lock();
                if (selection === false) {
                    for (
                        let attempt = 0;
                        attempt < 40 && selection === false && !this.closed && Date.now() < deadline;
                        attempt++
                    ) {
                        await new Promise((resolve) => setTimeout(resolve, 25));
                        if (!(await this.local(deadline))) return false;
                        selection = this.editor.lock();
                    }
                }
                if (selection === false || this.closed) {
                    this.status = 'pending';
                    this.publish();
                    return false;
                }
                const anchors = this.capture(selection);
                try {
                    const before = this.shared.document();
                    if (reply.update) this.shared.receive(decodeSharedBytes(reply.update));
                    const ownAcknowledgement = this.shared.document() === before;
                    this.number = reply.number;
                    if (reply.vector) this.acknowledgedVector = decodeSharedBytes(reply.vector);
                    if (dirty) {
                        this.acknowledged = sent;
                        this.restoredFrom = undefined;
                    }
                    if (dirty || this.shared.document() !== before)
                        await this.editor.apply(this.shadow!.document(), this.resolve(anchors));
                    if (ownAcknowledgement || (this.acknowledged === this.sequence && !this.pending))
                        this.base = this.number;
                    this.inbound = undefined;
                } finally {
                    this.editor.unlock();
                }
                iterations++;
            } while (!this.closed && (this.pending || this.sequence !== this.acknowledged) && iterations < 4);
            this.status = this.state().dirty ? 'pending' : 'saved';
            this.reason = undefined;
            this.publish();
            return !this.state().dirty;
        } catch (error) {
            if (error instanceof SyncDeadline) {
                this.status = 'pending';
                this.publish();
                return false;
            }
            const original = error instanceof SyncTransportFailure ? error.original : error;
            if (!(error instanceof SyncTransportFailure)) this.editor.failure?.(original);
            const response = (original as { response?: { status?: number; data?: { reason?: string } } }).response;
            this.status =
                response?.status === 409
                    ? 'conflict'
                    : response?.status === 403 || response?.status === 401
                      ? 'forbidden'
                      : response?.status === 422
                        ? 'error'
                        : error instanceof SyncTransportFailure && !response
                          ? 'offline'
                          : 'error';
            if (response?.status === 422) this.outbound = undefined;
            this.reason =
                response?.data?.reason ?? (error instanceof SyncTransportFailure ? undefined : 'invalid_shared_state');
            this.publish();
            return false;
        }
    }
    private async transfer<T>(request: () => Promise<T>): Promise<T> {
        try {
            return await request();
        } catch (error) {
            throw new SyncTransportFailure(error);
        }
    }
    private publish(): void {
        if (!this.closed) this.changed(this.state());
    }
    private async presence(): Promise<void> {
        if (this.closed || !this.transport.presence || this.status === 'forbidden') return;
        try {
            const selected = this.state().dirty ? null : (this.editor.selection?.() ?? null);
            const signature = JSON.stringify(selected);
            if (signature !== this.lastPresence || Date.now() - this.lastPresenceAt > 5000) {
                const anchors = this.capture(selected);
                const encode = (caret: SharedCaret | null | undefined) =>
                    caret ? { block: caret.block, position: encodeSharedBytes(caret.position) } : null;
                const reply = await this.transport.presence({
                    client_id: this.clientId,
                    anchor: encode(anchors?.anchor),
                    focus: encode(anchors?.focus),
                });
                if (this.closed) return;
                this.peerCache = reply.peers;
                this.ownUser = reply.self ?? this.ownUser;
                const own = reply.peers.find((peer) => peer.client_id === this.clientId && peer.user === this.ownUser);
                if (own && own.writable !== this.writable) {
                    this.status = 'forbidden';
                    this.reason = 'access_changed';
                }
                this.lastPresence = signature;
                this.lastPresenceAt = Date.now();
                this.publish();
            }
        } catch {
            this.lastPresenceAt = 0;
        } finally {
            if (!this.closed) this.presenceTimer = setTimeout(() => void this.presence(), 250);
        }
    }
    private schedule(): void {
        clearTimeout(this.poll);
        if (this.closed || this.status === 'conflict' || this.status === 'forbidden') return;
        this.poll = setTimeout(() => void this.flush(), this.status === 'offline' ? 2000 : this.interval);
    }
    destroy(): void {
        this.closed = true;
        clearTimeout(this.delay);
        clearTimeout(this.poll);
        this.shared?.destroy();
        this.shadow?.destroy();
        clearTimeout(this.presenceTimer);
        if (this.transport.leave) void this.transport.leave(this.clientId).catch(() => undefined);
    }
}
