import type { NativeDocument } from './document.js';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';
export interface SaveResult {
    readonly version: number;
}
export interface SaveSnapshot {
    readonly status: SaveStatus;
    readonly version: number;
    readonly dirty: boolean;
}
export class VersionedDocumentSave {
    private pending?: NativeDocument;
    private active?: Promise<boolean>;
    private delay?: ReturnType<typeof setTimeout>;
    private deadline?: ReturnType<typeof setTimeout>;
    private disposed = false;
    private conflict = false;
    private status: SaveStatus = 'saved';
    private latestRevision: number;
    private savedRevision: number;

    constructor(
        private version: number,
        initialRevision: number,
        private readonly write: (document: NativeDocument, baseVersion: number) => Promise<SaveResult>,
        private readonly changed: (snapshot: SaveSnapshot) => void,
        private readonly debounceMs = 1200,
        private readonly maxDelayMs = 5000,
    ) {
        if (!Number.isSafeInteger(version) || version <= 0) throw new Error('A content version is required');
        this.latestRevision = initialRevision;
        this.savedRevision = initialRevision;
    }

    snapshot(): SaveSnapshot {
        return { status: this.status, version: this.version, dirty: this.latestRevision !== this.savedRevision };
    }

    queue(document: NativeDocument): void {
        if (this.disposed) return;
        if (document.revision <= this.latestRevision) return;
        this.pending = document;
        this.latestRevision = document.revision;
        if (!this.active && !this.conflict) this.status = 'pending';
        this.publish();
        if (this.conflict) return;
        clearTimeout(this.delay);
        this.delay = setTimeout(() => void this.flush(), this.debounceMs);
        this.deadline ??= setTimeout(() => void this.flush(), this.maxDelayMs);
    }

    flush(): Promise<boolean> {
        this.cancelTimers();
        if (this.disposed || this.conflict) return Promise.resolve(false);
        if (this.active) return this.active;
        this.active = this.drain().finally(() => {
            this.active = undefined;
        });
        return this.active;
    }

    private async drain(): Promise<boolean> {
        while (this.pending && !this.disposed) {
            const document = this.pending;
            this.pending = undefined;
            this.status = 'saving';
            this.publish();
            try {
                const result = await this.write(document, this.version);
                if (!Number.isSafeInteger(result.version) || result.version <= 0)
                    throw new Error('The server did not return a content version');
                this.version = result.version;
                this.savedRevision = document.revision;
            } catch (error) {
                this.pending ??= document;
                this.conflict = (error as { response?: { status?: number } })?.response?.status === 409;
                this.status = this.conflict ? 'conflict' : 'error';
                this.cancelTimers();
                this.publish();
                return false;
            }
        }
        this.cancelTimers();
        this.status = 'saved';
        this.publish();
        return true;
    }

    private publish(): void {
        if (!this.disposed) this.changed(this.snapshot());
    }

    private cancelTimers(): void {
        clearTimeout(this.delay);
        clearTimeout(this.deadline);
        this.delay = undefined;
        this.deadline = undefined;
    }

    dispose(): void {
        this.disposed = true;
        this.cancelTimers();
    }
}
