import { rejectedClause } from '../content/clauses/numbering.js';
import type { NativeDocument, NativeNode } from '../document/model.js';
import { isTextBlock } from '../document/text.js';
import type { NativeTextKernel } from '../rendering/kernel.js';
import type { ShapedParagraph } from '../rendering/text/model.js';
import { DEFAULT_TEXT_STYLE, numericAttribute } from '../typography/style.js';
import { blank, decorateBand, shiftBand, type Band } from './bands.js';
import { parallelBands } from './columns.js';
import { scope, type LayoutContext as Context } from './context.js';
import type { PaintCommand } from './scene.js';
import { tableBands } from './tables.js';
import { glyphBands } from './text.js';

interface MeasuredBlock {
    key: string;
    bands: Band[];
    paragraphs: ReadonlySet<ShapedParagraph>;
    numbers: ReadonlyMap<string, number | undefined>;
    nodes: ReadonlySet<NativeNode>;
}
const measurements = new WeakMap<
    NativeTextKernel,
    { nodes: WeakMap<NativeNode, MeasuredBlock>; active: ReadonlySet<NativeNode>; retained: Map<NativeNode, number> }
>();
export function measureBlocks(
    nodes: readonly NativeNode[],
    width: number,
    parent: Context,
    ensureLine = false,
): Band[] {
    if (!nodes.length && !ensureLine) return [];
    if (!nodes.length)
        return glyphBands({ id: 'empty-writing-position', kind: 'paragraph', children: [] }, width, parent).map(
            (band) => ({
                ...band,
                commands: [],
                lines: [],
                writable: band.lines.length > 0,
            }),
        );
    let state = measurements.get(parent.kernel);
    if (!state) {
        state = { nodes: new WeakMap(), active: new Set(), retained: new Map() };
        measurements.set(parent.kernel, state);
    }
    const cache = state.nodes;
    return nodes.flatMap((node) => {
        if (parent.completed?.has(node.id)) return [];
        const scoped = scope(node, parent);
        const key = JSON.stringify([
            width,
            scoped.direction,
            parent.fontHash,
            parent.availableHeight,
            parent.tableDepth ?? 0,
            parent.fragments?.get(node.id)?.from ?? 0,
            Boolean(parent.completed),
        ]);
        const cacheable = !parent.completed || isTextBlock(node);
        const previous = cacheable ? cache.get(node) : undefined;
        if (
            previous?.key === key &&
            [...previous.paragraphs].every((shaped) => !shaped.paragraph.isDeleted()) &&
            [...previous.numbers].every(([id, number]) => parent.numbers.get(id) === number)
        ) {
            for (const shaped of previous.paragraphs) parent.used.add(shaped);
            for (const measured of previous.nodes) parent.measured.add(measured);
            return previous.bands;
        }
        const ctx: Context = {
            ...scoped,
            used: new Set(),
            measured: new Set([node]),
        };
        const bands = measureBlock(node, width, ctx);
        if (node.kind === 'horizontalRule' && bands.length)
            bands[bands.length - 1] = { ...bands.at(-1)!, completedNodes: [node.id] };
        if (cacheable)
            cache.set(node, {
                key,
                bands,
                paragraphs: ctx.used,
                numbers: new Map(
                    [...ctx.measured]
                        .filter((node) => node.kind === 'clause')
                        .map((node) => [node.id, parent.numbers.get(node.id)]),
                ),
                nodes: ctx.measured,
            });
        for (const shaped of ctx.used) parent.used.add(shaped);
        for (const measured of ctx.measured) parent.measured.add(measured);
        return bands;
    });
}

