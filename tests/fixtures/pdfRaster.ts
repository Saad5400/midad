import type { DocumentScene, GlyphCommand } from '@saad5400/midad/layout';
import { paintPage, type NativeTextKernel } from '@saad5400/midad/rendering';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

export interface RasterPage {
    width: number;
    height: number;
    pixels: Uint8Array;
}

export interface GlyphRegion {
    x: number;
    y: number;
    width: number;
    height: number;
    mapped: boolean;
}

function cornerBlend(color: Uint8Array, colors: number[][]): boolean {
    for (let a = 0; a < colors.length; a++)
        for (let b = a + 1; b < colors.length; b++) {
            const delta = colors[b].map((value, channel) => value - colors[a][channel]);
            const squared = delta.reduce((sum, value) => sum + value * value, 0);
            if (!squared) continue;
            const projected =
                delta.reduce((sum, value, channel) => sum + value * (color[channel] - colors[a][channel]), 0) / squared;
            const coverage = Math.max(0, Math.min(1, projected));
            if (color.every((value, channel) => Math.abs(value - colors[a][channel] - coverage * delta[channel]) <= 2))
                return true;
        }
    for (let a = 0; a < colors.length; a++)
        for (let b = a + 1; b < colors.length; b++)
            for (let c = b + 1; c < colors.length; c++) {
                const origin = colors[a];
                const u = colors[b].map((value, channel) => value - origin[channel]);
                const v = colors[c].map((value, channel) => value - origin[channel]);
                const p = Array.from(color, (value, channel) => value - origin[channel]);
                const dot = (left: number[], right: number[]) =>
                    left.reduce((sum, value, i) => sum + value * right[i], 0);
                const uu = dot(u, u),
                    uv = dot(u, v),
                    vv = dot(v, v),
                    pu = dot(p, u),
                    pv = dot(p, v);
                const determinant = uu * vv - uv * uv;
                if (!determinant) continue;
                const x = (pu * vv - pv * uv) / determinant;
                const y = (pv * uu - pu * uv) / determinant;
                if (x < 0 || y < 0 || x + y > 1) continue;
                if (
                    color.every(
                        (value, channel) => Math.abs(value - origin[channel] - x * u[channel] - y * v[channel]) <= 2,
                    )
                )
                    return true;
            }
    return false;
}

export function comparePaintedRasters(editor: RasterPage, pdf: RasterPage, textRegions: readonly GlyphRegion[] = []) {
    if (editor.width !== pdf.width || editor.height !== pdf.height) throw new Error('PDF raster page size differs');
    const textMask = new Uint8Array(editor.width * editor.height);
    for (const region of textRegions) {
        const left = Math.max(0, Math.floor(region.x * 4) - 1);
        const right = Math.min(editor.width, Math.ceil((region.x + region.width) * 4) + 1);
        const top = Math.max(0, Math.floor(region.y * 4) - 1);
        const bottom = Math.min(editor.height, Math.ceil((region.y + region.height) * 4) + 1);
        for (let y = top; y < bottom; y++) textMask.fill(1, y * editor.width + left, y * editor.width + right);
    }
    const failures: Array<{ x: number; y: number; side: 'editor' | 'pdf' }> = [];
    let mismatched = 0;
    const matches = (source: RasterPage, target: RasterPage, x: number, y: number) => {
        const at = (y * source.width + x) * 4;
        const color = source.pixels.subarray(at, at + 3);
        if (color.every((value) => value >= 253)) return true;
        let darkest = -1,
            lightest = -1,
            minimum = Infinity,
            maximum = -Infinity;
        const neighbors: number[][] = [];
        for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
                const tx = x + dx,
                    ty = y + dy;
                if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue;
                const other = (ty * target.width + tx) * 4;
                const neighbor = Array.from(target.pixels.subarray(other, other + 3));
                if (!neighbors.some((existing) => existing.every((value, channel) => value === neighbor[channel])))
                    neighbors.push(neighbor);
                if (color.every((value, channel) => Math.abs(value - target.pixels[other + channel]) <= 2)) return true;
                const luminance =
                    target.pixels[other] * 299 + target.pixels[other + 1] * 587 + target.pixels[other + 2] * 114;
                if (luminance < minimum) {
                    minimum = luminance;
                    darkest = other;
                }
                if (luminance > maximum) {
                    maximum = luminance;
                    lightest = other;
                }
            }
        if (maximum === minimum) return false;
        const luminance = color[0] * 299 + color[1] * 587 + color[2] * 114;
        const coverage = Math.max(0, Math.min(1, (luminance - minimum) / (maximum - minimum)));
        return (
            color.every(
                (value, channel) =>
                    Math.abs(
                        value -
                            (target.pixels[darkest + channel] * (1 - coverage) +
                                target.pixels[lightest + channel] * coverage),
                    ) <= 2,
            ) || cornerBlend(color, neighbors)
        );
    };
    for (let y = 0; y < editor.height; y++)
        for (let x = 0; x < editor.width; x++) {
            if (textMask[y * editor.width + x]) continue;
            const at = (y * editor.width + x) * 4;
            if (
                editor.pixels[at] === pdf.pixels[at] &&
                editor.pixels[at + 1] === pdf.pixels[at + 1] &&
                editor.pixels[at + 2] === pdf.pixels[at + 2]
            )
                continue;
            for (const [source, target, side] of [
                [editor, pdf, 'editor'],
                [pdf, editor, 'pdf'],
            ] as const) {
                if (!matches(source, target, x, y)) {
                    mismatched++;
                    if (failures.length < 10) failures.push({ x, y, side });
                }
            }
        }
    return { mismatched, failures };
}

