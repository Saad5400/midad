import type { NativeNode } from '../document/model.js';
import { point } from '../typography/metrics.js';
import { flowTracks, shiftBand, type Band } from './bands.js';
import type { LayoutContext, MeasureBlocks } from './context.js';
import { fitWidths, minimumWidth } from './intrinsic.js';

export function parallelBands(node: NativeNode, width: number, ctx: LayoutContext, blocks: MeasureBlocks): Band[] {
    const cells = node.children ?? [];
    const show = node.attributes?.show;
    if (show)
        return cells
            .filter((cell) => show === 'all' || cell.attributes?.lang === show)
            .flatMap((cell) => blocks([cell], width, ctx));
    const gap = node.attributes?.gap === 'lg' ? 18 : 9;
    const widths = cells.map((_, index) =>
        cells.length === 2 && node.attributes?.widths === 'narrow-start'
            ? index === 0
                ? 1
                : 2
            : cells.length === 2 && node.attributes?.widths === 'narrow-end'
              ? index === 0
                  ? 2
                  : 1
              : 1,
    );
    const available = width - Math.max(0, cells.length - 1) * gap;
    const fitted = fitWidths(
        available,
        widths,
        cells.map((cell) => minimumWidth(cell, ctx)),
    );
    const rtl = ctx.direction === 'rtl';
    let x = rtl ? width : 0;
    const measured = cells.map((cell, index) => {
        const cellWidth = fitted[index];
        if (rtl) x -= cellWidth;
        const entry = { id: cell.id, x: point(x), width: point(cellWidth), bands: blocks([cell], cellWidth, ctx) };
        x += rtl ? -gap : cellWidth + gap;
        return entry;
    });
    const naturalHeight = point(
        Math.max(0, ...measured.map((cell) => cell.bands.reduce((sum, band) => sum + band.height, 0))),
    );
    const compose = (tracks: readonly (readonly Band[])[]): Band => {
        const height = point(Math.max(0, ...tracks.map((bands) => bands.reduce((sum, band) => sum + band.height, 0))));
        const result: Band = {
            height,
            commands: [],
            lines: [],
            cells: [],
            columns: [],
            keepNext: tracks.some((bands) => bands.at(-1)?.keepNext),
        };
        for (const [index, cell] of measured.entries()) {
            result.columns!.push({ id: cell.id, x: cell.x, y: 0, width: cell.width, height });
            let y = 0;
            for (const band of tracks[index]) {
                const shifted = shiftBand(band, cell.x, y);
                result.commands.push(...shifted.commands);
                result.lines.push(
                    ...shifted.lines.map((line) => ({
                        ...line,
                        columnIds: Object.freeze([...(line.columnIds ?? []), cell.id]),
                    })),
                );
                result.cells!.push(...(shifted.cells ?? []));
                result.columns!.push(...(shifted.columns ?? []));
                y = point(y + band.height);
            }
        }
        if (node.attributes?.divider !== false)
            for (const cell of measured.slice(0, -1)) {
                const x = rtl ? cell.x - gap / 2 : cell.x + cell.width + gap / 2;
                result.commands.push({
                    kind: 'line',
                    x,
                    y: 0,
                    toX: x,
                    toY: height,
                    width: 0.5,
                    color: [0.7, 0.7, 0.7, 1],
                });
            }
        return result;
    };
    const tracks = measured.map((cell) => cell.bands);
    return [naturalHeight <= ctx.availableHeight ? compose(tracks) : flowTracks(tracks, ctx.availableHeight, compose)];
}
