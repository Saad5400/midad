import type { NativeNode } from '../document/model.js';
import { columnWeights, tableGrid } from '../editing/table-grid.js';
import { point } from '../typography/metrics.js';
import { color, type Color } from '../typography/style.js';
import { flowSpace, flowTracks, materializeBands, shiftBand, type Band } from './bands.js';
import { scope, type LayoutContext, type MeasureBlocks } from './context.js';
import { fitWidths, minimumTableColumns } from './intrinsic.js';
import { flowingTableBand } from './table-flow.js';

interface TableCell {
    node: NativeNode;
    row: number;
    column: number;
    colspan: number;
    rowspan: number;
    bands: Band[];
    start: number;
    end: number;
}
export function tableBands(node: NativeNode, width: number, ctx: LayoutContext, blocks: MeasureBlocks): Band[] {
    const grid = tableGrid(node);
    if (!grid.columns) return fragmentedTableBands(node, width, ctx, blocks);
    const weights = columnWeights(grid);
    const minimum = minimumTableColumns(node, ctx);
    const fitted = fitWidths(width, weights, minimum);
    const minimumColumnWidths =
        minimum.reduce((sum, value) => sum + value, 0) <= width ? minimum : minimum.map(() => 0);
    const edges = [0];
    for (const value of fitted) edges.push(edges.at(-1)! + value);
    const cells = grid.cells.map((cell) => ({
        ...cell,
        bands: blocks(
            cell.node.children ?? [],
            Math.max(12, edges[cell.column + cell.colspan] - edges[cell.column] - 12),
            scope(cell.node, { ...ctx, tableDepth: (ctx.tableDepth ?? 0) + 1 }),
            true,
        ),
    }));
    const rowHeights = grid.rows.map(() => 12);
    const contentHeight = (cell: (typeof cells)[number]) => cell.bands.reduce((sum, band) => sum + band.height, 0);
    for (const cell of cells)
        if (cell.rowspan === 1) rowHeights[cell.row] = Math.max(rowHeights[cell.row], contentHeight(cell) + 12);
    for (const cell of cells) {
        const height = rowHeights.slice(cell.row, cell.row + cell.rowspan).reduce((sum, height) => sum + height, 0);
        rowHeights[cell.row + cell.rowspan - 1] += Math.max(0, contentHeight(cell) + 12 - height);
    }
    const offsets = [0];
    for (const height of rowHeights) offsets.push(point(offsets.at(-1)! + height));
    const rowEnds = grid.rows.map((_, index) => index + 1);
    for (const cell of cells) rowEnds[cell.row] = Math.max(rowEnds[cell.row], cell.row + cell.rowspan);
    const rtl = ctx.direction === 'rtl';
    const border = color(node.attributes?.borderColor, [0.8, 0.8, 0.8, 1]);
    let fragmented: Band[] | undefined;
    const result: Band[] = [];
    for (let start = 0; start < grid.rows.length; ) {
        let end = start + 1;
        for (let row = start; row < end; row++) end = Math.max(end, rowEnds[row]);
        const group = cells.filter((cell) => cell.row >= start && cell.row < end);
        const height = point(offsets[end] - offsets[start]);
        if (height > ctx.availableHeight) {
            if (end === start + 1) {
                const tracks = group.map((cell) => {
                    const spare = Math.max(0, height - 12 - contentHeight(cell));
                    const alignment = cell.node.attributes?.verticalAlign;
                    const shift = alignment === 'middle' ? spare / 2 : alignment === 'bottom' ? spare : 0;
                    return [flowSpace(6 + shift), ...cell.bands, flowSpace(6 + spare - shift)];
                });
                result.push(
                    flowTracks(tracks, ctx.availableHeight, (tracks) => {
                        const height = point(
                            Math.max(0, ...tracks.map((bands) => bands.reduce((sum, band) => sum + band.height, 0))),
                        );
                        const band: Band = { height, commands: [], lines: [], cells: [], columns: [] };
                        for (const [index, cell] of group.entries()) {
                            const box = {
                                x: point(rtl ? width - edges[cell.column + cell.colspan] : edges[cell.column]),
                                y: 0,
                                width: point(edges[cell.column + cell.colspan] - edges[cell.column]),
                                height,
                            };
                            band.cells!.push({
                                ...box,
                                tableId: node.id,
                                cellId: cell.node.id,
                                tableX: 0,
                                columnEdges: edges,
                                minimumColumnWidths,
                                direction: rtl ? 'rtl' : 'ltr',
                                borderColor: border,
                                borderDepth: ctx.tableDepth ?? 0,
                            });
                            const background = cell.node.attributes?.backgroundColor
                                ? color(cell.node.attributes.backgroundColor)
                                : cell.node.kind === 'tableHeader'
                                  ? ([0.95, 0.96, 0.97, 1] as Color)
                                  : null;
                            if (background)
                                band.commands.push({
                                    kind: 'rect',
                                    ...box,
                                    color: background,
                                    tableBackground: ctx.tableDepth ?? 0,
                                });
                            for (const x of [box.x, point(box.x + box.width)])
                                band.commands.push({
                                    kind: 'line',
                                    tableBorder: ctx.tableDepth ?? 0,
                                    x,
                                    y: 0,
                                    toX: x,
                                    toY: height,
                                    width: 0.5,
                                    color: border,
                                });
                            for (const y of [0, height])
                                band.commands.push({
                                    kind: 'line',
                                    tableBorder: ctx.tableDepth ?? 0,
                                    x: box.x,
                                    y,
                                    toX: point(box.x + box.width),
                                    toY: y,
                                    width: 0.5,
                                    color: border,
                                });
                            let y = 0;
                            for (const content of tracks[index]) {
                                const shifted = shiftBand(content, box.x + 6, y);
                                band.commands.push(...shifted.commands);
                                band.lines.push(
                                    ...shifted.lines.map((line) => ({ ...line, cellId: line.cellId ?? cell.node.id })),
                                );
                                band.cells!.push(...(shifted.cells ?? []));
                                band.columns!.push(...(shifted.columns ?? []));
                                y = point(y + content.height);
                            }
                        }
                        return band;
                    }),
                );
                start = end;
                continue;
            }
            if (group.some((cell) => cell.bands.some((band) => band.split))) {
                result.push(
                    flowingTableBand(
                        node,
                        width,
                        ctx,
                        group.map((cell) => ({ ...cell, row: cell.row - start })),
                        end - start,
                        edges,
                        minimumColumnWidths,
                        height,
                    ),
                );
                start = end;
                continue;
            }
            const ids = new Set(group.map((cell) => cell.node.id));
            fragmented ??= fragmentedTableBands(node, width, ctx, blocks);
            result.push(...fragmented.filter((band) => band.cells?.some((cell) => ids.has(cell.cellId))));
            start = end;
            continue;
        }
        const band: Band = { height, commands: [], lines: [], cells: [], columns: [] };
        for (const cell of group) {
            const box = {
                x: point(rtl ? width - edges[cell.column + cell.colspan] : edges[cell.column]),
                y: point(offsets[cell.row] - offsets[start]),
                width: point(edges[cell.column + cell.colspan] - edges[cell.column]),
                height: point(offsets[cell.row + cell.rowspan] - offsets[cell.row]),
            };
            band.cells!.push({
                ...box,
                tableId: node.id,
                cellId: cell.node.id,
                tableX: 0,
                columnEdges: edges,
                minimumColumnWidths,
                direction: rtl ? 'rtl' : 'ltr',
                borderColor: border,
                borderDepth: ctx.tableDepth ?? 0,
            });
            const background = cell.node.attributes?.backgroundColor
                ? color(cell.node.attributes.backgroundColor)
                : cell.node.kind === 'tableHeader'
                  ? ([0.95, 0.96, 0.97, 1] as Color)
                  : null;
            if (background)
                band.commands.push({ kind: 'rect', ...box, color: background, tableBackground: ctx.tableDepth ?? 0 });
            for (const x of [box.x, point(box.x + box.width)])
                band.commands.push({
                    kind: 'line',
                    tableBorder: ctx.tableDepth ?? 0,
                    x,
                    y: box.y,
                    toX: x,
                    toY: point(box.y + box.height),
                    width: 0.5,
                    color: border,
                });
            for (const y of [box.y, point(box.y + box.height)])
                band.commands.push({
                    kind: 'line',
                    tableBorder: ctx.tableDepth ?? 0,
                    x: box.x,
                    y,
                    toX: point(box.x + box.width),
                    toY: y,
                    width: 0.5,
                    color: border,
                });
        }
        for (const cell of group) {
            const box = band.cells!.find((entry) => entry.cellId === cell.node.id)!;
            const spare = Math.max(0, box.height - 12 - contentHeight(cell));
            const alignment = cell.node.attributes?.verticalAlign;
            let y = box.y + 6 + (alignment === 'middle' ? spare / 2 : alignment === 'bottom' ? spare : 0);
            for (const content of cell.bands) {
                const shifted = shiftBand(content, box.x + 6, y);
                band.commands.push(...shifted.commands);
                band.lines.push(...shifted.lines.map((line) => ({ ...line, cellId: line.cellId ?? cell.node.id })));
                band.cells!.push(...(shifted.cells ?? []));
                band.columns!.push(...(shifted.columns ?? []));
                y = point(y + content.height);
            }
        }
        result.push(band);
        start = end;
    }
    return result;
}

