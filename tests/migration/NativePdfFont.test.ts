// @vitest-environment node
import { NativePdfFont } from '@saad5400/midad/pdfFont';
import { readFile } from 'node:fs/promises';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

describe('native PDF font encoding', () => {
    it('maps contextual glyph variants and complete Unicode clusters without reshaping', async () => {
        const bytes = new Uint8Array(await readFile('assets/fonts/amiri.ttf'));
        const font = await NativePdfFont.create(bytes, [
            { glyph: 6631, text: 'ffi' },
            { glyph: 6631, text: '\uFB03' },
            { glyph: 6631, text: '\u{1F600}' },
            { glyph: 1678, text: 'د' },
        ]);
        const pdf = await PDFDocument.create();
        const ref = await font.embedIntoContext(pdf.context);
        const dictionary = pdf.context.lookup(ref, PDFDict);
        const cmap = dictionary.lookup(PDFName.of('ToUnicode'));
        expect(cmap).toBeInstanceOf(PDFRawStream);
        const unicode = new TextDecoder().decode(decodePDFRawStream(cmap as PDFRawStream).decode());
        expect(unicode).toContain('<19e7> <006600660069>');
        expect(unicode).toContain('<ffff> <fb03>');
        expect(unicode).toContain('<fffe> <d83dde00>');
        expect(unicode).toContain('<068e> <062f>');
        const descendant = dictionary.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
        const cidMap = descendant.lookup(PDFName.of('CIDToGIDMap')) as PDFRawStream;
        const decoded = decodePDFRawStream(cidMap).decode();
        for (const text of ['ffi', '\uFB03', '\u{1F600}']) {
            const code = font.code(6631, text);
            expect((decoded[code * 2] << 8) | decoded[code * 2 + 1]).toBe(6631);
        }
        const widths = descendant.lookup(PDFName.of('W'), PDFArray).asArray();
        expect(widths).toHaveLength(8);
        expect(() => font.code(6631, 'missing')).toThrow('not registered');
        expect((await pdf.save()).length).toBeGreaterThan(1000);
    });
});
