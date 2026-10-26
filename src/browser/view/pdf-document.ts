import { POINT_TO_PIXEL, VIEW_ZOOM_MAX, viewZoom } from './viewport.js';

export interface PdfDocumentPage {
    readonly number: number;
    readonly width: number;
    readonly height: number;
}
export interface PdfDocumentSource {
    readonly pages: readonly PdfDocumentPage[];
    bytes(): Uint8Array;
    plainText(): Promise<string>;
    destroy(): void | Promise<void>;
}
export interface PdfDocumentState<T extends PdfDocumentSource> {
    readonly generation: number;
    readonly status: 'loading' | 'ready' | 'error';
    readonly source: T | undefined;
    readonly pages: readonly PdfDocumentPage[];
    readonly current: number;
    readonly mode: string;
    readonly zoom: number;
    readonly maxPage: Readonly<{ width: number; height: number }>;
    readonly pageTops: readonly number[];
    readonly allSelected: boolean;
    readonly copyFailed: boolean;
    readonly failure?: 'document' | 'timeout' | 'page';
}
export interface PdfDocumentOptions<T extends PdfDocumentSource> {
    load(signal: AbortSignal): Promise<Uint8Array>;
    open(bytes: Uint8Array, signal: AbortSignal): Promise<T>;
    viewport?: () => HTMLElement | undefined | null;
    pagesElement?: () => HTMLElement | undefined | null;
    afterLayout?: () => void | Promise<unknown>;
    changed?(state: PdfDocumentState<T>): void;
    ready?(report: { milliseconds: number; pages: number }): void;
    error?(error: unknown, area: 'document' | 'page' | 'copy'): void;
    clipboard?: (text: string) => Promise<void>;
    padding?: number;
    maxBytes?: number;
}
interface ViewAnchor {
    index: number;
    fraction: number;
    gap: number;
    align: 'top' | 'center';
}
function pageAt(tops: readonly number[], position: number): number {
    let start = 0,
        end = tops.length - 1;
    while (start < end) {
        const middle = Math.ceil((start + end) / 2);
        if (tops[middle] <= position + 1) start = middle;
        else end = middle - 1;
    }
    return start;
}
export class PdfDocumentController<T extends PdfDocumentSource> {
    private source: T | undefined;
    private pages: readonly PdfDocumentPage[] = [];
    private tops: readonly number[] = [];
    private zoom = 1;
    private maxPage: Readonly<{ width: number; height: number }> = Object.freeze({ width: 595.28, height: 841.89 });
    private mode = 'auto';
    private current = 1;
    private size = { width: 800, height: 900 };
    private status: PdfDocumentState<T>['status'] = 'loading';
    private failure: PdfDocumentState<T>['failure'];
    private generation = 0;
    private disposed = false;
    private abort: AbortController | undefined;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private settle: ((ready: boolean) => void) | undefined;
    private opening: Promise<boolean> | undefined;
    private started = 0;
    private paintedPages = new Set<number>();
    private failures = new Map<number, unknown>();
    private awaiting = new Set<number>();
    private layoutGeneration = 0;
    private anchor: ViewAnchor | undefined;
    private selected = false;
    private copyFailed = false;
    private copyGeneration = 0;
    private downloadUrl: string | undefined;
    private readonly released = new WeakSet<T>();
    private readonly padding: number;
    private readonly maxBytes: number;