function fragmentedTableBands(node: NativeNode, width: number, ctx: LayoutContext, blocks: MeasureBlocks): Band[] {
    const grid = tableGrid(node);
    const rows = grid.rows;
    const cells: TableCell[] = grid.cells.map((cell) => ({ ...cell, bands: [], start: 0, end: 0 }));
    const weights = columnWeights(grid);
    const minimum = minimumTableColumns(node, ctx);
    const fitted = fitWidths(width, weights, minimum);
    const minimumColumnWidths =
        minimum.reduce((sum, value) => sum + value, 0) <= width ? minimum : minimum.map(() => 0);
    const edges = [0];
    for (const value of fitted) edges.push(edges[edges.length - 1] + value);
    const rowHeights = rows.map(() => 12);
    for (const cell of cells) {
        cell.bands = materializeBands(
            blocks(
                cell.node.children ?? [],
                Math.max(12, edges[cell.column + cell.colspan] - edges[cell.column] - 12),
                scope(cell.node, { ...ctx, tableDepth: (ctx.tableDepth ?? 0) + 1 }),
                true,
            ),
            Math.max(1, ctx.availableHeight - 12),
        );
        if (cell.rowspan === 1)
            rowHeights[cell.row] = Math.max(
                rowHeights[cell.row],
                cell.bands.reduce((sum, band) => sum + band.height, 0) + 12,
            );
    }
    for (const cell of cells) {
        const available = rowHeights.slice(cell.row, cell.row + cell.rowspan).reduce((sum, item) => sum + item, 0);
        rowHeights[cell.row + cell.rowspan - 1] += Math.max(
            0,
            cell.bands.reduce((sum, band) => sum + band.height, 0) + 12 - available,
        );
    }
    const offsets = [0];
    for (const height of rowHeights) offsets.push(point(offsets.at(-1)! + height));
    const rowEnds = rows.map((_, index) => index + 1);
    for (const cell of cells) rowEnds[cell.row] = Math.max(rowEnds[cell.row], cell.row + cell.rowspan);
    const breaks = new Set<number>();
    for (let start = 0; start < rows.length; ) {
        let end = start + 1;
        for (let row = start; row < end; row++) end = Math.max(end, rowEnds[row]);
        breaks.add(offsets[end]);
        start = end;
    }
    const boundaries = new Set(offsets);
    const contents = new Map<number, Array<{ cell: TableCell; band: Band }>>();
    for (const cell of cells) {
        cell.start = offsets[cell.row];
        cell.end = offsets[cell.row + cell.rowspan];
        const room = Math.max(0, cell.end - cell.start - 12 - cell.bands.reduce((sum, band) => sum + band.height, 0));
        const alignment = cell.node.attributes?.verticalAlign;
        const shift = alignment === 'bottom' ? room : alignment === 'middle' ? room / 2 : 0;
        let at = point(cell.start + 6 + shift);
        boundaries.add(at);
        for (const band of cell.bands) {
            contents.set(at, [...(contents.get(at) ?? []), { cell, band }]);
            at = point(at + band.height);
            boundaries.add(at);
        }
    }
    const rtl = ctx.direction === 'rtl';
    const border = color(node.attributes?.borderColor, [0.8, 0.8, 0.8, 1]);
    const entering = new Map<number, TableCell[]>();
    const leaving = new Map<number, TableCell[]>();
    for (const cell of cells) {
        entering.set(cell.start, [...(entering.get(cell.start) ?? []), cell]);
        leaving.set(cell.end, [...(leaving.get(cell.end) ?? []), cell]);
    }
    const active = new Set<TableCell>();
    const positions = [...boundaries].sort((a, b) => a - b);
    return positions.slice(0, -1).map((at, index): Band => {
        for (const cell of leaving.get(at) ?? []) active.delete(cell);
        for (const cell of entering.get(at) ?? []) active.add(cell);
        const height = point(positions[index + 1] - at);
        const content = contents.get(at) ?? [];
        const result: Band = {
            height: point(height),
            commands: [],
            lines: [],
            cells: [],
            columns: [],
            minimumHeight: Math.max(height, ...content.map(({ band }) => band.minimumHeight ?? band.height)),
            keepNext: !breaks.has(positions[index + 1]),
        };
        const box = (cell: TableCell) => ({
            x: point(rtl ? width - edges[cell.column + cell.colspan] : edges[cell.column]),
            width: point(edges[cell.column + cell.colspan] - edges[cell.column]),
        });
        for (const cell of active) {
            const bounds = box(cell);
            const cellHeight = point(
                Math.min(
                    cell.end - at,
                    Math.max(height, ...content.filter((entry) => entry.cell === cell).map(({ band }) => band.height)),
                ),
            );
            result.cells!.push({
                tableId: node.id,
                cellId: cell.node.id,
                ...bounds,
                y: 0,
                height: cellHeight,
                tableX: 0,
                columnEdges: edges,
                minimumColumnWidths,
                direction: rtl ? 'rtl' : 'ltr',
                borderColor: border,
                borderDepth: ctx.tableDepth ?? 0,
            });
            const background = cell.node.attributes?.backgroundColor
                ? color(cell.node.attributes.backgroundColor)
                : cell.node.kind === 'tableHeader'
                  ? ([0.95, 0.96, 0.97, 1] as Color)
                  : null;
            if (background)
                result.commands.push({
                    kind: 'rect',
                    ...bounds,
                    y: 0,
                    height: cellHeight,
                    color: background,
                    tableBackground: ctx.tableDepth ?? 0,
                });
            for (const x of [bounds.x, point(bounds.x + bounds.width)])
                result.commands.push({
                    kind: 'line',
                    tableBorder: ctx.tableDepth ?? 0,
                    x,
                    y: 0,
                    toX: x,
                    toY: cellHeight,
                    width: 0.5,
                    color: border,
                });
            if (at === cell.start || positions[index + 1] === cell.end) {
                const y = at === cell.start ? 0 : height;
                result.commands.push({
                    kind: 'line',
                    tableBorder: ctx.tableDepth ?? 0,
                    x: bounds.x,
                    y,
                    toX: bounds.x + bounds.width,
                    toY: y,
                    width: 0.5,
                    color: border,
                });
            }
        }
        for (const { cell, band } of content) {
            const shifted = shiftBand(band, box(cell).x + 6);
            result.commands.push(...shifted.commands);
            result.lines.push(...shifted.lines.map((line) => ({ ...line, cellId: line.cellId ?? cell.node.id })));
            result.columns!.push(...(shifted.columns ?? []));
            result.cells!.push(...(shifted.cells ?? []));
        }
        return result;
    });
}
