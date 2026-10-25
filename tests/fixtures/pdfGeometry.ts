import type { NativeDocument } from '@saad5400/midad/document';
import type { DocumentScene, GlyphCommand } from '@saad5400/midad/layout';
import { writeScenePdf } from '@saad5400/midad/pdf';
import type { NativeTextKernel } from '@saad5400/midad/rendering';
import { paintPage } from '@saad5400/midad/rendering';
import { deepStrictEqual } from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
    PDFArray,
    PDFDict,
    PDFDocument,
    PDFName,
    PDFNumber,
    PDFRawStream,
    decodePDFRawStream,
    type PDFPage,
} from 'pdf-lib';
import { expect } from 'vitest';
import { compareScenePdfRaster, glyphRegions } from './pdfRaster';

type GlyphPlacement =
    | { kind: 'glyph'; glyph: number; x: number; y: number; skew: number; color: number[] }
    | { kind: 'path'; x: number; y: number; color: number[] };
const fontMetrics = new WeakMap<PDFDict, { map?: Uint8Array; widths: ReadonlyMap<number, number> }>();
function pdfFontMetrics(font: PDFDict): { map?: Uint8Array; widths: ReadonlyMap<number, number> } {
    const cached = fontMetrics.get(font);
    if (cached) return cached;
    const descendant = font.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
    const encoding = descendant.lookup(PDFName.of('CIDToGIDMap'));
    const map = encoding instanceof PDFRawStream ? decodePDFRawStream(encoding).decode() : undefined;
    const widths = new Map<number, number>();
    const table = descendant.lookup(PDFName.of('W'), PDFArray);
    for (let index = 0; index < table.size(); ) {
        const first = table.lookup(index++, PDFNumber).asNumber();
        const next = table.lookup(index++);
        if (next instanceof PDFArray)
            for (let at = 0; at < next.size(); at++) widths.set(first + at, next.lookup(at, PDFNumber).asNumber());
        else {
            if (!(next instanceof PDFNumber)) throw new Error('Invalid PDF width table');
            const width = table.lookup(index++, PDFNumber).asNumber();
            for (let code = first; code <= next.asNumber(); code++) widths.set(code, width);
        }
    }
    const result = { map, widths };
    fontMetrics.set(font, result);
    return result;
}
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
    let fontSize = 0,
        x = 0,
        y = 0,
        lineX = 0,
        lineY = 0,
        skew = 0;
    let widths: ReadonlyMap<number, number> = new Map();
    let color = [0, 0, 0];
    const result: GlyphPlacement[] = [];
    for (const match of instructions.matchAll(
        /\/(?<font>[^\s/]+) (?<size>[\d.]+) Tf|1 0 (?<skew>[\d.\-]+) 1 (?<x>[\d.\-]+) (?<y>[\d.\-]+) Tm|(?<dx>[\d.\-]+) (?<dy>[\d.\-]+) Td|<(?<code>[0-9a-f]+)> Tj|ET q [\d.\-]+ 0 0 [\d.\-]+ (?<pathX>[\d.\-]+) (?<pathY>[\d.\-]+) cm|(?<r>[\d.\-]+) (?<g>[\d.\-]+) (?<b>[\d.\-]+) rg|\b(?<begin>BT)\b/g,
    )) {
        const part = match.groups!;
        if (part.r !== undefined) {
            color = [part.r, part.g, part.b].map(Number);
        } else if (part.font) {
            const font = fonts.lookup(PDFName.of(part.font), PDFDict);
            fontSize = Number(part.size);
            const metrics = pdfFontMetrics(font);
            map = metrics.map;
            widths = metrics.widths;
        } else if (part.pathX !== undefined) {
            result.push({ kind: 'path', x: Number(part.pathX), y: Number(part.pathY), color: [...color] });
        } else if (part.begin) {
            x = y = lineX = lineY = skew = 0;
        } else if (part.x !== undefined) {
            x = lineX = Number(part.x);
            y = lineY = Number(part.y);
            skew = Number(part.skew);
        } else if (part.dx !== undefined) {
            lineX += Number(part.dx) + skew * Number(part.dy);
            lineY += Number(part.dy);
            x = lineX;
            y = lineY;
        } else if (part.code) {
            for (let at = 0; at < part.code.length; at += 4) {
                const code = parseInt(part.code.slice(at, at + 4), 16);
                result.push({
                    kind: 'glyph',
                    color: [...color],
                    glyph: map ? (map[code * 2] << 8) | map[code * 2 + 1] : code,
                    skew,
                    x,
                    y,
                });
                x += ((widths.get(code) ?? 1000) * fontSize) / 1000;
            }
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
    if (process.env.NATIVE_PERF_PROFILE === '1') console.log(JSON.stringify({ workload: name, exportMs }));
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
        deepStrictEqual(
            renderedGlyphs(pdf, pdf.getPage(index)),
            expected,
            `${name}: page ${index + 1} glyph placements`,
        );
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
