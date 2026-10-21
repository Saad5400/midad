import { PageCanvasController, type PageCanvasTarget } from './page-canvas.js';

export type PageViewFrame = Omit<PageCanvasTarget, 'canvas'> & { readonly label?: string };
export interface PageViewState {
    readonly near: boolean;
    readonly visible: boolean;
    readonly failed: boolean;
    readonly paintedRevision?: number;
}
export interface PageViewEvents {
    readonly state: (state: PageViewState) => void;
    readonly painted: () => void;
    readonly error: (error: unknown) => void;
}

export class PageView {
    private readonly painter = new PageCanvasController();
    private readonly nearObserver: IntersectionObserver;
    private readonly viewportObserver: IntersectionObserver;
    private canvas?: HTMLCanvasElement;
    private near = false;
    private visible = false;
    private failed = false;
    private queued = false;
    private disposed = false;
    private frame: PageViewFrame;
    private readonly resize = () => this.queue();

    constructor(
        private readonly host: HTMLElement,
        frame: PageViewFrame,
        private readonly events: PageViewEvents,
    ) {
        this.frame = frame;
        this.size();
        this.nearObserver = new IntersectionObserver(
            ([entry]) => {
                if (this.disposed) return;
                this.near = entry.isIntersecting;
                this.queue();
            },
            { rootMargin: '700px' },
        );
        this.viewportObserver = new IntersectionObserver(
            ([entry]) => {
                if (this.disposed) return;
                this.visible = entry.isIntersecting && entry.intersectionRatio > 0;
                this.notify();
            },
            { threshold: [0, Number.EPSILON] },
        );
        host.ownerDocument.defaultView?.addEventListener('resize', this.resize);
        this.nearObserver.observe(host);
        this.viewportObserver.observe(host);
    }

    update(frame: PageViewFrame): void {
        if (this.disposed) return;
        this.frame = frame;
        this.size();
        this.queue();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.nearObserver.disconnect();
        this.viewportObserver.disconnect();
        this.host.ownerDocument.defaultView?.removeEventListener('resize', this.resize);
        this.painter.dispose();
        this.canvas?.remove();
        this.canvas = undefined;
    }

    private size(): void {
        this.host.style.width = `${this.frame.page.width * this.frame.scale}px`;
        this.host.style.height = `${this.frame.page.height * this.frame.scale}px`;
    }

    private notify(paintedRevision = this.painter.paintedRevision): void {
        this.events.state(
            Object.freeze({ near: this.near, visible: this.visible, failed: this.failed, paintedRevision }),
        );
    }

    private queue(): void {
        if (this.disposed) return;
        if (this.canvas) {
            this.canvas.style.opacity = '0';
            this.canvas.removeAttribute('data-painted-revision');
        }
        this.painter.invalidate();
        this.notify();
        if (this.queued) return;
        this.queued = true;
        queueMicrotask(() => {
            this.queued = false;
            if (!this.disposed) this.paint();
        });
    }

    private paint(): void {
        if (!this.near) {
            this.painter.dispose();
            this.canvas?.remove();
            this.canvas = undefined;
            this.notify();
            return;
        }
        try {
            if (!this.canvas) {
                this.canvas = this.host.ownerDocument.createElement('canvas');
                this.canvas.style.width = '100%';
                this.canvas.style.height = '100%';
                this.host.append(this.canvas);
            }
            this.canvas.setAttribute('data-revision', String(this.frame.revision));
            if (this.frame.label) this.canvas.setAttribute('aria-label', this.frame.label);
            else this.canvas.removeAttribute('aria-label');
            this.painter.paint({ ...this.frame, canvas: this.canvas });
            this.failed = false;
            this.canvas.setAttribute('data-painted-revision', String(this.frame.revision));
            this.canvas.style.opacity = '1';
        } catch (error) {
            this.failed = true;
            if (this.canvas) this.canvas.style.opacity = '0';
            this.notify();
            this.events.error(error);
            return;
        }
        this.notify();
        this.events.painted();
    }
}
