import fontkit from '@pdf-lib/fontkit';
import {
    CustomFontEmbedder,
    PDFArray,
    PDFDict,
    PDFDocument,
    PDFName,
    PDFNumber,
    PDFStream,
    StandardFontEmbedder,
    StandardFonts,
    type PDFContext,
    type PDFObject,
    type PDFRef,
} from 'pdf-lib';
import { sourceFontEncoding } from './source-font-encoding.js';

export interface PdfSourceFontProgram {
    readonly format: 'truetype' | 'cff';
    readonly bytes: Uint8Array;
}
export type PdfSourceFontResolver = (name: string) => Promise<PdfSourceFontProgram | undefined>;

class SourceTrueTypeFont extends CustomFontEmbedder {
    static async create(bytes: Uint8Array): Promise<SourceTrueTypeFont> {
        const parsed = await CustomFontEmbedder.for(fontkit, bytes);
        const result = new SourceTrueTypeFont(parsed.font, bytes);
        if (result.isCFF()) throw new Error('Expected a TrueType source font program');
        result.baseFontName = parsed.fontName;
        return result;
    }
    descriptor(context: PDFContext): Promise<PDFRef> {
        return this.embedFontDescriptor(context);
    }
}

function simpleFonts(source: PDFDocument): readonly PDFDict[] {
    const seen = new Set<PDFObject>();
    const fonts: PDFDict[] = [];
    const visit = (object: PDFObject, depth = 0): void => {
        if (seen.has(object)) return;
        if (depth > 64) throw new Error('Invalid source font resource structure');
        seen.add(object);
        if (object instanceof PDFStream) visit(object.dict, depth + 1);
        else if (object instanceof PDFArray) object.asArray().forEach((value) => visit(value, depth + 1));
        else if (object instanceof PDFDict) {
            if (
                object.get(PDFName.of('Type')) === PDFName.of('Font') &&
                ['Type1', 'TrueType'].includes(object.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() ?? '')
            )
                fonts.push(object);
            for (const [, value] of object.entries()) visit(value, depth + 1);
        }
    };
    for (const [, object] of source.context.enumerateIndirectObjects()) visit(object);
    return fonts;
}

function standardMetrics(name: string): StandardFontEmbedder | undefined {
    return Object.values(StandardFonts).includes(name as StandardFonts)
        ? StandardFontEmbedder.for(name as Parameters<typeof StandardFontEmbedder.for>[0])
        : undefined;
}

function freezeWidths(font: PDFDict, metrics: StandardFontEmbedder | undefined): void {
    if (font.has(PDFName.of('Widths')) && font.has(PDFName.of('Encoding'))) return;
    if (!metrics) throw new Error('The source font has no glyph widths');
    const names = sourceFontEncoding(font, metrics);
    if (!font.has(PDFName.of('Widths'))) {
        font.set(PDFName.of('FirstChar'), PDFNumber.of(0));
        font.set(PDFName.of('LastChar'), PDFNumber.of(255));
        font.set(
            PDFName.of('Widths'),
            font.context.obj(
                names.map(
                    (name) =>
                        metrics.font.getWidthOfGlyph(name) ??
                        (metrics.font.IsFixedPitch ? (metrics.font.getWidthOfGlyph('space') ?? 600) : 0),
                ),
            ),
        );
    }
    if (!font.has(PDFName.of('Encoding')))
        font.set(
            PDFName.of('Encoding'),
            font.context.obj({ Type: 'Encoding', Differences: [0, ...names.map(PDFName.of)] }),
        );
}

function cffName(bytes: Uint8Array): string {
    const start = bytes[2];
    if (bytes.length < 8 || bytes[0] !== 1 || start < 4 || start + 3 >= bytes.length)
        throw new Error('Invalid CFF source font program');
    const count = bytes[start] * 256 + bytes[start + 1],
        size = bytes[start + 2];
    if (count !== 1 || size < 1 || size > 4) throw new Error('Invalid CFF source font name');
    const offset = (position: number): number => {
        let value = 0;
        for (let index = 0; index < size; index++) value = value * 256 + bytes[position + index];
        return value;
    };
    const data = start + 3 + 2 * size;
    const from = data + offset(start + 3) - 1,
        to = data + offset(start + 3 + size) - 1;
    if (from < data || to <= from || to > bytes.length) throw new Error('Invalid CFF source font name');
    const name = new TextDecoder().decode(bytes.subarray(from, to));
    if (!/^[!-~]+$/.test(name) || name.length > 127) throw new Error('Invalid CFF source font name');
    return name;
}

