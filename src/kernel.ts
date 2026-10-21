import CanvasKitInit, { type CanvasKit, type Paragraph, type Surface, type Typeface } from 'canvaskit-wasm';
const wasmUrl = new URL('../assets/canvaskit.wasm', import.meta.url).href;
import { DocumentImages, type ImageReader, type MediaResolver } from './assets.js';
import type { NativeDocument } from './document.js';
import { chooseFont, fontUrl, neededFontFiles, scriptFontFiles } from './fonts.js';
import { DEFAULT_TEXT_STYLE, type TextSpan, type TextStyle } from './style.js';

export const NATIVE_FONT_ID = 'amiri-regular';
export const NATIVE_READY_LIMIT_MS = 5000;
export const point = (value: number): number => Math.round(value * 1024) / 1024;

export interface NativeFontAsset {
    readonly id: string;
    readonly bytes: Uint8Array;
    readonly hash: string;
    readonly typeface: Typeface;
    readonly family: string;
}

export interface ShapedRun {
    readonly fontId: string;
    readonly glyphs: readonly number[];
    readonly text: readonly string[];
    readonly positions: readonly number[];
    readonly offsets: readonly number[];
    readonly size: number;
    readonly style: TextStyle;
    readonly fauxBold: boolean;
    readonly fauxItalic: boolean;
}

export interface ShapedLine {
    readonly start: number;
    readonly end: number;
    readonly endWithBreak: number;
    readonly left: number;
    readonly width: number;
    readonly top: number;
    readonly bottom: number;
    readonly baseline: number;
    readonly runs: readonly ShapedRun[];
}

export interface TextSource {
    readonly nodeId: string;
    readonly from: number;
    readonly to: number;
    readonly editable: boolean;
}
export interface ShapedParagraph {
    readonly paragraph: Paragraph;
    readonly text: string;
    readonly width: number;
    readonly direction: 'rtl' | 'ltr';
    readonly lines: readonly ShapedLine[];
    readonly sources: readonly TextSource[];
    readonly placeholders: readonly {
        readonly span: TextSpan;
        readonly from: number;
        readonly left: number;
        readonly top: number;
        readonly width: number;
        readonly height: number;
    }[];
}

let loading: Promise<CanvasKit> | undefined;
const fontLoads = new Map<string, Promise<{ bytes: Uint8Array; hash: string }>>();
async function hash(bytes: Uint8Array): Promise<string> {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)), (value) =>
        value.toString(16).padStart(2, '0'),
    ).join('');
}

export class NativeTextKernel {
    private cache = new Map<string, ShapedParagraph>();
    private assets = new Map<string, NativeFontAsset>();
    private preparing: Promise<void> = Promise.resolve();
    private disposed = false;
    readonly provider;
    readonly images;
    fontHash = '';

    private constructor(
        readonly ck: CanvasKit,
        resolveMedia?: MediaResolver,
        private readonly readFont?: (file: string) => Promise<Uint8Array>,
        readImage?: ImageReader,
    ) {
        this.provider = ck.TypefaceFontProvider.Make();
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
        const missing = [...files].filter((file) => !this.assets.has(file === 'amiri' ? NATIVE_FONT_ID : file));
        await Promise.all(
            missing.map(async (file) => {
                let load = this.readFont
                    ? this.readFont(file).then(async (bytes) => ({ bytes, hash: await hash(bytes) }))
                    : fontLoads.get(file);
                if (!load) {
                    const url = fontUrl(file);
                    if (!url) throw new Error(`The document font is missing: ${file}`);
                    load = fetch(url)
                        .then(async (response) => {
                            if (!response.ok) throw new Error(`The document font could not be downloaded: ${file}`);
                            const bytes = new Uint8Array(await response.arrayBuffer());
                            return { bytes, hash: await hash(bytes) };
                        })
                        .catch((error) => {
                            fontLoads.delete(file);
                            throw error;
                        });
                    fontLoads.set(file, load);
                }
                const { bytes, hash: fontHash } = await load;
                const id = file === 'amiri' ? NATIVE_FONT_ID : file;
                this.provider.registerFont(bytes, `Native-${id}`);
                const typeface = this.provider.matchFamilyStyle(`Native-${id}`, {
                    weight: this.ck.FontWeight.Normal,
                    width: this.ck.FontWidth.Normal,
                    slant: this.ck.FontSlant.Upright,
                });
                if (!typeface) throw new Error(`The document font could not be loaded: ${file}`);
                this.assets.set(
                    id,
                    Object.freeze({
                        id,
                        get bytes() {
                            return new Uint8Array(bytes);
                        },
                        hash: fontHash,
                        typeface,
                        family: typeface.getFamilyName(),
                    }),
                );
            }),
        );
        this.fontHash = await this.fingerprintFonts(files);
    }