function measureBlock(node: NativeNode, width: number, ctx: Context): Band[] {
    const output: Band[] = [];
    if (['paragraph', 'heading', 'clauseTitle', 'codeBlock'].includes(node.kind))
        output.push(
            ...glyphBands(
                node,
                width,
                ctx,
                node.kind === 'codeBlock' ? { ...DEFAULT_TEXT_STYLE, family: 'Courier New' } : DEFAULT_TEXT_STYLE,
            ),
        );
    else if (node.kind === 'clause') {
        if (rejectedClause(node)) return output;
        const number = node.attributes?.ordered !== false ? `${ctx.numbers.get(node.id)}. ` : '';
        for (const child of node.children ?? []) {
            if (child.kind === 'clauseTitle') {
                if (!node.attributes?.isTitleHidden)
                    output.push(...glyphBands(child, width, ctx, DEFAULT_TEXT_STYLE, number));
            } else output.push(...measureBlocks([child], width, ctx));
        }
    } else if (node.kind === 'parallelRow') output.push(...parallelBands(node, width, ctx, measureBlocks));
    else if (node.kind === 'table') output.push(...tableBands(node, width, ctx, measureBlocks), blank(8));
    else if (node.kind === 'horizontalRule')
        output.push({
            height: 12,
            lines: [],
            commands: [{ kind: 'line', x: 0, y: 6, toX: width, toY: 6, width: 0.75, color: [0.5, 0.5, 0.5, 1] }],
        });
    else if (node.kind === 'blockquote')
        output.push(
            ...measureBlocks(node.children ?? [], width - 18, ctx, true).map((entry) =>
                decorateBand(entry, (band) => {
                    const shifted = shiftBand(band, 9);
                    const border: PaintCommand = {
                        kind: 'line',
                        x: ctx.direction === 'rtl' ? width - 3 : 3,
                        y: 0,
                        toX: ctx.direction === 'rtl' ? width - 3 : 3,
                        toY: band.height,
                        width: 2,
                        color: [0.7, 0.7, 0.7, 1],
                    };
                    return { ...shifted, commands: [border, ...shifted.commands] };
                }),
            ),
        );
    else if (node.kind === 'bulletList' || node.kind === 'orderedList') {
        let index = numericAttribute(node.attributes, 'start', 1);
        for (const item of node.children ?? []) {
            const children = [...(item.children ?? [])];
            const first = children.shift();
            if (first && ctx.listStarts && ctx.listStarts.get(item.id) !== first.id) {
                output.push(...measureBlocks([first, ...children], width - 18, ctx).map((band) => shiftBand(band, 9)));
                continue;
            }
            if (first && ['paragraph', 'heading', 'codeBlock'].includes(first.kind))
                output.push(
                    ...glyphBands(
                        first,
                        width - 18,
                        ctx,
                        DEFAULT_TEXT_STYLE,
                        node.kind === 'orderedList' ? `${ctx.listNumbers?.get(item.id) ?? index++}. ` : '• ',
                    ).map((band) => shiftBand(band, 9)),
                );
            else if (first) output.push(...measureBlocks([first], width - 18, ctx));
            output.push(...measureBlocks(children, width - 18, ctx).map((band) => shiftBand(band, 9)));
        }
    } else if (['doc', 'clauseBody', 'parallelCell', 'listItem'].includes(node.kind))
        output.push(...measureBlocks(node.children ?? [], width, ctx, true));
    else throw new Error(`Native layout is not implemented for ${node.kind}`);
    return output;
}

export function pruneMeasurements(kernel: NativeTextKernel, measured: ReadonlySet<NativeNode>): void {
    const state = measurements.get(kernel);
    if (!state) return;
    for (const node of state.active) if (!measured.has(node) && !state.retained.has(node)) state.nodes.delete(node);
    state.active = measured;
}

export function retainMeasurements(kernel: NativeTextKernel, document: NativeDocument): () => void {
    const state = measurements.get(kernel);
    if (!state) return () => {};
    const nodes: NativeNode[] = [];
    const visit = (node: NativeNode): void => {
        nodes.push(node);
        state.retained.set(node, (state.retained.get(node) ?? 0) + 1);
        node.children?.forEach(visit);
    };
    visit(document.root);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        for (const node of nodes) {
            const count = state.retained.get(node) ?? 0;
            if (count > 1) state.retained.set(node, count - 1);
            else {
                state.retained.delete(node);
                if (!state.active.has(node)) state.nodes.delete(node);
            }
        }
        if (!state.retained.size) {
            state.nodes = new WeakMap();
            state.active = new Set();
        }
    };
}
