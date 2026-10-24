export interface PdfPrintOptions {
    readonly before?: (signal: AbortSignal) => Promise<void>;
    readonly bytes: (signal: AbortSignal) => Promise<Uint8Array>;
    readonly identity: () => unknown;
    readonly ready: () => boolean;
    readonly busy?: (value: boolean) => void;
    readonly error?: (error: unknown) => void;
    readonly timeout?: number;
    readonly maxBytes?: number;
    readonly reuse?: () => boolean;
}

export class PdfPrintController {
    private request?: Promise<void>;
    private controller?: AbortController;
    private frame?: HTMLIFrameElement;
    private url?: string;
    private disposed = false;
    private preparing = false;
    private printedIdentity: unknown;
    private readonly window;

    constructor(
        private readonly root: HTMLElement,
        private readonly options: PdfPrintOptions,
    ) {
        const owner = root.ownerDocument.defaultView;
        if (!owner) throw new Error('Printing requires a browser window');
        this.window = owner;
    }

    print(): Promise<void> {
        if (this.disposed) return Promise.reject(new Error('The print controller has been disposed'));
        if (this.request) return this.request;
        this.request = this.prepare().finally(() => {
            this.request = undefined;
        });
        return this.request;
    }

    private async prepare(): Promise<void> {
        const controller = new AbortController();
        this.controller = controller;
        const { signal } = controller;
        let identity: unknown;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let aborted: (() => void) | undefined;
        const cancelled = new Promise<never>((_, reject) => {
            aborted = () => reject(signal.reason ?? new Error('Printing was cancelled'));
            signal.addEventListener('abort', aborted, { once: true });
        });
        const current = () => {
            signal.throwIfAborted();
            if (
                this.disposed ||
                !this.root.isConnected ||
                this.options.identity() !== identity ||
                !this.options.ready()
            )
                throw new Error('The print source changed');
        };
        this.setBusy(true);
        try {
            if (!this.options.ready()) throw new Error('The document is not ready to print');
            timer = setTimeout(
                () => controller.abort(new Error('Preparing the PDF for printing timed out')),
                this.options.timeout ?? 5000,
            );
            if (this.options.before) await Promise.race([this.options.before(signal), cancelled]);
            identity = this.options.identity();
            if (this.options.reuse?.() && this.frame?.contentWindow && this.printedIdentity === identity) {
                current();
                clearTimeout(timer);
                this.show(this.frame);
                return;
            }
            this.release();
            const bytes = await Promise.race([this.options.bytes(signal), cancelled]);
            current();
            if (
                !bytes.length ||
                bytes.length > (this.options.maxBytes ?? 60 * 1024 * 1024) ||
                !new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')
            )
                throw new Error('Printing requires a valid PDF');
            const frame = this.root.ownerDocument.createElement('iframe');
            frame.dataset.midadPrint = '';
            frame.setAttribute('aria-hidden', 'true');
            frame.tabIndex = -1;
            frame.style.cssText = 'position:fixed;inset:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0';
            const loaded = new Promise<void>((resolve, reject) => {
                frame.onload = () => resolve();
                frame.onerror = () => reject(new Error('The print PDF could not be loaded'));
            });
            this.url = this.window.URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
            this.frame = frame;
            frame.src = this.url;
            this.root.ownerDocument.body.append(frame);
            await Promise.race([loaded, cancelled]);
            current();
            const target = frame.contentWindow;
            if (!target) throw new Error('The print window is unavailable');
            target.addEventListener(
                'afterprint',
                () => {
                    if (this.frame === frame) this.release();
                },
                { once: true },
            );
            clearTimeout(timer);
            this.printedIdentity = identity;
            this.show(frame);
        } catch (error) {
            this.release();
            if (!this.disposed) this.options.error?.(error);
            throw error;
        } finally {
            clearTimeout(timer);
            if (aborted) signal.removeEventListener('abort', aborted);
            if (this.controller === controller) this.controller = undefined;
            if (!this.disposed) this.setBusy(false);
        }
    }

    private release(): void {
        this.frame?.remove();
        this.frame = undefined;
        if (this.url) this.window.URL.revokeObjectURL(this.url);
        this.url = undefined;
    }

    private setBusy(value: boolean): void {
        if (this.preparing === value) return;
        this.preparing = value;
        this.options.busy?.(value);
    }

    private show(frame: HTMLIFrameElement): void {
        const target = frame.contentWindow;
        if (!target) throw new Error('The print window is unavailable');
        this.setBusy(false);
        const tree = this.root.getRootNode() as Document | ShadowRoot;
        let focused = (tree.activeElement ?? this.root.ownerDocument.activeElement) as HTMLElement | null;
        while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement as HTMLElement;
        target.print();
        if (
            focused?.isConnected &&
            typeof focused.focus === 'function' &&
            [frame, this.root.ownerDocument.body].includes(this.root.ownerDocument.activeElement as HTMLElement)
        )
            focused.focus({ preventScroll: true });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.controller?.abort(new Error('Printing was cancelled'));
        this.setBusy(false);
        this.release();
    }
}
