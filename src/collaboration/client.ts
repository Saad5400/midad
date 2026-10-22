import { exportDocument } from '../document/codec.js';
import type { NativeDocument } from '../document/model.js';
import type { NativeSelection } from '../editing/selection.js';
import { SharedNativeDocument } from './document.js';
import { canonicalSharedJson, decodeSharedBytes, encodeSharedBytes } from './values.js';
import type { SyncReply, SyncState, SyncEditor, SyncTransport } from './sync/contracts.js';
import { SyncPresence } from './sync/presence.js';
import { SyncDeadline, SyncTransportFailure, withinDeadline, transfer } from './sync/requests.js';
import { captureSelection, resolveSelection, clampSelection } from './sync/selection.js';

export type { SyncReply, PresencePeer, NativePeer, SyncState, SyncEditor, SyncTransport } from './sync/contracts.js';

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
    private readonly presence: SyncPresence;
    private outbound?: { input: Parameters<SyncTransport['write']>[0]; sent: number };
    private inbound?: { reply: SyncReply; sent: number; dirty: boolean };

    constructor(
        private readonly id: string,
        private readonly writable: boolean,
        private readonly transport: SyncTransport,
        private readonly editor: SyncEditor,
        private readonly changed: (state: SyncState) => void,
        private readonly interval = 800,
    ) {
        this.presence = new SyncPresence(transport, writable, {
            shared: () => this.shared,
            selection: () => (this.state().dirty ? null : (editor.selection?.() ?? null)),
            allowed: () => this.status !== 'forbidden',
            changed: () => this.publish(),
            accessChanged: () => {
                this.status = 'forbidden';
                this.reason = 'access_changed';
            },
        });
    }

    state(): SyncState {
        return {
            status: this.status,
            dirty: !!this.pending || this.sequence !== this.acknowledged,
            version: this.number,
            canUndo: this.writable && (!!this.pending || !!this.shared?.canUndo),
            canRedo: this.writable && !!this.shared?.canRedo,
            reason: this.reason,
            peers: this.presence.peers(this.shared),
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
        this.presence.replace(reply.peers ?? []);
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
        this.presence.start();
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
        const anchors = captureSelection(this.shared, locked);
        try {
            if (!this.state().dirty) this.base = this.number;
            const document = this.shared[direction]();
            this.shadow!.receive(this.shared.state(this.shadow!.vector()));
            this.sequence++;
            await this.editor.apply(document, resolveSelection(this.shared, anchors));
            this.status = 'pending';
            this.publish();
        } finally {
            this.editor.unlock();
        }
        void this.flush();
    }
    private async local(deadline: number): Promise<boolean> {
        while (this.pending && !this.closed) {
            const document = this.pending;
            let prepared: NativeDocument;
            try {
                prepared = await withinDeadline(this.editor.prepare(document), deadline);
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
                : await withinDeadline(
                      transfer(() => this.transport.read({}, deadline - Date.now())),
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
            await withinDeadline(this.editor.preview(candidate.document()), deadline);
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
                await this.editor.apply(candidate.document(), clampSelection(candidate.document(), selected));
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
                this.presence.replace(fresh.peers ?? reply.peers ?? []);
                this.presence.reset();
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
                        ? await withinDeadline(
                              transfer(() => this.transport.write(this.outbound!.input, deadline - Date.now())),
                              deadline,
                          )
                        : await withinDeadline(
                              transfer(() =>
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
                this.presence.replace(reply.peers);
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
                await withinDeadline(this.editor.preview(this.shadow!.document()), deadline);
                while (this.pending) {
                    if (!(await this.local(deadline))) return false;
                    await withinDeadline(this.editor.preview(this.shadow!.document()), deadline);
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
                const anchors = captureSelection(this.shared, selection);
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
                        await this.editor.apply(this.shadow!.document(), resolveSelection(this.shared, anchors));
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
    private publish(): void {
        if (!this.closed) this.changed(this.state());
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
        this.presence.destroy();
    }
}