function cffDescriptor(
    source: PDFDocument,
    bytes: Uint8Array,
    metrics: StandardFontEmbedder | undefined,
    previous?: PDFDict,
): PDFRef {
    if (!metrics && !previous) throw new Error('The source font has no descriptor metrics');
    const descriptor =
        previous?.clone() ??
        source.context.obj({
            Type: 'FontDescriptor',
            FontBBox: metrics!.font.FontBBox,
            Ascent: metrics!.font.Ascender || metrics!.font.FontBBox[3],
            Descent: metrics!.font.Descender || metrics!.font.FontBBox[1],
            CapHeight: metrics!.font.CapHeight || metrics!.font.FontBBox[3],
            ItalicAngle: metrics!.font.ItalicAngle,
            StemV: metrics!.font.StdVW,
            Flags:
                (['Symbol', 'ZapfDingbats'].includes(metrics!.fontName) ? 4 : 32) |
                (metrics!.font.IsFixedPitch ? 1 : 0) |
                (metrics!.font.ItalicAngle ? 64 : 0),
        });
    descriptor.set(PDFName.of('FontName'), PDFName.of(cffName(bytes)));
    for (const key of ['FontFile', 'FontFile2']) descriptor.delete(PDFName.of(key));
    descriptor.set(
        PDFName.of('FontFile3'),
        source.context.register(source.context.flateStream(bytes, { Subtype: 'Type1C' })),
    );
    return source.context.register(descriptor);
}

export async function embedPdfSourceFonts(original: Uint8Array, resolve: PdfSourceFontResolver): Promise<Uint8Array> {
    const source = await PDFDocument.load(new Uint8Array(original), { updateMetadata: false });
    const programs = new Map<string, Promise<{ program: PdfSourceFontProgram; descriptor: PDFRef } | undefined>>();
    let changed = false;
    for (const font of simpleFonts(source)) {
        const previous = font.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
        if (
            ['FontFile', 'FontFile2', 'FontFile3'].some((key) => previous?.lookup(PDFName.of(key)) instanceof PDFStream)
        )
            continue;
        const name = font.lookupMaybe(PDFName.of('BaseFont'), PDFName)?.decodeText();
        if (!name) continue;
        let pending = programs.get(name);
        if (!pending) {
            pending = (async () => {
                const supplied = await resolve(name);
                if (!supplied) return undefined;
                const program = { ...supplied, bytes: new Uint8Array(supplied.bytes) };
                if (!program.bytes.length || program.bytes.length > 16 * 1024 * 1024)
                    throw new Error('Invalid source font size');
                const descriptor =
                    program.format === 'truetype'
                        ? await (await SourceTrueTypeFont.create(program.bytes)).descriptor(source.context)
                        : program.format === 'cff'
                          ? cffDescriptor(source, program.bytes, standardMetrics(name), previous)
                          : undefined;
                if (!descriptor) throw new Error('Invalid source font program format');
                return { program, descriptor };
            })();
            programs.set(name, pending);
        }
        const embedded = await pending;
        if (!embedded) continue;
        freezeWidths(font, standardMetrics(name));
        const descriptor = source.context.lookup(embedded.descriptor, PDFDict);
        if (embedded.program.format === 'truetype') {
            const flags = descriptor.lookup(PDFName.of('Flags'), PDFNumber).asNumber();
            descriptor.set(PDFName.of('Flags'), PDFNumber.of((flags & ~4) | 32));
        }
        font.set(PDFName.of('Subtype'), PDFName.of(embedded.program.format === 'truetype' ? 'TrueType' : 'Type1'));
        font.set(PDFName.of('BaseFont'), descriptor.get(PDFName.of('FontName'))!);
        const missingWidth = previous?.lookupMaybe(PDFName.of('MissingWidth'), PDFNumber);
        if (missingWidth) {
            const copy = descriptor.clone();
            copy.set(PDFName.of('MissingWidth'), missingWidth);
            font.set(PDFName.of('FontDescriptor'), source.context.register(copy));
        } else font.set(PDFName.of('FontDescriptor'), embedded.descriptor);
        changed = true;
    }
    return changed ? source.save({ updateFieldAppearances: false, objectsPerTick: 100000 }) : original;
}
