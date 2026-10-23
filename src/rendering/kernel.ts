import CanvasKitInit, { type CanvasKit, type Surface } from 'canvaskit-wasm';
import type { NativeDocument } from '../document/model.js';
import { chooseFont } from '../typography/fonts.js';
import { DEFAULT_TEXT_STYLE, type TextSpan } from '../typography/style.js';
import { DocumentImages, type ImageReader, type MediaResolver } from './assets.js';
import { neededFontFiles } from './font-profile.js';
import { TextFonts } from './text/fonts.js';
import type { NativeFontAsset, ShapedParagraph } from './text/model.js';
import { shapeParagraph } from './text/shaping.js';

export { point } from '../typography/metrics.js';
export { NATIVE_FONT_ID } from './text/fonts.js';
export { shapedLineAt } from './text/model.js';
export type { NativeFontAsset, ShapedRun, ShapedLine, TextSource, ShapedParagraph } from './text/model.js';

const wasmUrl = new URL('../../assets/canvaskit.wasm', import.meta.url).href;
export const NATIVE_READY_LIMIT_MS = 5000;
let loading: Promise<CanvasKit> | undefined;

export class NativeTextKernel {
    private cache = new Map<string, ShapedParagraph>();
    private retained = new Map<ShapedParagraph, number>();
    private readonly fonts: TextFonts;
    private preparing: Promise<void> = Promise.resolve();
    private disposed = false;
    readonly provider;
    readonly images;
    fontHash = '';

    private constructor(
        readonly ck: CanvasKit,
        resolveMedia?: MediaResolver,
        readFont?: (file: string) => Promise<Uint8Array>,
        readImage?: ImageReader,
    ) {
        this.fonts = new TextFonts(ck, readFont);
        this.provider = this.fonts.provider;
        this.images = new DocumentImages(ck, resolveMedia, readImage);
    }

    static async withAssets(
        ck: CanvasKit,
        readFont: (file: string) => Promise<Uint8Array>,
        readImage: ImageReader,
    ): Promise<NativeTextKernel> {
        const kernel = new NativeTextKernel(ck, undefined, readFont, readImage);
        try {
            await kernel.loadFonts(new Set(['amiri', chooseFont(DEFAULT_TEXT_STYLE).file]));
            return kernel;
        } catch (error) {
            kernel.destroy();
            throw error;
        }
    }

    static async create(
        resolveMedia?: MediaResolver,
        readFont?: (file: string) => Promise<Uint8Array>,
    ): Promise<NativeTextKernel> {
        loading ??= CanvasKitInit({ locateFile: () => wasmUrl }).catch((error) => {
            loading = undefined;
            throw error;
        });
        const kernel = new NativeTextKernel(await loading, resolveMedia, readFont);
        try {
            await kernel.loadFonts(new Set(['amiri', chooseFont(DEFAULT_TEXT_STYLE).file]));
            return kernel;
        } catch (error) {
            kernel.destroy();
            throw error;
        }
    }

    async prepare(document: NativeDocument): Promise<void> {
        return this.prepareAssets(document, true);
    }

    async prepareFonts(document: NativeDocument): Promise<void> {
        return this.prepareAssets(document, false);
    }

    private async prepareAssets(document: NativeDocument, images: boolean): Promise<void> {
        if (this.disposed) throw new Error('The document renderer has been disposed');
        this.preparing = this.preparing
            .catch(() => undefined)
            .then(async () => {
                await Promise.all([
                    this.loadFonts(neededFontFiles(document)),
                    ...(images ? [this.images.prepare(document)] : []),
                ]);
            });
        await this.preparing;
    }

    private async loadFonts(files: ReadonlySet<string>): Promise<void> {
        this.fontHash = await this.fonts.load(files);
    }

    async fontFingerprint(document: NativeDocument): Promise<string> {
        return this.fonts.fingerprint(neededFontFiles(document));
    }

    font(id: string): NativeFontAsset {
        return this.fonts.get(id);
    }

    shape(text: string, width: number, size: number, direction: 'rtl' | 'ltr'): ShapedParagraph {
        return this.shapeRich(
            [{ nodeId: '', text, editable: false, style: { ...DEFAULT_TEXT_STYLE, size } }],
            width,
            direction,
        );
    }

    shapeRich(
        spans: readonly TextSpan[],
        width: number,
        direction: 'rtl' | 'ltr',
        alignment?: string,
        heightMultiplier?: number,
    ): ShapedParagraph {
        if (this.disposed) throw new Error('The document renderer has been disposed');
        const key = JSON.stringify([spans, width, direction, alignment, heightMultiplier, this.fontHash]);
        const cached = this.cache.get(key);
        if (cached) return cached;
        const shaped = shapeParagraph(this.ck, this.fonts, spans, width, direction, alignment, heightMultiplier);
        this.cache.set(key, shaped);
        return shaped;
    }

    surface(canvas: HTMLCanvasElement): Surface {
        const surface = this.ck.MakeSWCanvasSurface(canvas);
        if (!surface) throw new Error('The document drawing surface could not be created');
        return surface;
    }

    retainParagraphs(paragraphs: Iterable<ShapedParagraph>): () => void {
        if (this.disposed) throw new Error('The document renderer has been disposed');
        const entries = new Set(paragraphs);
        for (const entry of entries) this.retained.set(entry, (this.retained.get(entry) ?? 0) + 1);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            for (const entry of entries) {
                const count = this.retained.get(entry) ?? 0;
                if (count > 1) this.retained.set(entry, count - 1);
                else this.retained.delete(entry);
            }
        };
    }

    clearUnused(used: ReadonlySet<ShapedParagraph>): void {
        for (const [key, shaped] of this.cache)
            if (!used.has(shaped) && !this.retained.has(shaped)) {
                shaped.paragraph.delete();
                this.cache.delete(key);
            }
    }

    destroy(): void {
        if (this.disposed) return;
        this.disposed = true;
        void this.preparing
            .catch(() => undefined)
            .then(() => {
                this.retained.clear();
                this.clearUnused(new Set());
                this.fonts.destroy();
                this.images.destroy();
            });
    }
}
