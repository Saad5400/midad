import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { LtrCanvasFactory } from './canvas.js';
import { pdfPageText, type PdfPageText } from './text.js';

export interface PdfSourceOptions {
    workerUrl?: string;
    assets: new () => { fetch(request: { kind: string; filename: string }): Promise<Uint8Array> };
}

export interface PdfPageBox {
    number: number;
    width: number;
    height: number;
}
export interface PdfWidget {
    id: string;
    name: string;
    type: string;
    readOnly: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface PdfLink {
    href: string;
    x: number;
    y: number;
    width: number;
    height: number;
}
let library: Promise<typeof import('pdfjs-dist')> | undefined;
const MAX_PDF_BYTES = 60 * 1024 * 1024;
export async function readPdfResponse(response: Response, signal: AbortSignal): Promise<Uint8Array> {
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/pdf')) {
        await response.body?.cancel();
        throw new Error('Invalid PDF response');
    }
    if (Number(response.headers.get('Content-Length')) > MAX_PDF_BYTES) {
        await response.body?.cancel();
        throw new Error('Invalid PDF size');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty PDF response');
    const abort = () => void reader.cancel().catch(() => {});
    signal.addEventListener('abort', abort, { once: true });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            signal.throwIfAborted();
            const { value, done } = await reader.read();
            signal.throwIfAborted();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_PDF_BYTES) throw new Error('Invalid PDF size');
            chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return bytes;
    } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
    } finally {
        signal.removeEventListener('abort', abort);
        reader.releaseLock();
    }
}
export function loadPdfLibrary(workerUrl?: string): Promise<typeof import('pdfjs-dist')> {
    return (library ??= import('pdfjs-dist/legacy/build/pdf.mjs')
        .then((pdfjs) => {
            if (typeof window !== 'undefined' && workerUrl) pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
            return pdfjs as typeof import('pdfjs-dist');
        })
        .catch((error) => {
            library = undefined;
            throw error;
        }));
}

export class PdfSource {
    readonly pages: readonly PdfPageBox[];
    private closed = false;
    private text: Promise<string> | undefined;

    private constructor(
        private readonly original: Uint8Array,
        private readonly document: PDFDocumentProxy,
        pages: PdfPageBox[],
        private readonly loading: PDFDocumentLoadingTask,
        private readonly signal: AbortSignal,
        private readonly abort: () => void,
        private readonly assetError: () => Error | undefined,
        private readonly tagged: boolean,
    ) {
        this.pages = Object.freeze(pages.map((page) => Object.freeze(page)));
    }

    static async open(bytes: Uint8Array, signal: AbortSignal, options: PdfSourceOptions): Promise<PdfSource> {
        if (!bytes.length || bytes.length > MAX_PDF_BYTES) throw new Error('Invalid PDF size');
        const original = new Uint8Array(bytes);
        const pdfjs = await loadPdfLibrary(options.workerUrl);
        signal.throwIfAborted();
        const reader = new options.assets();
        let failure: Error | undefined;
        class CheckedAssets {
            async fetch(request: { kind: string; filename: string }): Promise<Uint8Array> {
                try {
                    return await reader.fetch(request);
                } catch (error) {
                    failure = error instanceof Error ? error : new Error('A required PDF asset could not be loaded');
                    throw failure;
                }
            }
        }
        const loading = pdfjs.getDocument({
            data: new Uint8Array(original),
            enableXfa: false,
            useSystemFonts: false,
            useWorkerFetch: false,
            BinaryDataFactory: CheckedAssets,
            ...(typeof window !== 'undefined' ? { CanvasFactory: LtrCanvasFactory } : {}),
        });
        const abort = () => void loading.destroy().catch(() => {});
        signal.addEventListener('abort', abort, { once: true });
        try {
            const document = await loading.promise;
            if (document.numPages < 1 || document.numPages > 10000) throw new Error('Invalid PDF page count');
            const pages = new Array<PdfPageBox>(document.numPages);
            let next = 1;
            await Promise.all(
                Array.from({ length: Math.min(4, document.numPages) }, async () => {
                    while (next <= document.numPages) {
                        signal.throwIfAborted();
                        const number = next++;
                        const page = await document.getPage(number);
                        const viewport = page.getViewport({ scale: 1 });
                        if (
                            ![viewport.width, viewport.height].every(
                                (size) => Number.isFinite(size) && size > 0 && size <= 14400,
                            )
                        )
                            throw new Error('Invalid PDF page size');
                        pages[number - 1] = { number, width: viewport.width, height: viewport.height };
                    }
                }),
            );
            signal.throwIfAborted();
            const metadata = await document.getMetadata();
            const info = metadata.info as { Custom?: Record<string, unknown> };
            return new PdfSource(
                original,
                document,
                pages,
                loading,
                signal,
                abort,
                () => failure,
                info.Custom?.CLMReadingOrder === '1',
            );
        } catch (error) {
            signal.removeEventListener('abort', abort);
            await loading.destroy().catch(() => {});
            throw error;
        }
    }

    bytes(): Uint8Array {
        this.assertOpen();
        return new Uint8Array(this.original);
    }

    async page(number: number): Promise<PDFPageProxy> {
        this.assertOpen();
        if (!Number.isInteger(number) || number < 1 || number > this.pages.length) throw new Error('Invalid PDF page');
        return this.document.getPage(number);
    }

    plainText(): Promise<string> {
        this.assertOpen();
        return (this.text ??= this.readText().catch((error) => {
            this.text = undefined;
            throw error;
        }));
    }

    async textPage(number: number): Promise<PdfPageText> {
        return pdfPageText(await this.page(number), this.tagged);
    }

    private async readText(): Promise<string> {
        const pages = new Array<string>(this.pages.length);
        let next = 1,
            length = 0;
        await Promise.all(
            Array.from({ length: Math.min(4, pages.length) }, async () => {
                while (next <= pages.length) {
                    const number = next++;
                    const { text } = await this.textPage(number);
                    length += text.length;
                    if (length > 10000000) throw new Error('The PDF text exceeds the copy limit');
                    pages[number - 1] = text;
                }
            }),
        );
        this.assertRenderable();
        return pages.join('\n\n');
    }

    assertRenderable(): void {
        this.assertOpen();
        const error = this.assetError();
        if (error) throw error;
    }

    private assertOpen(): void {
        this.signal.throwIfAborted();
        if (this.closed) throw new Error('The PDF is closed');
    }

    async destroy(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        this.signal.removeEventListener('abort', this.abort);
        await this.loading.destroy();
    }
}

export async function pdfAnnotations(page: PDFPageProxy): Promise<{ widgets: PdfWidget[]; links: PdfLink[] }> {
    const viewport = page.getViewport({ scale: 1 });
    const widgets: PdfWidget[] = [],
        links: PdfLink[] = [];
    for (const entry of await page.getAnnotations({ intent: 'display' })) {
        if (!Array.isArray(entry.rect) || entry.rect.length !== 4 || entry.annotationFlags & 35) continue;
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(entry.rect);
        const box = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
        if (!Object.values(box).every(Number.isFinite) || !box.width || !box.height) continue;
        if (entry.subtype === 'Widget' && typeof entry.fieldName === 'string')
            widgets.push({
                ...box,
                id: entry.id,
                name: entry.fieldName,
                type: entry.fieldType,
                readOnly: entry.readOnly === true,
            });
        if (entry.subtype === 'Link' && typeof entry.url === 'string') {
            try {
                const url = new URL(entry.url);
                if (['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol))
                    links.push({ ...box, href: url.href });
            } catch {}
        }
    }
    return { widgets, links };
}
