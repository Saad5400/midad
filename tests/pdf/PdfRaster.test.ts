// @vitest-environment node
import { compareGlyphRasters, comparePaintedRasters, type GlyphRegion, type RasterPage } from '../fixtures/pdfRaster';
import { describe, expect, it } from 'vitest';

function sample(offset = 0): RasterPage {
    const pixels = new Uint8Array(32 * 32 * 4).fill(255);
    for (let y = 8; y < 20; y++)
        for (let x = 8 + offset; x < 12 + offset; x++) pixels.fill(0, (y * 32 + x) * 4, (y * 32 + x) * 4 + 3);
    return { width: 32, height: 32, pixels };
}
const region: GlyphRegion = { x: 2, y: 2, width: 1, height: 3, mapped: false };
describe('independent PDF raster comparison', () => {
    it('matches identical ink including glyphs without a text mapping', () => {
        expect(compareGlyphRasters(sample(), sample(), [region], 4)).toEqual([]);
    });
    it('allows one raster pixel while retaining exact coordinate checks separately', () => {
        expect(compareGlyphRasters(sample(), sample(1), [region], 4)).toEqual([]);
    });
    it('rejects a one-point displacement', () => {
        expect(compareGlyphRasters(sample(), sample(4), [region], 4)).toHaveLength(1);
    });
    it('rejects a missing unmapped glyph', () => {
        expect(
            compareGlyphRasters(sample(), { ...sample(), pixels: new Uint8Array(32 * 32 * 4).fill(255) }, [region], 4),
        ).toHaveLength(1);
    });
    it('rejects missing ink in the editor as well as the PDF', () => {
        expect(
            compareGlyphRasters({ ...sample(), pixels: new Uint8Array(32 * 32 * 4).fill(255) }, sample(), [region], 4),
        ).toHaveLength(1);
    });
    it('rejects changed page dimensions', () => {
        expect(() => compareGlyphRasters(sample(), { ...sample(), width: 31 }, [region], 4)).toThrow('page size');
    });
    it('accepts a core pixel next to the other rasterizer’s antialiased edge', () => {
        const editor = sample();
        const pdf = sample();
        editor.pixels.fill(137, (10 * 32 + 8) * 4, (10 * 32 + 8) * 4 + 3);
        pdf.pixels.fill(113, (10 * 32 + 7) * 4, (10 * 32 + 7) * 4 + 3);
        expect(compareGlyphRasters(editor, pdf, [region], 4)).toEqual([]);
    });
    const colored = (color: [number, number, number], offset = 0): RasterPage => {
        const page = sample(offset);
        for (let at = 0; at < page.pixels.length; at += 4) {
            if (page.pixels[at] === 0) page.pixels.set(color, at);
        }
        return page;
    };
    it('compares colored content outside all glyph regions', () => {
        expect(comparePaintedRasters(colored([230, 240, 250]), colored([230, 240, 250])).mismatched).toBe(0);
    });
    it('rejects missing light table fills that a black-ink comparison cannot see', () => {
        const blank = { ...sample(), pixels: new Uint8Array(32 * 32 * 4).fill(255) };
        expect(comparePaintedRasters(colored([230, 240, 250]), blank).mismatched).toBeGreaterThan(0);
    });
    it('rejects changed image colors with similar brightness', () => {
        expect(comparePaintedRasters(colored([255, 0, 0]), colored([0, 130, 0])).mismatched).toBeGreaterThan(0);
    });
    it('rejects unexpected PDF paint as well as missing PDF paint', () => {
        const blank = { ...sample(), pixels: new Uint8Array(32 * 32 * 4).fill(255) };
        expect(comparePaintedRasters(blank, colored([230, 240, 250])).mismatched).toBeGreaterThan(0);
    });
    it('detects displaced borders independently of text', () => {
        expect(comparePaintedRasters(colored([10, 30, 200]), colored([10, 30, 200], 4)).mismatched).toBeGreaterThan(0);
    });
    it('allows different coverage shades along the same antialiased shape edge', () => {
        const editor = sample();
        const pdf = sample();
        for (let y = 8; y < 20; y++) {
            editor.pixels.fill(150, (y * 32 + 8) * 4, (y * 32 + 8) * 4 + 3);
            pdf.pixels.fill(100, (y * 32 + 8) * 4, (y * 32 + 8) * 4 + 3);
        }
        expect(comparePaintedRasters(editor, pdf).mismatched).toBe(0);
    });
    it('checks image paint even when separate glyph regions are masked', () => {
        const blank = { ...sample(), pixels: new Uint8Array(32 * 32 * 4).fill(255) };
        const otherText: GlyphRegion = { x: 6, y: 6, width: 1, height: 1, mapped: true };
        expect(comparePaintedRasters(colored([230, 240, 250]), blank, [otherText]).mismatched).toBeGreaterThan(0);
    });
});