    constructor(private readonly options: PdfDocumentOptions<T>) {
        this.padding = options.padding ?? 24;
        this.maxBytes = options.maxBytes ?? 60 * 1024 * 1024;
        if (
            !Number.isFinite(this.padding) ||
            this.padding < 0 ||
            !Number.isSafeInteger(this.maxBytes) ||
            this.maxBytes < 1
        )
            throw new Error('Invalid PDF reader limits');
    }
    get snapshot(): PdfDocumentState<T> {
        return Object.freeze({
            generation: this.generation,
            status: this.status,
            source: this.source,
            pages: this.pages,
            current: this.current,
            mode: this.mode,
            zoom: this.zoom,
            maxPage: this.maxPage,
            pageTops: this.tops,
            allSelected: this.selected,
            copyFailed: this.copyFailed,
            failure: this.failure,
        });
    }
    private publish(): void {
        if (!this.disposed) this.options.changed?.(this.snapshot);
    }
    private release(source: T | undefined): void {
        if (!source || this.released.has(source)) return;
        this.released.add(source);
        try {
            void Promise.resolve(source.destroy()).catch(() => {});
        } catch {}
    }
    private complete(ready: boolean): void {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.settle?.(ready);
        this.settle = undefined;
        this.opening = undefined;
    }
    private deadline(generation: number): void {
        this.timer = setTimeout(() => {
            if (this.disposed || this.generation !== generation || this.status !== 'loading') return;
            this.failure = 'timeout';
            this.status = 'error';
            this.abort?.abort();
            this.release(this.source);
            this.source = undefined;
            this.complete(false);
            this.publish();
            this.options.error?.(new Error('PDF readiness exceeded five seconds'), 'document');
        }, 5000);
    }
    open(): Promise<boolean> {
        if (this.disposed) return Promise.resolve(false);
        this.complete(false);
        this.abort?.abort();
        this.release(this.source);
        this.source = undefined;
        this.options.viewport?.()?.scrollTo({ top: 0 });
        if (this.downloadUrl) URL.revokeObjectURL(this.downloadUrl);
        this.downloadUrl = undefined;
        this.abort = new AbortController();
        const signal = this.abort.signal,
            generation = ++this.generation;
        this.layoutGeneration++;
        this.copyGeneration++;
        this.anchor = undefined;
        this.status = 'loading';
        this.failure = undefined;
        this.current = 1;
        this.pages = [];
        this.tops = [];
        this.paintedPages.clear();
        this.failures.clear();
        this.awaiting.clear();
        this.selected = false;
        this.copyFailed = false;
        this.started = performance.now();
        const pending = new Promise<boolean>((resolve) => {
            this.settle = resolve;
        });
        this.opening = pending;
        this.deadline(generation);
        this.publish();
        void (async () => {
            try {
                const bytes = await this.options.load(signal);
                signal.throwIfAborted();
                if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > this.maxBytes)
                    throw new Error('Invalid PDF bytes');
                const source = await this.options.open(bytes, signal);
                if (this.disposed || generation !== this.generation || signal.aborted) {
                    this.release(source);
                    return;
                }
                if (this.released.has(source)) throw new Error('A closed PDF source cannot be reused');
                this.source = source;
                if (
                    !source.pages.length ||
                    !Number.isFinite(
                        source.pages.reduce(
                            (height, page) => height + page.height * VIEW_ZOOM_MAX * POINT_TO_PIXEL + this.padding,
                            0,
                        ),
                    ) ||
                    source.pages.some(
                        (page, index) =>
                            page.number !== index + 1 ||
                            !Number.isFinite(page.width) ||
                            !Number.isFinite(page.height) ||
                            page.width <= 0 ||
                            page.height <= 0 ||
                            !Number.isFinite(page.width * VIEW_ZOOM_MAX * POINT_TO_PIXEL),
                    )
                )
                    throw new Error('Invalid PDF page geometry');
                this.pages = Object.freeze(source.pages.map((page) => Object.freeze({ ...page })));
                this.geometry();
                this.publish();
            } catch (error) {
                if (this.disposed || generation !== this.generation || signal.aborted) return;
                this.status = 'error';
                this.failure = 'document';
                this.release(this.source);
                this.source = undefined;
                this.abort?.abort();
                this.complete(false);
                this.publish();
                this.options.error?.(error, 'document');
            }
        })();
        return pending;
    }
    private geometry(): void {
        const largest = this.pages.reduce(
            (size, page) => ({ width: Math.max(size.width, page.width), height: Math.max(size.height, page.height) }),
            { width: 1, height: 1 },
        );
        this.maxPage = Object.freeze(largest);
        this.zoom = viewZoom(this.mode, largest, this.size);
        let top = this.padding;
        this.tops = Object.freeze(
            this.pages.map((page) => {
                const position = top;
                top += page.height * this.zoom * POINT_TO_PIXEL + this.padding;
                if (!Number.isFinite(top)) throw new Error('Invalid PDF document geometry');
                return position;
            }),
        );
    }
    private captureAnchor(): ViewAnchor | undefined {
        const viewport = this.options.viewport?.();
        if (!viewport || !this.pages.length) return;
        const position = viewport.scrollTop + this.padding,
            index = this.current - 1;
        const height = this.pages[index].height * this.zoom * POINT_TO_PIXEL;
        const offset = Math.max(0, position - this.tops[index]);
        return { index, fraction: Math.min(1, offset / height), gap: Math.max(0, offset - height), align: 'top' };
    }
    private reflow(change: () => void): Promise<void> {
        this.anchor ??= this.captureAnchor();
        change();
        this.geometry();
        const version = ++this.layoutGeneration,
            generation = this.generation;
        this.publish();
        return Promise.resolve()
            .then(() => {
                if (!this.disposed && version === this.layoutGeneration) return this.options.afterLayout?.();
            })
            .then(() => {
                if (this.disposed || version !== this.layoutGeneration) return;
                const anchor = this.anchor,
                    viewport = this.options.viewport?.();
                this.anchor = undefined;
                if (anchor && viewport && this.pages[anchor.index])
                    viewport.scrollTop = Math.max(
                        0,
                        this.tops[anchor.index] +
                            anchor.fraction * this.pages[anchor.index].height * this.zoom * POINT_TO_PIXEL +
                            anchor.gap -
                            (anchor.align === 'center' ? viewport.clientHeight / 2 : this.padding),
                    );
            })
            .catch((error) => {
                if (version === this.layoutGeneration) this.pageError(this.current, error, generation);
            });
    }
    setViewport(width: number, height: number): Promise<void> {
        if (this.disposed || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
            return Promise.resolve();
        if (this.size.width === width && this.size.height === height) return Promise.resolve();
        return this.reflow(() => {
            this.size = { width, height };
        });
    }
    setMode(mode: string): Promise<void> {
        if (this.disposed || mode === this.mode) return Promise.resolve();
        return this.reflow(() => {
            this.mode = mode;
        });
    }
    navigate(number: number): void {
        if (this.disposed || !Number.isFinite(number) || !this.pages.length) return;
        this.current = Math.max(1, Math.min(this.pages.length, Math.round(number)));
        if (this.anchor) this.anchor = { index: this.current - 1, fraction: 0, gap: 0, align: 'top' };
        this.options.viewport?.()?.scrollTo({ top: this.tops[this.current - 1] - this.padding });
        this.publish();
        this.commitReady();
    }
    reveal(number: number, rectangle: { y: number; height: number }): void {
        if (
            !Number.isFinite(number) ||
            !Number.isFinite(rectangle.y) ||
            !Number.isFinite(rectangle.height) ||
            rectangle.height < 0
        )
            return;
        this.navigate(number);
        const viewport = this.options.viewport?.();
        if (!viewport || !this.pages.length) return;
        const center = rectangle.y + rectangle.height / 2;
        if (this.anchor)
            this.anchor = {
                index: this.current - 1,
                fraction: center / this.pages[this.current - 1].height,
                gap: 0,
                align: 'center',
            };
        viewport.scrollTop = Math.max(
            0,
            this.tops[this.current - 1] + center * this.zoom * POINT_TO_PIXEL - viewport.clientHeight / 2,
        );
    }
    scrolled(): void {
        const viewport = this.options.viewport?.();
        if (this.disposed || !viewport || !this.pages.length || this.anchor) return;
        const top = viewport.scrollTop,
            bottom = top + viewport.clientHeight;
        const visible = (index: number) =>
            Math.max(
                0,
                Math.min(bottom, this.tops[index] + this.pages[index].height * this.zoom * POINT_TO_PIXEL) -
                    Math.max(top, this.tops[index]),
            );
        let active = this.current - 1,
            largest = visible(active);
        for (let index = pageAt(this.tops, top); index <= pageAt(this.tops, bottom); index++) {
            const height = visible(index);
            if (height > largest + 0.5) {
                active = index;
                largest = height;
            }
        }
        if (this.current !== active + 1) {
            this.current = active + 1;
            this.publish();
            this.commitReady();
        }
    }
    painted(page: number, generation = this.generation): void {
        if (this.disposed || generation !== this.generation || !this.source || !this.pages[page - 1]) return;
        this.paintedPages.add(page);
        this.awaiting.delete(page);
        this.failures.delete(page);
        if (this.failures.size && !this.awaiting.size && this.status === 'loading') {
            this.status = 'error';
            this.failure = 'page';
            this.complete(false);
            this.publish();
        }
        this.commitReady();
    }
    private commitReady(): void {
        if (
            !this.source ||
            this.failures.size ||
            this.awaiting.size ||
            !this.paintedPages.has(this.current) ||
            this.status === 'ready' ||
            this.failure === 'timeout'
        )
            return;
        this.status = 'ready';
        this.failure = undefined;
        this.complete(true);
        this.publish();
        this.options.ready?.({ milliseconds: performance.now() - this.started, pages: this.pages.length });
    }
    pageError(page: number, error: unknown, generation = this.generation): void {
        if (this.disposed || generation !== this.generation || !this.source || !this.pages[page - 1]) return;
        this.failures.set(page, error);
        this.paintedPages.delete(page);
        this.awaiting.delete(page);
        this.status = 'error';
        this.failure = 'page';
        this.complete(false);
        this.publish();
        this.options.error?.(error, 'page');
    }
    retryPage(page: number): void {
        if (this.disposed || !this.source || !this.pages[page - 1]) return;
        this.complete(false);
        this.started = performance.now();
        this.awaiting.add(page);
        this.failures.delete(page);
        this.paintedPages.delete(page);
        this.status = 'loading';
        this.failure = undefined;
        this.deadline(this.generation);
        this.publish();
    }
    clearSelection(): void {
        if (this.disposed) return;
        this.selected = false;
        this.copyFailed = false;
        this.copyGeneration++;
        this.publish();
    }
    key(event: KeyboardEvent): void {
        const target = event.target as Element | null;
        if (target?.closest?.('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
        const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
        if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'a') {
            event.preventDefault();
            if (this.status !== 'ready' || this.disposed) return;
            this.selected = true;
            this.publish();
            const pages = this.options.pagesElement?.();
            if (pages) {
                const range = pages.ownerDocument.createRange();
                range.selectNodeContents(pages);
                const selection = pages.ownerDocument.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
            }
        } else if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'c' && this.selected) {
            event.preventDefault();
            void this.copyText();
        } else if (event.key === 'Escape') {
            this.clearSelection();
            this.options.pagesElement?.()?.ownerDocument.getSelection()?.removeAllRanges();
        } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
            this.clearSelection();
    }
    copied(event: ClipboardEvent): void {
        if (this.selected) {
            event.preventDefault();
            void this.copyText();
        }
    }
    async copyText(): Promise<boolean> {
        const source = this.source,
            token = ++this.copyGeneration;
        if (!source || this.status !== 'ready' || this.disposed) return false;
        this.copyFailed = false;
        this.publish();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                (async () => {
                    const text = await source.plainText();
                    if (this.disposed || source !== this.source || token !== this.copyGeneration) return false;
                    await (this.options.clipboard ?? ((text) => navigator.clipboard.writeText(text)))(text);
                    return true;
                })(),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error('PDF copy exceeded its time limit')), 4500);
                }),
            ]);
        } catch (error) {
            if (!this.disposed && source === this.source && token === this.copyGeneration) {
                this.copyGeneration++;
                this.copyFailed = true;
                this.publish();
                this.options.error?.(error, 'copy');
            }
            return false;
        } finally {
            clearTimeout(timer);
        }
    }
    download(title: string, ownerDocument = globalThis.document): boolean {
        if (!this.source || this.status !== 'ready' || this.disposed || !ownerDocument) return false;
        this.downloadUrl ??= URL.createObjectURL(
            new Blob([new Uint8Array(this.source.bytes())], { type: 'application/pdf' }),
        );
        const link = ownerDocument.createElement('a');
        link.href = this.downloadUrl;
        link.download = `${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'document'}.pdf`;
        link.click();
        return true;
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.generation++;
        this.layoutGeneration++;
        this.copyGeneration++;
        this.complete(false);
        this.abort?.abort();
        this.release(this.source);
        this.source = undefined;
        if (this.downloadUrl) URL.revokeObjectURL(this.downloadUrl);
        this.downloadUrl = undefined;
    }
}