export function glyphRegions(page: DocumentScene['pages'][number], kernel: NativeTextKernel): GlyphRegion[] {
    return page.commands
        .filter((command): command is GlyphCommand => 'glyphs' in command)
        .flatMap((command) => {
            const font = new kernel.ck.Font(kernel.font(command.fontId).typeface, command.size);
            try {
                font.setHinting(kernel.ck.FontHinting.None);
                if (command.fauxItalic) font.setSkewX(-0.25);
                const bounds = font.getGlyphBounds(new Uint16Array(command.glyphs));
                const stroke = command.fauxBold ? command.size / 70 : 0;
                return command.glyphs.flatMap((_, index) => {
                    const [left, top, right, bottom] = Array.from(bounds.slice(index * 4, index * 4 + 4));
                    return right > left && bottom > top
                        ? [
                              {
                                  mapped: !!command.text[index],
                                  x: command.positions[index * 2] + left - stroke,
                                  y: command.positions[index * 2 + 1] + top - stroke,
                                  width: right - left + stroke * 2,
                                  height: bottom - top + stroke * 2,
                              },
                          ]
                        : [];
                });
            } finally {
                font.delete();
            }
        });
}

function decodeRaster(bytes: Uint8Array, kernel: NativeTextKernel): RasterPage {
    const image = kernel.ck.MakeImageFromEncoded(bytes);
    if (!image) throw new Error('Cannot decode fidelity raster');
    try {
        const width = image.width(),
            height = image.height();
        const pixels = image.readPixels(0, 0, {
            width,
            height,
            colorType: kernel.ck.ColorType.RGBA_8888,
            alphaType: kernel.ck.AlphaType.Unpremul,
            colorSpace: kernel.ck.ColorSpace.SRGB,
        });
        if (!(pixels instanceof Uint8Array)) throw new Error('Cannot read fidelity pixels');
        return { width, height, pixels: Uint8Array.from(pixels) };
    } finally {
        image.delete();
    }
}

