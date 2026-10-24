import type { NativeDocument } from '../../document/model.js';
import type { NativeSelection } from '../../editing/selection.js';

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
    lock(purpose?: 'history'): NativeSelection | null | false;
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
