import type { NativeSelection } from '../../editing/selection.js';
import type { SharedNativeDocument, SharedCaret } from '../document.js';
import { decodeSharedBytes, encodeSharedBytes } from '../values.js';
import type { NativePeer, PresencePeer, SyncTransport } from './contracts.js';
import { captureSelection } from './selection.js';

interface PresenceOptions {
    shared(): SharedNativeDocument | undefined;
    selection(): NativeSelection | null;
    allowed(): boolean;
    changed(): void;
    accessChanged(): void;
}

export class SyncPresence {
    private readonly clientId = crypto.randomUUID();
    private peerCache: readonly PresencePeer[] = [];
    private ownUser?: string;
    private timer?: ReturnType<typeof setTimeout>;
    private lastPresence = '';
    private lastPresenceAt = 0;
    private closed = false;

    constructor(
        private readonly transport: SyncTransport,
        private readonly writable: boolean,
        private readonly options: PresenceOptions,
    ) {}

    replace(peers?: readonly PresencePeer[]): void {
        if (peers) this.peerCache = peers;
    }

    reset(): void {
        this.lastPresence = '';
        this.lastPresenceAt = 0;
    }

    peers(shared: SharedNativeDocument | undefined): readonly NativePeer[] {
        return this.peerCache
            .filter((peer) => peer.client_id !== this.clientId || (!!this.ownUser && peer.user !== this.ownUser))
            .map((peer) => {
                let selection: NativeSelection | null = null;
                try {
                    const anchor =
                        peer.anchor &&
                        shared?.resolve({
                            block: peer.anchor.block,
                            position: decodeSharedBytes(peer.anchor.position, 6144),
                        });
                    const focus =
                        peer.focus &&
                        shared?.resolve({
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
            });
    }

    start(): void {
        void this.pulse();
    }
    private async pulse(): Promise<void> {
        if (this.closed || !this.transport.presence || !this.options.allowed()) return;
        try {
            const selected = this.options.selection();
            const signature = JSON.stringify(selected);
            if (signature !== this.lastPresence || Date.now() - this.lastPresenceAt > 5000) {
                const anchors = captureSelection(this.options.shared(), selected);
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
                    this.options.accessChanged();
                }
                this.lastPresence = signature;
                this.lastPresenceAt = Date.now();
                this.options.changed();
            }
        } catch {
            this.lastPresenceAt = 0;
        } finally {
            if (!this.closed) this.timer = setTimeout(() => void this.pulse(), 250);
        }
    }

    destroy(): void {
        this.closed = true;
        clearTimeout(this.timer);
        if (this.transport.leave) void this.transport.leave(this.clientId).catch(() => undefined);
    }
}