export async function compareScenePdfRaster(
    scene: DocumentScene,
    kernel: NativeTextKernel,
    bytes: Uint8Array,
    name = 'document',
) {
    const output = await mkdtemp(join(tmpdir(), 'midad-pdf-raster-'));
    try {
        const input = join(output, 'document.pdf');
        await writeFile(input, bytes);
        const diagnostics = process.env.NATIVE_FIDELITY_ARTIFACTS;
        if (diagnostics) {
            await mkdir(diagnostics, { recursive: true });
            await writeFile(join(diagnostics, `${name}-raster-source.pdf`), bytes);
        }
        await promisify(execFile)('pdftocairo', ['-png', '-r', '288', input, join(output, 'page')], { timeout: 60000 });
        const files = (await readdir(output))
            .filter((file) => /^page-\d+\.png$/.test(file))
            .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
        if (files.length !== scene.pages.length) throw new Error('PDF raster page count differs');
        const result = [];
        for (const [index, page] of scene.pages.entries()) {
            const surface = kernel.ck.MakeSurface(Math.ceil(page.width * 4), Math.ceil(page.height * 4));
            if (!surface) throw new Error('Cannot render fidelity page');
            try {
                paintPage(kernel, surface, page, 4);
                const snapshot = surface.makeImageSnapshot();
                let editor: RasterPage;
                try {
                    const png = snapshot.encodeToBytes();
                    if (!png) throw new Error('Cannot encode fidelity page');
                    editor = decodeRaster(png, kernel);
                    if (diagnostics) await writeFile(join(diagnostics, `${name}-raster-canvas-${index + 1}.png`), png);
                } finally {
                    snapshot.delete();
                }
                const png = await readFile(join(output, files[index]));
                const pdf = decodeRaster(png, kernel);
                if (diagnostics) await writeFile(join(diagnostics, `${name}-raster-pdf-${index + 1}.png`), png);
                result.push({
                    page: index + 1,
                    glyphs: compareGlyphRasters(editor, pdf, glyphRegions(page, kernel), 4),
                    paint: comparePaintedRasters(editor, pdf, glyphRegions(page, kernel)),
                });
            } finally {
                surface.delete();
            }
        }
        return result;
    } finally {
        await rm(output, { recursive: true, force: true });
    }
}

function ink(page: RasterPage, x: number, y: number, threshold = 128): boolean {
    if (x < 0 || y < 0 || x >= page.width || y >= page.height) return false;
    const at = (y * page.width + x) * 4;
    return page.pixels[at] * 299 + page.pixels[at + 1] * 587 + page.pixels[at + 2] * 114 < threshold * 1000;
}

function nearby(page: RasterPage, x: number, y: number, radius: number): boolean {
    for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) if (ink(page, x + dx, y + dy, 250)) return true;
    return false;
}

export function compareGlyphRasters(
    editor: RasterPage,
    pdf: RasterPage,
    glyphs: readonly GlyphRegion[],
    scale: number,
) {
    if (editor.width !== pdf.width || editor.height !== pdf.height) throw new Error('PDF raster page size differs');
    if (scale !== 4) throw new Error('Fidelity comparison requires 288 DPI');
    const failures: Array<{
        index: number;
        mapped: boolean;
        editorInk: number;
        pdfInk: number;
        editorMissing: number;
        pdfMissing: number;
    }> = [];
    for (const [index, glyph] of glyphs.entries()) {
        const left = Math.max(0, Math.floor(glyph.x * scale) - scale),
            top = Math.max(0, Math.floor(glyph.y * scale) - scale);
        const right = Math.min(editor.width, Math.ceil((glyph.x + glyph.width) * scale) + scale),
            bottom = Math.min(editor.height, Math.ceil((glyph.y + glyph.height) * scale) + scale);
        let editorInk = 0,
            pdfInk = 0,
            editorMissing = 0,
            pdfMissing = 0;
        for (let y = top; y < bottom; y++)
            for (let x = left; x < right; x++) {
                if (ink(editor, x, y)) {
                    editorInk++;
                    if (!nearby(pdf, x, y, 1)) editorMissing++;
                }
                if (ink(pdf, x, y)) {
                    pdfInk++;
                    if (!nearby(editor, x, y, 1)) pdfMissing++;
                }
            }
        if (!editorInk || !pdfInk || editorMissing || pdfMissing)
            failures.push({ index, mapped: glyph.mapped, editorInk, pdfInk, editorMissing, pdfMissing });
    }
    return failures;
}
