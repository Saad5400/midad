// @vitest-environment node
import { embedPdfSourceFonts, pdfSourcePages, type PdfSourceFontProgram } from '@saad5400/midad/pdf';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream, StandardFonts, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const directory = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts');
const programs: Record<StandardFonts, string> = {
    Courier: 'FoxitFixed.pfb',
    'Courier-Bold': 'FoxitFixedBold.pfb',
    'Courier-Oblique': 'FoxitFixedItalic.pfb',
    'Courier-BoldOblique': 'FoxitFixedBoldItalic.pfb',
    Helvetica: 'LiberationSans-Regular.ttf',
    'Helvetica-Bold': 'LiberationSans-Bold.ttf',
    'Helvetica-Oblique': 'LiberationSans-Italic.ttf',
    'Helvetica-BoldOblique': 'LiberationSans-BoldItalic.ttf',
    'Times-Roman': 'FoxitSerif.pfb',
    'Times-Bold': 'FoxitSerifBold.pfb',
    'Times-Italic': 'FoxitSerifItalic.pfb',
    'Times-BoldItalic': 'FoxitSerifBoldItalic.pfb',
    Symbol: 'FoxitSymbol.pfb',
    ZapfDingbats: 'FoxitDingbats.pfb',
};
const resolve = async (name: string): Promise<PdfSourceFontProgram | undefined> => {
    const file = programs[name as StandardFonts];
    return file
        ? { format: file.endsWith('.ttf') ? 'truetype' : 'cff', bytes: await readFile(join(directory, file)) }
        : undefined;
};
async function fixture() {
    const pdf = await PDFDocument.create();
    for (const [index, name] of Object.values(StandardFonts).entries()) {
        const page = pdf.addPage([400, 500]);
        page.setCropBox(10, 15, 350, 450);
        page.setRotation(degrees((index % 4) * 90));
        if (index % 2) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
        const font = await pdf.embedFont(name);
        const text =
            name === StandardFonts.Symbol
                ? 'αβΓ Ω'
                : name === StandardFonts.ZapfDingbats
                  ? '✁✂✃'
                  : 'AV To fi 123 € café';
        page.drawText(text, { x: 30, y: 360, size: 22, font });
    }
    const field = pdf.getForm().createTextField('original');
    field.setText('Original form value');
    field.addToPage(pdf.getPage(0), { x: 30, y: 200, width: 300, height: 35 });
    return pdf.save();
}
async function textGeometry(bytes: Uint8Array) {
    const reader = await getDocument({
        data: new Uint8Array(bytes),
        standardFontDataUrl: directory + '/',
        useSystemFonts: false,
    }).promise;
    try {
        const pages = [];
        for (let number = 1; number <= reader.numPages; number++) {
            const page = await reader.getPage(number);
            const content = await page.getTextContent();
            pages.push(
                content.items
                    .filter((item) => 'str' in item)
                    .map((item) => {
                        if (!('str' in item)) throw new Error('Unexpected text item');
                        return { text: item.str, transform: item.transform, width: item.width, height: item.height };
                    }),
            );
        }
        return pages;
    } finally {
        await reader.destroy();
    }
}
function pageStreams(pdf: PDFDocument) {
    return pdf.getPages().map((page) => {
        const content = page.node.Contents();
        const streams =
            content instanceof PDFArray ? content.asArray().map((item) => pdf.context.lookup(item)) : [content];
        return streams
            .filter((stream): stream is PDFStream => stream instanceof PDFStream)
            .map((stream) => [...stream.getContents()]);
    });
}
it('embeds the reader font programs for all 14 standard faces without moving text or source pages', async () => {
    const original = await fixture(),
        before = new Uint8Array(original);
    const resolver = vi.fn(resolve),
        started = performance.now();
    const pinned = await embedPdfSourceFonts(original, resolver);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(original).toEqual(before);
    expect(resolver).toHaveBeenCalledTimes(14);
    expect(await pdfSourcePages(pinned)).toEqual(await pdfSourcePages(original));
    const a = await PDFDocument.load(original),
        b = await PDFDocument.load(pinned);
    expect(pageStreams(b)).toEqual(pageStreams(a));
    expect(b.getForm().getTextField('original').getText()).toBe('Original form value');
    const actual = await textGeometry(pinned),
        expected = await textGeometry(original);
    expect(actual.map((page) => page.map((item) => item.text))).toEqual(
        expected.map((page) => page.map((item) => item.text)),
    );
    for (const [page, entries] of actual.entries())
        for (const [index, item] of entries.entries()) {
            const previous = expected[page][index];
            expect(item.transform).toEqual(previous.transform);
            expect(item.width).toBeCloseTo(previous.width, 6);
            expect(item.height).toBeCloseTo(previous.height, 6);
        }
    for (const [, object] of b.context.enumerateIndirectObjects())
        if (
            object instanceof PDFDict &&
            object.get(PDFName.of('Type')) === PDFName.of('Font') &&
            ['Type1', 'TrueType'].includes(object.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() ?? '')
        ) {
            const descriptor = object.lookup(PDFName.of('FontDescriptor'), PDFDict);
            expect(descriptor.has(PDFName.of('FontFile2')) || descriptor.has(PDFName.of('FontFile3'))).toBe(true);
        }
    const unused = vi.fn();
    expect(await embedPdfSourceFonts(pinned, unused)).toBe(pinned);
    expect(unused).not.toHaveBeenCalled();
    if (process.env.NATIVE_FIDELITY_ARTIFACTS) {
        await mkdir(process.env.NATIVE_FIDELITY_ARTIFACTS, { recursive: true });
        await writeFile(join(process.env.NATIVE_FIDELITY_ARTIFACTS, 'standard-fonts-original.pdf'), original);
        await writeFile(join(process.env.NATIVE_FIDELITY_ARTIFACTS, 'standard-fonts-embedded.pdf'), pinned);
    }
});
it('keeps the original input when no resolver supplies a missing font', async () => {
    const original = await fixture();
    expect(await embedPdfSourceFonts(original, async () => undefined)).toBe(original);
});
it.each(['cff', 'truetype'] as const)('rejects malformed %s font data without changing the input', async (format) => {
    const original = await fixture(),
        before = new Uint8Array(original);
    await expect(
        embedPdfSourceFonts(original, async () => ({ format, bytes: new Uint8Array([1, 2, 3]) })),
    ).rejects.toThrow();
    expect(original).toEqual(before);
});

