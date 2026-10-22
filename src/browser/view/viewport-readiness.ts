import type { PageViewState } from './page-view.js';

export class ViewportReadiness {
    readonly ready: Promise<void>;
    private readonly pages = new Map<number, PageViewState>();
    private resolve!: () => void;
    private reject!: (error: unknown) => void;
    private frame?: number;
    private settled = false;

    constructor(
        private readonly options: {
            revision: () => number | undefined;
            canCommit?: () => boolean;
            committed: (page: number) => void;
        },
    ) {
        this.ready = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
        void this.ready.catch(() => undefined);
    }

    update(page: number, state: PageViewState): void {
        if (this.settled) return;
        this.pages.set(page, state);
        if (this.frame !== undefined || this.paintedViewport() === undefined) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = undefined;
            const page = this.paintedViewport();
            if (this.settled || page === undefined || this.options.canCommit?.() === false) return;
            this.settled = true;
            this.pages.clear();
            try {
                this.options.committed(page);
                this.resolve();
            } catch (error) {
                this.reject(error);
            }
        });
    }

    fail(error: unknown): void {
        if (this.settled) return;
        this.settled = true;
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        this.frame = undefined;
        this.pages.clear();
        this.reject(error);
    }

    dispose(): void {
        this.fail(new Error('The editor closed before its viewport was painted'));
    }

    private paintedViewport(): number | undefined {
        const revision = this.options.revision();
        if (revision === undefined) return;
        const candidates = [...this.pages.entries()]
            .filter(([, state]) => state.near && state.visible && !state.failed && state.paintedRevision === revision)
            .map(([page]) => page);
        return candidates.length ? Math.min(...candidates) : undefined;
    }
}
