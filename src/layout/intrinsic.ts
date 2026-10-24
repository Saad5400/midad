import type { NativeNode } from '../document/model.js';
import { isTextBlock } from '../document/text.js';
import { tableGrid } from '../editing/table-grid.js';
import { blockTextStyle, DEFAULT_TEXT_STYLE, inlineSpans, numericAttribute } from '../typography/style.js';
import { scope, type LayoutContext } from './context.js';

const widths = new WeakMap<NativeNode, Map<string, number>>();

export function minimumWidth(node: NativeNode, context: LayoutContext): number {
    const ctx = scope(node, context);
    const key = `${ctx.fontHash}:${ctx.direction}`;
    let cache = widths.get(node);
    const cached = cache?.get(key);
    if (cached !== undefined) return cached;
    let width = 0;
    if (isTextBlock(node)) {
        const style = blockTextStyle(node, DEFAULT_TEXT_STYLE);
        const spans = [...inlineSpans(node, style)].filter((span) => !span.placeholder);
        if (spans.length) {
            const shaped = ctx.kernel.shapeRich(spans, 65536, ctx.direction, 'left');
            for (const line of shaped.lines)
                for (const run of line.runs)
                    for (let at = 0; at + 2 < run.positions.length; at += 2)
                        width = Math.max(width, Math.abs(run.positions[at + 2] - run.positions[at]));
        }
        width += Math.max(0, numericAttribute(node.attributes, 'indent', 0) * 18);
        if (width) width += 0.02;
    } else if (node.kind === 'table') width = minimumTableColumns(node, ctx).reduce((sum, value) => sum + value, 0);
    else if (node.kind === 'parallelRow' && !node.attributes?.show) {
        const cells = node.children ?? [];
        width =
            cells.reduce((sum, cell) => sum + minimumWidth(cell, ctx), 0) +
            Math.max(0, cells.length - 1) * (node.attributes?.gap === 'lg' ? 18 : 9);
    } else {
        const children =
            node.kind === 'parallelRow' && node.attributes?.show && node.attributes.show !== 'all'
                ? node.children?.filter((cell) => cell.attributes?.lang === node.attributes?.show)
                : node.children;
        width = Math.max(0, ...(children ?? []).map((child) => minimumWidth(child, ctx)));
        if (node.kind === 'bulletList' || node.kind === 'orderedList') width += 18;
    }
    if (!cache) {
        cache = new Map();
        widths.set(node, cache);
    }
    cache.set(key, width);
    return width;
}

export function minimumTableColumns(node: NativeNode, context: LayoutContext): number[] {
    const grid = tableGrid(node);
    const minimum = Array<number>(grid.columns).fill(0);
    for (const cell of [...grid.cells].sort((a, b) => a.colspan - b.colspan)) {
        const required =
            Math.max(0, ...(cell.node.children ?? []).map((child) => minimumWidth(child, scope(cell.node, context)))) +
            12;
        const current = minimum.slice(cell.column, cell.column + cell.colspan).reduce((sum, value) => sum + value, 0);
        const extra = Math.max(0, required - current) / cell.colspan;
        for (let index = cell.column; index < cell.column + cell.colspan; index++) minimum[index] += extra;
    }
    return minimum;
}

export function fitWidths(width: number, weights: readonly number[], minimum: readonly number[]): number[] {
    const sum = weights.reduce((total, weight) => total + weight, 0);
    const original = weights.map((weight) => (width * weight) / sum);
    if (minimum.reduce((total, value) => total + value, 0) > width) return original;
    const result = [...original];
    const fixed = new Set<number>();
    while (true) {
        const narrow = result
            .map((value, index) => ({ value, index }))
            .filter(({ value, index }) => !fixed.has(index) && value < minimum[index]);
        if (!narrow.length) return result;
        for (const { index } of narrow) {
            fixed.add(index);
            result[index] = minimum[index];
        }
        const available = width - [...fixed].reduce((total, index) => total + result[index], 0);
        const remaining = weights.reduce((total, weight, index) => total + (fixed.has(index) ? 0 : weight), 0);
        for (let index = 0; index < result.length; index++)
            if (!fixed.has(index)) result[index] = (available * weights[index]) / remaining;
    }
}