it.each(['WinAnsiEncoding', 'StandardEncoding', 'MacRomanEncoding', 'differences', 'implicit'])(
    'preserves %s character mappings and explicit glyph advances',
    async (encoding) => {
        const pdf = await PDFDocument.create();
        const page = pdf.addPage([400, 300]);
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        page.drawText('A B C café 123', { x: 20, y: 200, size: 20, font });
        const original = await PDFDocument.load(await pdf.save());
        const dictionary = original.context.lookup(font.ref, PDFDict);
        if (encoding === 'implicit') dictionary.delete(PDFName.of('Encoding'));
        else if (encoding === 'differences')
            dictionary.set(
                PDFName.of('Encoding'),
                original.context.obj({ BaseEncoding: 'WinAnsiEncoding', Differences: [65, 'Z', 'A', 'B'] }),
            );
        else dictionary.set(PDFName.of('Encoding'), PDFName.of(encoding));
        dictionary.set(PDFName.of('FirstChar'), PDFNumber.of(0));
        dictionary.set(PDFName.of('LastChar'), PDFNumber.of(255));
        const widths = Array.from({ length: 256 }, (_, code) => (code === 65 ? 999 : code === 32 ? 278 : 600));
        dictionary.set(PDFName.of('Widths'), original.context.obj(widths));
        const bytes = await original.save({ updateFieldAppearances: false });
        const pinned = await embedPdfSourceFonts(bytes, resolve);
        expect(await textGeometry(pinned)).toEqual(await textGeometry(bytes));
        const result = await PDFDocument.load(pinned);
        expect(
            result.context
                .lookup(font.ref, PDFDict)
                .lookup(PDFName.of('Widths'), PDFArray)
                .asArray()
                .map((value) => (value as PDFNumber).asNumber()),
        ).toEqual(widths);
    },
);

it.each(['MacRomanEncoding', 'MacExpertEncoding', 'StandardEncoding'])(
    'preserves implicit standard-font widths with %s',
    async (encoding) => {
        const pdf = await PDFDocument.create();
        const page = pdf.addPage([400, 300]);
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        page.drawText('AV To 123', { x: 20, y: 200, size: 20, font });
        const original = await PDFDocument.load(await pdf.save());
        original.context.lookup(font.ref, PDFDict).set(PDFName.of('Encoding'), PDFName.of(encoding));
        const bytes = await original.save({ updateFieldAppearances: false });
        const pinned = await embedPdfSourceFonts(bytes, resolve);
        expect(await textGeometry(pinned)).toEqual(await textGeometry(bytes));
    },
);

it('preserves all byte-code advances and copy text for proportional, fixed and symbolic faces', async () => {
    const pdf = await PDFDocument.create();
    for (const name of [
        StandardFonts.Helvetica,
        StandardFonts.Courier,
        StandardFonts.Symbol,
        StandardFonts.ZapfDingbats,
    ]) {
        const page = pdf.addPage([500, 700]);
        const font = await pdf.embedFont(name);
        page.node.set(PDFName.of('Resources'), pdf.context.obj({ Font: { F0: font.ref } }));
        const lines = Array.from({ length: 16 }, (_, line) => {
            const hex = Array.from({ length: 16 }, (_, column) =>
                (line * 16 + column).toString(16).padStart(2, '0'),
            ).join('');
            return `BT /F0 14 Tf 1 0 0 1 20 ${650 - line * 35} Tm <${hex}> Tj ET`;
        });
        page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(lines.join('\n'))));
    }
    const original = await pdf.save();
    const pinned = await embedPdfSourceFonts(original, resolve);
    expect(await textGeometry(pinned)).toEqual(await textGeometry(original));
});
it('preserves MissingWidth for codes outside an explicit widths array', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([400, 300]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText('AZZ', { x: 20, y: 200, size: 20, font });
    const source = await PDFDocument.load(await pdf.save());
    const dictionary = source.context.lookup(font.ref, PDFDict);
    dictionary.set(PDFName.of('FirstChar'), PDFNumber.of(65));
    dictionary.set(PDFName.of('LastChar'), PDFNumber.of(65));
    dictionary.set(PDFName.of('Widths'), source.context.obj([667]));
    dictionary.set(
        PDFName.of('FontDescriptor'),
        source.context.register(
            source.context.obj({
                Type: 'FontDescriptor',
                FontName: 'Helvetica',
                Flags: 32,
                FontBBox: [-200, -200, 1000, 1000],
                Ascent: 800,
                Descent: -200,
                ItalicAngle: 0,
                CapHeight: 700,
                StemV: 80,
                MissingWidth: 777,
            }),
        ),
    );
    const original = await source.save({ updateFieldAppearances: false });
    const pinned = await embedPdfSourceFonts(original, resolve);
    expect(await textGeometry(pinned)).toEqual(await textGeometry(original));
});