    async fontFingerprint(document: NativeDocument): Promise<string> {
        return this.fingerprintFonts(neededFontFiles(document));
    }

    private async fingerprintFonts(files: ReadonlySet<string>): Promise<string> {
        return hash(
            new TextEncoder().encode(
                JSON.stringify(
                    [...new Set(['amiri', ...files])]
                        .map((file) => this.font(file === 'amiri' ? NATIVE_FONT_ID : file))
                        .map((asset) => [asset.id, asset.hash])
                        .sort(),
                ),
            ),
        );
    }

    font(id: string): NativeFontAsset {
        const font = this.assets.get(id);
        if (!font) throw new Error(`The document font has not been prepared: ${id}`);
        return font;
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
        const ck = this.ck;
        const align =
            alignment === 'justify'
                ? ck.TextAlign.Justify
                : alignment === 'center'
                  ? ck.TextAlign.Center
                  : alignment === 'left'
                    ? ck.TextAlign.Left
                    : alignment === 'right'
                      ? ck.TextAlign.Right
                      : direction === 'rtl'
                        ? ck.TextAlign.Right
                        : ck.TextAlign.Left;
        const builder = ck.ParagraphBuilder.MakeFromFontProvider(
            new ck.ParagraphStyle({
                disableHinting: true,
                applyRoundingHack: false,
                replaceTabCharacters: true,
                textStyle: {
                    fontFamilies: [`Native-${chooseFont(spans[0]?.style ?? DEFAULT_TEXT_STYLE).id}`],
                    fontSize: spans[0]?.style.size ?? DEFAULT_TEXT_STYLE.size,
                    color: ck.BLACK,
                    ...(spans[0]?.style.lineHeight ? { heightMultiplier: spans[0].style.lineHeight } : {}),
                },
                textDirection: direction === 'rtl' ? ck.TextDirection.RTL : ck.TextDirection.LTR,
                textAlign: align,
                ...(heightMultiplier ? { heightMultiplier } : {}),
            }),
            this.provider,
        );
        let text = '';
        let bytes = 0;
        const ranges = spans.map((span) => {
            const choice = chooseFont(span.style);
            this.font(choice.id);
            const from = text.length;
            const byteStart = bytes;
            text += span.text;
            bytes += new TextEncoder().encode(span.text).length;
            const fallback = [
                ...new Set([
                    NATIVE_FONT_ID,
                    ...scriptFontFiles(span.text, span.style.bold),
                    chooseFont({ ...span.style, family: DEFAULT_TEXT_STYLE.family }).id,
                ]),
            ].filter((id) => id !== choice.id);
            builder.pushStyle(
                new ck.TextStyle({
                    fontFamilies: [`Native-${choice.id}`, ...fallback.map((id) => `Native-${id}`)],
                    fontSize: span.style.size,
                    color: ck.BLACK,
                    ...(span.style.lineHeight === null ? {} : { heightMultiplier: span.style.lineHeight }),
                }),
            );
            if (span.placeholder)
                builder.addPlaceholder(
                    span.placeholder.width,
                    span.placeholder.height,
                    ck.PlaceholderAlignment.Baseline,
                    ck.TextBaseline.Alphabetic,
                    span.placeholder.height * 0.8,
                );
            else builder.addText(span.text);
            builder.pop();
            return { span, choice, from, to: text.length, byteStart, byteEnd: bytes };
        });
        if (!text) builder.addText(' ');
        const paragraph = builder.build();
        builder.delete();
        paragraph.layout(width);
        const rawLines = paragraph.getShapedLines();
        const metrics = paragraph.getLineMetrics();
        const byLine = new Map<number, (typeof rawLines)[number]>();
        let metricIndex = 0;
        for (const line of rawLines) {
            while (
                metricIndex + 1 < metrics.length &&
                Math.abs(metrics[metricIndex + 1].baseline - line.baseline) <
                    Math.abs(metrics[metricIndex].baseline - line.baseline)
            )
                metricIndex++;
            byLine.set(metricIndex, line);
        }
        const encodedText = new TextEncoder().encode(text);
        const clusterOffsets = [
            ...new Set(rawLines.flatMap((line) => line.runs.flatMap((run) => Array.from(run.offsets)))),
        ]
            .filter((offset) => offset >= 0 && offset <= encodedText.length)
            .sort((a, b) => a - b);
        const clusterText = new Map<number, string>();
        const decoder = new TextDecoder();
        for (let index = 0; index < clusterOffsets.length; index++)
            clusterText.set(
                clusterOffsets[index],
                decoder
                    .decode(
                        encodedText.subarray(clusterOffsets[index], clusterOffsets[index + 1] ?? encodedText.length),
                    )
                    .replace(/[\r\n\uFFFC]/g, ''),
            );
        const assignedClusters = new Set<number>();
        const explicitHeight = spans.some((span) => span.style.lineHeight !== null);
        let lines: ShapedLine[];
        try {
            lines = metrics.map((metric, index) => {
                const line = byLine.get(index);
                const runs: ShapedRun[] = [];
                for (const raw of line?.runs ?? []) {
                    const rawAsset = raw.typeface
                        ? [...this.assets.values()].find((asset) => raw.typeface!.isAliasOf(asset.typeface))
                        : undefined;
                    if (raw.typeface && !rawAsset) throw new Error('The shaped font is not part of the document');
                    let group:
                        | {
                              fontId: string;
                              glyphs: number[];
                              text: string[];
                              positions: number[];
                              offsets: number[];
                              size: number;
                              style: TextStyle;
                              fauxBold: boolean;
                              fauxItalic: boolean;
                              sourceStart: number;
                          }
                        | undefined;
                    let range = ranges[0];
                    for (let index = 0; index < raw.glyphs.length; index++) {
                        if (raw.glyphs[index] === 0) {
                            const missing = Array.from(
                                clusterText.get(raw.offsets[index]) ?? '',
                                (character) => `U+${character.codePointAt(0)!.toString(16).toUpperCase()}`,
                            ).join(', ');
                            throw new Error(
                                `The registered fonts cannot display ${missing || 'an unmapped glyph'} (${rawAsset?.id ?? 'unknown font'})`,
                            );
                        }
                        const offset = raw.offsets[index];
                        if (!range || offset < range.byteStart || offset >= range.byteEnd) {
                            let low = 0,
                                high = ranges.length;
                            while (low < high) {
                                const middle = (low + high) >>> 1;
                                if (ranges[middle].byteEnd <= offset) low = middle + 1;
                                else high = middle;
                            }
                            range = ranges[Math.min(low, ranges.length - 1)];
                        }
                        const style = range?.span.style ?? DEFAULT_TEXT_STYLE;
                        const asset = rawAsset ?? this.font(range?.choice.id ?? NATIVE_FONT_ID);
                        if (!group || group.fontId !== asset.id || group.sourceStart !== (range?.byteStart ?? 0)) {
                            if (group)
                                runs.push(
                                    Object.freeze({
                                        ...group,
                                        glyphs: Object.freeze(group.glyphs),
                                        text: Object.freeze(group.text),
                                        positions: Object.freeze(group.positions),
                                        offsets: Object.freeze(group.offsets),
                                    }),
                                );
                            group = {
                                sourceStart: range?.byteStart ?? 0,
                                fontId: asset.id,
                                glyphs: [],
                                text: [],
                                positions: [],
                                offsets: [],
                                size: raw.size,
                                style,
                                fauxBold: style.bold && !asset.id.includes('bold'),
                                fauxItalic: style.italic && !asset.id.includes('italic'),
                            };
                        }
                        group.glyphs.push(raw.glyphs[index]);
                        group.text.push(assignedClusters.has(offset) ? '' : (clusterText.get(offset) ?? ''));
                        assignedClusters.add(offset);
                        group.positions.push(point(raw.positions[index * 2]), point(raw.positions[index * 2 + 1]));
                        group.offsets.push(raw.offsets[index]);
                        if (
                            index === raw.glyphs.length - 1 ||
                            raw.offsets[index + 1] < (range?.byteStart ?? 0) ||
                            raw.offsets[index + 1] >= (range?.byteEnd ?? Infinity)
                        ) {
                            group.positions.push(
                                point(raw.positions[(index + 1) * 2]),
                                point(raw.positions[(index + 1) * 2 + 1]),
                            );
                            group.offsets.push(raw.offsets[index + 1]);
                            runs.push(
                                Object.freeze({
                                    ...group,
                                    glyphs: Object.freeze(group.glyphs),
                                    text: Object.freeze(group.text),
                                    positions: Object.freeze(group.positions),
                                    offsets: Object.freeze(group.offsets),
                                }),
                            );
                            group = undefined;
                        }
                    }
                }
                return Object.freeze({
                    start: Math.min(text.length, index ? metrics[index - 1].endIncludingNewline : 0),
                    end: Math.max(
                        Math.min(text.length, index ? metrics[index - 1].endIncludingNewline : 0),
                        Math.min(text.length, metric.endIndex - (text[metric.endIndex - 1] === '\n' ? 1 : 0)),
                    ),
                    endWithBreak: Math.min(text.length, metric.endIncludingNewline),
                    left: point(metric.left),
                    width: point(metric.width),
                    top: point(explicitHeight || !line ? metric.baseline - metric.ascent : line.top),
                    bottom: point(
                        explicitHeight || !line ? metric.baseline - metric.ascent + metric.height : line.bottom,
                    ),
                    baseline: point(line?.baseline ?? metric.baseline),
                    runs: Object.freeze(runs),
                });
            });
        } catch (error) {
            paragraph.delete();
            throw error;
        } finally {
            for (const face of new Set(rawLines.flatMap((line) => line.runs.map((run) => run.typeface))))
                face?.delete();
        }
        const rectangles = paragraph.getRectsForPlaceholders();
        const placeholders = ranges
            .filter(({ span }) => span.placeholder)
            .map(({ span, from }, index) => {
                const rect = rectangles[index]?.rect;
                if (!rect) throw new Error('The inline object could not be positioned');
                return Object.freeze({
                    span,
                    from,
                    left: point(rect[0]),
                    top: point(rect[1]),
                    width: point(rect[2] - rect[0]),
                    height: point(rect[3] - rect[1]),
                });
            });
        const bounds = lines.map((line) => ({ top: line.top, bottom: line.bottom }));
        for (const placeholder of placeholders) {
            let low = 0,
                high = lines.length;
            while (low < high) {
                const middle = (low + high) >>> 1;
                if (lines[middle].start <= placeholder.from) low = middle + 1;
                else high = middle;
            }
            const box = bounds[Math.max(0, low - 1)];
            box.top = Math.min(box.top, placeholder.top);
            box.bottom = Math.max(box.bottom, placeholder.top + placeholder.height);
        }
        lines = lines.map((line, index) =>
            Object.freeze({ ...line, top: point(bounds[index].top), bottom: point(bounds[index].bottom) }),
        );
        const shaped = Object.freeze({
            width,
            direction,
            paragraph,
            text,
            lines: Object.freeze(lines),
            sources: Object.freeze(
                ranges.map(({ span, from, to }) => ({ nodeId: span.nodeId, editable: span.editable, from, to })),
            ),
            placeholders: Object.freeze(placeholders),
        });
        this.cache.set(key, shaped);
        return shaped;
    }

    surface(canvas: HTMLCanvasElement): Surface {
        const surface = this.ck.MakeSWCanvasSurface(canvas);
        if (!surface) throw new Error('The document drawing surface could not be created');
        return surface;
    }

    clearUnused(used: ReadonlySet<ShapedParagraph>): void {
        for (const [key, shaped] of this.cache)
            if (!used.has(shaped)) {
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
                this.clearUnused(new Set());
                for (const asset of this.assets.values()) asset.typeface.delete();
                this.assets.clear();
                this.images.destroy();
                this.provider.delete();
            });
    }
}

export function shapedLineAt(shaped: ShapedParagraph, offset: number): ShapedLine | undefined {
    return shaped.lines.find((line) => offset < line.endWithBreak) ?? shaped.lines[shaped.lines.length - 1];
}
