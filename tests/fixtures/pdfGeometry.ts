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
import { compareScenePdfRaster, glyphRegions } from './pdfRaster';

type GlyphPlacement =
    | { kind: 'glyph'; glyph: number; x: number; y: number; skew: number; color: number[] }
    | { kind: 'path'; x: number; y: number; color: number[] };
function renderedGlyphs(pdf: PDFDocument, page: PDFPage): GlyphPlacement[] {
    const streams = page.node.Contents() as PDFArray;
    let instructions = '';
    for (let index = 0; index < streams.size(); index++) {
        const stream = pdf.context.lookup(streams.get(index));
        if (!(stream instanceof PDFRawStream)) throw new Error('Expected a PDF content stream');
        instructions += new TextDecoder().decode(decodePDFRawStream(stream).decode());
    }
    const fonts = page.node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
    let map: Uint8Array | undefined;
    let color = [0, 0, 0];
    const result: GlyphPlacement[] = [];
    for (const match of instructions.matchAll(
        /\/([^\s/]+) [\d.]+ Tf|1 0 ([\d.\-]+) 1 ([\d.\-]+) ([\d.\-]+) Tm\s*<([0-9a-f]+)> Tj|ET q [\d.\-]+ 0 0 [\d.\-]+ ([\d.\-]+) ([\d.\-]+) cm|([\d.\-]+) ([\d.\-]+) ([\d.\-]+) rg/g,
    )) {
        if (match[8] !== undefined) {
            color = match.slice(8, 11).map(Number);
        } else if (match[1]) {
            const font = fonts.lookup(PDFName.of(match[1]), PDFDict);
            const descendant = font.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
            const encoding = descendant.lookup(PDFName.of('CIDToGIDMap'));
            map = encoding instanceof PDFRawStream ? decodePDFRawStream(encoding).decode() : undefined;
        } else if (match[6] !== undefined) {
            result.push({ kind: 'path', x: Number(match[6]), y: Number(match[7]), color: [...color] });
        } else {
            const code = parseInt(match[5], 16);
            result.push({
                kind: 'glyph',
                color: [...color],
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
                command.glyphs.map(
                    (glyph, at): GlyphPlacement =>
                        command.text[at]
                            ? {
                                  kind: 'glyph',
                                  color: (command.color ?? [0, 0, 0, 1]).slice(0, 3),
                                  glyph,
                                  x: command.positions[at * 2],
                                  y: page.height - command.positions[at * 2 + 1],
                                  skew: command.fauxItalic ? 0.25 : 0,
                              }
                            : {
                                  kind: 'path',
                                  color: (command.color ?? [0, 0, 0, 1]).slice(0, 3),
                                  x: command.positions[at * 2],
                                  y: page.height - command.positions[at * 2 + 1],
                              },
                ),
            );
        expect(renderedGlyphs(pdf, pdf.getPage(index))).toEqual(expected);
    }
    if (process.env.NATIVE_PDF_RASTER === '1') {
        const comparison = await compareScenePdfRaster(scene, kernel, bytes, name);
        expect(
            comparison.flatMap((page) => page.glyphs),
            name,
        ).toEqual([]);
        expect(
            comparison.filter((page) => page.paint.mismatched),
            name,
        ).toEqual([]);
    }
    const output = process.env.NATIVE_FIDELITY_ARTIFACTS;
    if (!output) return;
    const scale = Number(process.env.NATIVE_FIDELITY_SCALE ?? 1);
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThanOrEqual(4);
    await mkdir(output, { recursive: true });
    await writeFile(join(output, `${name}.pdf`), bytes);
    const pageGeometry = scene.pages.map((page) => ({
        width: page.width,
        height: page.height,
        glyphs: glyphRegions(page, kernel),
    }));
    await writeFile(
        join(output, `${name}.json`),
        JSON.stringify({
            exportMs,
            pages: scene.pages.length,
            exactGlyphCoordinates: true,
            canvasScale: scale,
            pageGeometry,
        }),
    );
    for (const [index, page] of scene.pages.entries()) {
        const surface = kernel.ck.MakeSurface(Math.ceil(page.width * scale), Math.ceil(page.height * scale));
        if (!surface) throw new Error('Cannot render fidelity page');
        try {
            paintPage(kernel, surface, page, scale);
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

export async function writeRasterCanaries(
    document: NativeDocument,
    scene: DocumentScene,
    kernel: NativeTextKernel,
    name: string,
): Promise<void> {
    const output = process.env.NATIVE_FIDELITY_ARTIFACTS;
    const live = process.env.NATIVE_PDF_RASTER === '1';
    if (!live && (!output || process.env.NATIVE_FIDELITY_CANARIES !== '1')) return;
    const missing = scene.pages.map((page) => ({
        ...page,
        commands: page.commands.map((command) => {
            if (!('glyphs' in command)) return command;
            const indices = command.glyphs.flatMap((_, index) => (command.text[index] ? [index] : []));
            return {
                ...command,
                glyphs: indices.map((index) => command.glyphs[index]),
                positions: indices.flatMap((index) => command.positions.slice(index * 2, index * 2 + 2)),
                text: indices.map((index) => command.text[index]),
                reading: undefined,
            };
        }),
    }));
    const shifted = scene.pages.map((page, pageIndex) => {
        const footer = page.commands.findLastIndex((command) => 'glyphs' in command);
        const command = page.commands[footer] as GlyphCommand;
        expect(command.text.join('')).toBe(String(pageIndex + 1));
        return {
            ...page,
            commands: page.commands.map((command, index) =>
                index === footer && 'glyphs' in command
                    ? {
                          ...command,
                          positions: command.positions.map((value, at) => (at % 2 === 0 ? value + 1 : value)),
                      }
                    : command,
            ),
        };
    });
    for (const [suffix, pages] of [
        ['missing-glyphs', missing],
        ['shifted-number', shifted],
    ] as const) {
        const bytes = await writeScenePdf({ ...scene, pages }, kernel, () => document, {
            compress: (value) => new Uint8Array(deflateSync(value)),
            objectsPerTick: 100000,
        });
        if (live) {
            const comparison = await compareScenePdfRaster(scene, kernel, bytes, `${name}-canary-${suffix}`);
            expect(comparison.flatMap((page) => page.glyphs).length, `${name}: ${suffix}`).toBeGreaterThan(0);
        }
        if (output) await writeFile(join(output, `${name}-canary-${suffix}.pdf`), bytes);
    }
}
