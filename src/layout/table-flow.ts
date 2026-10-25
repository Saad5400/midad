import type { NativeNode } from '../document/model.js';
import type { GridCell, GridRow } from '../editing/table-grid.js';
import { tableRowMinimum } from '../editing/table-rows.js';
import { point } from '../typography/metrics.js';
import { color, type Color } from '../typography/style.js';
import { blank, requiredHeight, shiftBand, takeBands, type Band } from './bands.js';
import type { LayoutContext } from './context.js';
import { tableRowFragments } from './table-rows.js';

interface FlowCell extends GridCell {
    bands: readonly Band[];
}
interface Placement {
    at: number;
    band: Band;
}
interface CellFlow {
    start: number;
    end: number;
    placements: Placement[];
}

function roomAt(at: number, first: number, full: number): number {
    if (at < first) return point(first - at);
    return point(full - ((at - first) % full));
}

function placeFlow(bands: readonly Band[], at: number, first: number, full: number): CellFlow {
    let pending: readonly Band[] = [...bands, blank(6)];
    const placements: Placement[] = [];
    while (pending.length) {
        const room = roomAt(at, first, full);
        const parts = takeBands(pending, room, full);
        const start = at;
        for (const band of parts.head) {
            placements.push({ at, band });
            at = point(at + band.height);
        }
        if (!parts.rest.length) break;
        if (at === start && room === full) throw new Error('A document block exceeds the writable page height');
        at = point(start + room);
        pending = parts.rest;
    }
    return { start: placements.find((placement) => placement.band.height > 0)?.at ?? at, end: at, placements };
}

function pageChain(
    pages: readonly Band[],
    index: number,
    height = point(pages.reduce((sum, band) => sum + band.height, 0)),
): Band {
    return {
        height,
        minimumHeight: pages[index].height,
        commands: [],
        lines: [],
        split: (available) =>
            available < pages[index].height
                ? undefined
                : {
                      head: pages[index],
                      ...(index + 1 < pages.length
                          ? { rest: pageChain(pages, index + 1, point(height - pages[index].height)) }
                          : {}),
                  },
    };
}

function alignFlow(
    cell: FlowCell,
    current: CellFlow,
    start: number,
    end: number,
    first: number,
    full: number,
): CellFlow {
    const alignment = cell.node.attributes?.verticalAlign;
    if ((alignment !== 'middle' && alignment !== 'bottom') || end <= current.end) return current;
    if (alignment === 'middle' && current.start - start >= end - current.end) return current;
    let low = start;
    let high = end;
    let best = current;
    let distance = Math.abs(current.start - start - (end - current.end));
    while (high - low > 1 / 1024) {
        const middle = point((low + high) / 2);
        const candidate = placeFlow(cell.bands, middle, first, full);
        const balance = candidate.start - start - (end - candidate.end);
        if (candidate.end <= end && (alignment === 'bottom' || Math.abs(balance) < distance)) {
            best = candidate;
            distance = Math.abs(balance);
        }
        if (candidate.end <= end && (alignment === 'bottom' || balance < 0)) low = middle;
        else high = middle;
    }
    return best;
}

export function flowingTableBand(
    node: NativeNode,
    width: number,
    ctx: LayoutContext,
    cells: readonly FlowCell[],
    rows: readonly GridRow[],
    edges: readonly number[],
    minimumColumnWidths: readonly number[],
    height: number,
    rowOffset: number,
): Band {
    const full = ctx.availableHeight;
    const rtl = ctx.direction === 'rtl';
    const border = color(node.attributes?.borderColor, [0.8, 0.8, 0.8, 1]);
    return {
        height,
        minimumHeight:
            6 + Math.min(...cells.filter((cell) => cell.row === 0).map((cell) => requiredHeight(cell.bands, 0, full))),
        commands: [],
        lines: [],
        split: (available) => {
            if (available <= 0) return;
            const starts: number[] = [];
            const ends: number[] = [];
            const plans = new Map<FlowCell, CellFlow>();
            const ending: FlowCell[][] = Array.from({ length: rows.length }, () => []);
            for (const cell of cells) ending[cell.row + cell.rowspan - 1].push(cell);
            for (let row = 0; row < rows.length; row++) {
                starts[row] = row ? ends[row - 1] : 0;
                ends[row] = point(starts[row] + tableRowMinimum(rows[row].node));
                for (const cell of ending[row]) {
                    const plan = placeFlow(cell.bands, starts[cell.row] + 6, available, full);
                    plans.set(cell, plan);
                    ends[row] = Math.max(ends[row], plan.end);
                }
            }
            for (const cell of cells) {
                plans.set(
                    cell,
                    alignFlow(
                        cell,
                        plans.get(cell)!,
                        starts[cell.row] + 6,
                        ends[cell.row + cell.rowspan - 1],
                        available,
                        full,
                    ),
                );
            }
            const pages: Band[] = [];
            const cursors = new Map<FlowCell, number>();
            for (let from = 0; from < ends.at(-1)!; ) {
                const to = Math.min(ends.at(-1)!, from + roomAt(from, available, full));
                const band: Band = {
                    height: point(to - from),
                    commands: [],
                    lines: [],
                    cells: [],
                    columns: [],
                    tableRows: tableRowFragments(node.id, rows, [0, ...ends], from, to, width, rowOffset),
                };
                for (const cell of cells) {
                    const start = Math.max(from, starts[cell.row]);
                    const end = Math.min(to, ends[cell.row + cell.rowspan - 1]);
                    if (end <= start) continue;
                    const x = point(rtl ? width - edges[cell.column + cell.colspan] : edges[cell.column]);
                    const box = {
                        x,
                        y: point(start - from),
                        width: point(edges[cell.column + cell.colspan] - edges[cell.column]),
                        height: point(end - start),
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
                          : undefined;
                    if (background)
                        band.commands.push({
                            kind: 'rect',
                            ...box,
                            color: background,
                            tableBackground: ctx.tableDepth ?? 0,
                        });
                    for (const at of [box.x, point(box.x + box.width)])
                        band.commands.push({
                            kind: 'line',
                            tableBorder: ctx.tableDepth ?? 0,
                            x: at,
                            y: box.y,
                            toX: at,
                            toY: point(box.y + box.height),
                            width: 0.5,
                            color: border,
                        });
                    for (const at of [box.y, point(box.y + box.height)])
                        band.commands.push({
                            kind: 'line',
                            tableBorder: ctx.tableDepth ?? 0,
                            x: box.x,
                            y: at,
                            toX: point(box.x + box.width),
                            toY: at,
                            width: 0.5,
                            color: border,
                        });
                    const placements = plans.get(cell)!.placements;
                    let cursor = cursors.get(cell) ?? 0;
                    while (cursor < placements.length && placements[cursor].at < to) {
                        const placement = placements[cursor++];
                        if (placement.at < from) continue;
                        const shifted = shiftBand(placement.band, x + 6, placement.at - from);
                        band.commands.push(...shifted.commands);
                        band.lines.push(
                            ...shifted.lines.map((line) => ({ ...line, cellId: line.cellId ?? cell.node.id })),
                        );
                        band.cells!.push(...(shifted.cells ?? []));
                        band.tableRows!.push(...(shifted.tableRows ?? []));
                        band.columns!.push(...(shifted.columns ?? []));
                    }
                    cursors.set(cell, cursor);
                }
                pages.push(band);
                from = to;
            }
            return pageChain(pages, 0).split!(available);
        },
    };
}
