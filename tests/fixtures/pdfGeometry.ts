import type { NativeDocument } from '@saad5400/midad/document';
import type { NativeTextKernel } from '@saad5400/midad/rendering';
import type { DocumentScene, GlyphCommand } from '@saad5400/midad/layout';
import { paintPage } from '@saad5400/midad/rendering';
import { writeScenePdf } from '@saad5400/midad/pdf';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, type PDFPage } from 'pdf-lib';
import { expect } from 'vitest';

function renderedGlyphs(pdf: PDFDocument, page: PDFPage): Array<{ glyph: number; x: number; y: number; skew: number }> {
    const streams = page.node.Contents() as PDFArray;
    let instructions = '';
    for (let index = 0; index < streams.size(); index++) {
        const stream = pdf.context.lookup(streams.get(index));
        if (!(stream instanceof PDFRawStream)) throw new Error('Expected a PDF content stream');
        instructions += new TextDecoder().decode(decodePDFRawStream(stream).decode());
    }
    const fonts = page.node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
    let map: Uint8Array | undefined;
    const result: Array<{ glyph: number; x: number; y: number; skew: number }> = [];
    for (const match of instructions.matchAll(
        /\/([^\s/]+) [\d.]+ Tf|1 0 ([\d.\-]+) 1 ([\d.\-]+) ([\d.\-]+) Tm\s*<([0-9a-f]+)> Tj/g,
    )) {
        if (match[1]) {
            const font = fonts.lookup(PDFName.of(match[1]), PDFDict);
            const descendant = font.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
            const encoding = descendant.lookup(PDFName.of('CIDToGIDMap'));
            map = encoding instanceof PDFRawStream ? decodePDFRawStream(encoding).decode() : undefined;
        } else {
            const code = parseInt(match[5], 16);
            result.push({
                glyph: map ? (map[code * 2] << 8) | map[code * 2 + 1] : code,
                skew: Number(match[2]),
                x: Number(match[3]),
                y: Number(match[4]),
            });
        }
    }
    return result;
}

export async function verifyScenePdf(
    document: NativeDocument,
    scene: DocumentScene,
    kernel: NativeTextKernel,
    name: string,
): Promise<void> {
    const started = performance.now();
    const bytes = await writeScenePdf(scene, kernel, () => document, {
        compress: (value) => new Uint8Array(deflateSync(value)),
        objectsPerTick: 100000,
    });
    const exportMs = performance.now() - started;
    expect(exportMs).toBeLessThan(5000);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(scene.pages.length);
    for (const [index, page] of scene.pages.entries()) {
        expect(pdf.getPage(index).getSize()).toEqual({ width: page.width, height: page.height });
        const expected = page.commands
            .filter((command): command is GlyphCommand => 'glyphs' in command)
            .flatMap((command) =>
                command.glyphs.flatMap((glyph, at) =>
                    command.text[at]
                        ? [
                              {
                                  glyph,
                                  x: command.positions[at * 2],
                                  y: page.height - command.positions[at * 2 + 1],
                                  skew: command.fauxItalic ? 0.25 : 0,
                              },
                          ]
                        : [],
                ),
            );
        expect(renderedGlyphs(pdf, pdf.getPage(index))).toEqual(expected);
    }
    const output = process.env.NATIVE_FIDELITY_ARTIFACTS;
    if (!output) return;
    await mkdir(output, { recursive: true });
    await writeFile(join(output, `${name}.pdf`), bytes);
    await writeFile(
        join(output, `${name}.json`),
        JSON.stringify({ exportMs, pages: scene.pages.length, exactGlyphCoordinates: true }),
    );
    for (const [index, page] of scene.pages.entries()) {
        const surface = kernel.ck.MakeSurface(Math.ceil(page.width), Math.ceil(page.height));
        if (!surface) throw new Error('Cannot render fidelity page');
        try {
            paintPage(kernel, surface, page, 1);
            const snapshot = surface.makeImageSnapshot();
            try {
                const png = snapshot.encodeToBytes();
                if (!png) throw new Error('Cannot encode fidelity page');
                await writeFile(join(output, `${name}-canvas-${index + 1}.png`), png);
            } finally {
                snapshot.delete();
            }
        } finally {
            surface.delete();
        }
    }
}
