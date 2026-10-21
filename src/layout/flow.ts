import { clauseNumbers, rejectedClause } from '../content/clauses/numbering.js';
import { floatingFieldPlacement } from '../content/fields/placement.js';
import { floatingAnchorIndex, resolveFloatingAnchor } from '../content/floating-anchors.js';
import { documentPageLayout, pageSize } from '../content/page-layout.js';
import { documentPresentation, headerTile } from '../content/presentation.js';
import type { Attributes, Json, NativeDocument, NativeNode } from '../document/model.js';
import { columnWeights, tableGrid } from '../editing/table-grid.js';
import { NativeTextKernel, point, type ShapedParagraph } from '../rendering/kernel.js';
import { inheritedDirection } from '../typography/direction.js';
import {
    blockTextStyle,
    color,
    DEFAULT_TEXT_STYLE,
    inlineSpans,
    numericAttribute,
    type Color,
} from '../typography/style.js';
import {
    blank,
    decorateBand,
    flowSpace,
    flowTracks,
    isSpacing,
    materializeBands,
    shiftBand,
    type Band,
    type BandParts,
} from './bands.js';
import { fieldPaintCommands } from './fields.js';
import type {
    DocumentScene,
    GlyphCommand,
    PaintCommand,
    RectCommand,
    SceneCell,
    SceneColumn,
    SceneLine,
    ScenePage,
} from './scene.js';
import { readingRun } from './text-reading.js';

interface Context {
    used: Set<ShapedParagraph>;
    kernel: NativeTextKernel;
    numbers: ReadonlyMap<string, number>;
    direction: 'ltr' | 'rtl';
    measured: Set<NativeNode>;
    availableHeight: number;
    tableDepth?: number;
}
interface MeasuredBlock {
    key: string;
    bands: Band[];
    paragraphs: ReadonlySet<ShapedParagraph>;
    numbers: ReadonlyMap<string, number | undefined>;
    nodes: ReadonlySet<NativeNode>;
}
const measurements = new WeakMap<
    NativeTextKernel,
    { nodes: WeakMap<NativeNode, MeasuredBlock>; active: ReadonlySet<NativeNode> }
>();
function scope(node: NativeNode, parent: Context): Context {
    return {
        ...parent,
        direction: inheritedDirection(node, parent.direction),
    };
}
const isRecord = (value: Json | undefined): value is Attributes =>
    !!value && typeof value === 'object' && !Array.isArray(value);

function glyphBands(node: NativeNode, width: number, ctx: Context, base = DEFAULT_TEXT_STYLE, prefix = ''): Band[] {
    const style = blockTextStyle(node, base);
    let spans = [...inlineSpans(node, style)];
    if (prefix) spans.unshift({ nodeId: node.id, text: prefix, style, editable: false });
    spans = spans.map((span) => {
        if (span.placeholder?.kind !== 'image') return span;
        const source = span.placeholder.attributes?.src;
        if (typeof source !== 'string') throw new Error('An inline image has no source');
        const asset = ctx.kernel.images.source(source);
        const desired = Math.min(width, span.placeholder.width);
        return {
            ...span,
            placeholder: {
                ...span.placeholder,
                width: desired,
                height: span.placeholder.attributes?.height
                    ? (span.placeholder.height * desired) / span.placeholder.width
                    : (desired * asset.height) / asset.width,
            },
        };
    });
    const direction = scope(node, ctx).direction;
    const indent = Math.max(0, Math.min(width - 36, numericAttribute(node.attributes, 'indent', 0) * 18));
    const shaped = ctx.kernel.shapeRich(
        spans,
        width - indent,
        direction,
        typeof node.attributes?.textAlign === 'string' ? node.attributes.textAlign : undefined,
    );
    ctx.used.add(shaped);
    const explicitHeight = spans.some((span) => span.style.lineHeight !== null);
    const bands = shaped.lines.map((line): Band => {
        const height = point(Math.max(explicitHeight ? 0 : style.size * 1.6, line.bottom - line.top));
        const commands: PaintCommand[] = [];
        for (const run of line.runs) {
            let x1 = Infinity,
                x2 = -Infinity;
            for (let index = 0; index < run.positions.length; index += 2) {
                x1 = Math.min(x1, run.positions[index]);
                x2 = Math.max(x2, run.positions[index]);
            }
            if (run.style.background)
                commands.push({
                    kind: 'rect',
                    x: x1,
                    y: 0,
                    width: point(x2 - x1),
                    height,
                    color: run.style.background,
                });
            const positions = new Array<number>(run.glyphs.length * 2);
            for (let index = 0; index < positions.length; index++)
                positions[index] = point(run.positions[index] - (index % 2 ? line.top : 0));
            const glyph: GlyphCommand = {
                kind: 'glyphs',
                fontId: run.fontId,
                size: run.size,
                glyphs: run.glyphs,
                text: run.text,
                positions,
                color: run.style.color,
                fauxBold: run.fauxBold,
                fauxItalic: run.fauxItalic,
                reading: readingRun(JSON.stringify(['paragraph', node.id, line.start]), run, 0, height),
            };
            commands.push(glyph);
            for (const offset of [
                ...(run.style.underline ? [run.size * 0.12] : []),
                ...(run.style.strike ? [-run.size * 0.3] : []),
            ]) {
                const baseline = point(line.baseline - line.top + offset);
                commands.push({
                    kind: 'line',
                    x: x1,
                    y: baseline,
                    toX: x2,
                    toY: baseline,
                    width: point(Math.max(0.4, run.size / 20)),
                    color: run.style.color,
                });
            }
            if (run.style.href)
                commands.push({ kind: 'link', href: run.style.href, x: x1, y: 0, width: point(x2 - x1), height });
        }
        for (const placeholder of shaped.placeholders) {
            if (placeholder.from < line.start || placeholder.from >= line.endWithBreak) continue;
            const box = {
                x: placeholder.left,
                y: point(placeholder.top - line.top),
                width: placeholder.width,
                height: placeholder.height,
            };
            const attrs = placeholder.span.placeholder!.attributes ?? {};
            if (placeholder.span.placeholder!.kind === 'image') {
                commands.push({
                    kind: 'image',
                    nodeId: placeholder.span.nodeId,
                    attributes: attrs,
                    assetId: ctx.kernel.images.source(String(attrs.src)).id,
                    ...box,
                });
            } else {
                const fieldCommands = fieldPaintCommands(
                    { kind: 'field', nodeId: placeholder.span.nodeId, attributes: attrs, ...box },
                    ctx.kernel,
                    ctx.used,
                );
                const offset = new TextEncoder().encode(shaped.text.slice(0, placeholder.from)).length;
                commands.push(
                    ...fieldCommands.map((command) =>
                        'glyphs' in command && command.reading
                            ? {
                                  ...command,
                                  reading: command.reading.map((part) => ({
                                      ...part,
                                      group: JSON.stringify(['paragraph', node.id, line.start]),
                                      order: [offset, ...part.order],
                                  })),
                              }
                            : command,
                    ),
                );
            }
        }
        return {
            height,
            commands,
            lines: [
                {
                    paragraphId: node.id,
                    textNodeId: shaped.sources.find((source) => source.editable)?.nodeId ?? node.id,
                    left: 0,
                    top: 0,
                    height,
                    originalTop: line.top,
                    shaped,
                },
            ],
        };
    });
    if (indent && direction === 'ltr')
        bands.forEach((band, index) => {
            bands[index] = shiftBand(band, indent);
        });
    const heading = node.kind === 'heading' || node.kind === 'clauseTitle';
    if (heading) for (const band of bands) band.keepNext = true;
    bands.push({ ...blank(node.kind === 'heading' ? 10 : 6), ...(heading ? { keepNext: true } : {}) });
    return bands;
}

function parallelBands(node: NativeNode, width: number, ctx: Context): Band[] {
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
    const total = widths.reduce((sum, item) => sum + item, 0);
    const available = width - Math.max(0, cells.length - 1) * gap;
    const rtl = ctx.direction === 'rtl';
    let x = rtl ? width : 0;
    const measured = cells.map((cell, index) => {
        const cellWidth = (available * widths[index]) / total;
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
function tableBands(node: NativeNode, width: number, ctx: Context): Band[] {
    const grid = tableGrid(node);
    if (!grid.columns) return fragmentedTableBands(node, width, ctx);
    const weights = columnWeights(grid);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const edges = [0];
    for (const weight of weights) edges.push(edges.at(-1)! + (width * weight) / total);
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
                                direction: rtl ? 'rtl' : 'ltr',
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
            const ids = new Set(group.map((cell) => cell.node.id));
            fragmented ??= fragmentedTableBands(node, width, ctx);
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
                direction: rtl ? 'rtl' : 'ltr',
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

function fragmentedTableBands(node: NativeNode, width: number, ctx: Context): Band[] {
    const grid = tableGrid(node);
    const rows = grid.rows;
    const cells: TableCell[] = grid.cells.map((cell) => ({ ...cell, bands: [], start: 0, end: 0 }));
    const weights = columnWeights(grid);
    const total = weights.reduce((sum, item) => sum + item, 0);
    const edges = [0];
    for (const weight of weights) edges.push(edges[edges.length - 1] + (width * weight) / total);
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
                direction: rtl ? 'rtl' : 'ltr',
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
                result.commands.push({ kind: 'line', x, y: 0, toX: x, toY: cellHeight, width: 0.5, color: border });
            if (at === cell.start || positions[index + 1] === cell.end) {
                const y = at === cell.start ? 0 : height;
                result.commands.push({
                    kind: 'line',
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

function blocks(nodes: readonly NativeNode[], width: number, parent: Context, ensureLine = false): Band[] {
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
        state = { nodes: new WeakMap(), active: new Set() };
        measurements.set(parent.kernel, state);
    }
    const cache = state.nodes;
    return nodes.flatMap((node) => {
        const scoped = scope(node, parent);
        const key = JSON.stringify([
            width,
            scoped.direction,
            parent.kernel.fontHash,
            parent.availableHeight,
            parent.tableDepth ?? 0,
        ]);
        const previous = cache.get(node);
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
            } else output.push(...blocks([child], width, ctx));
        }
    } else if (node.kind === 'parallelRow') output.push(...parallelBands(node, width, ctx));
    else if (node.kind === 'table') output.push(...tableBands(node, width, ctx), blank(8));
    else if (node.kind === 'horizontalRule')
        output.push({
            height: 12,
            lines: [],
            commands: [{ kind: 'line', x: 0, y: 6, toX: width, toY: 6, width: 0.75, color: [0.5, 0.5, 0.5, 1] }],
        });
    else if (node.kind === 'blockquote')
        output.push(
            ...blocks(node.children ?? [], width - 18, ctx, true).map((entry) =>
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
            if (first && ['paragraph', 'heading', 'codeBlock'].includes(first.kind))
                output.push(
                    ...glyphBands(
                        first,
                        width - 18,
                        ctx,
                        DEFAULT_TEXT_STYLE,
                        node.kind === 'orderedList' ? `${index++}. ` : '• ',
                    ).map((band) => shiftBand(band, 9)),
                );
            else if (first) output.push(...blocks([first], width - 18, ctx));
            output.push(...blocks(children, width - 18, ctx).map((band) => shiftBand(band, 9)));
        }
    } else if (['doc', 'clauseBody', 'parallelCell', 'listItem'].includes(node.kind))
        output.push(...blocks(node.children ?? [], width, ctx, true));
    else throw new Error(`Native layout is not implemented for ${node.kind}`);
    return output;
}

export function createDocumentScene(
    document: NativeDocument,
    kernel: NativeTextKernel,
    surfaceWidth?: number,
): DocumentScene {
    const presentation = documentPresentation(document);
    const coverPages = presentation.cover.enabled ? 1 : 0;
    const layout = documentPageLayout(document);
    const landscape = layout.orientation === 'landscape';
    const size = pageSize(layout.orientation);
    const width = point(surfaceWidth ?? size.width),
        height = point(size.height);
    if (!Number.isFinite(width) || width < 100 || width > 2000) throw new Error('Invalid layout surface width');
    const margin = (key: keyof typeof layout.margins) => {
        const value = layout.margins[key];
        if (!Number.isFinite(value) || value < 0) throw new Error('Invalid page margins');
        return value * 0.75;
    };
    const left = margin('left'),
        right = margin('right'),
        top = margin('top'),
        bottom = margin('bottom');
    const area = width - left - right;
    if (area < 36 || height - top - bottom < 36) throw new Error('Page margins leave no writable area');
    const ctx: Context = {
        kernel,
        used: new Set(),
        numbers: clauseNumbers(document),
        measured: new Set(),
        direction: document.root.attributes?.dir === 'ltr' ? 'ltr' : 'rtl',
        availableHeight: point(height - top - bottom),
    };
    const pages: Array<{
        width: number;
        height: number;
        commands: PaintCommand[];
        lines: SceneLine[];
        cells: SceneCell[];
        columns: SceneColumn[];
        blocks: SceneColumn[];
    }> = [];
    const newPage = () => {
        const page = {
            width,
            height,
            commands: [] as PaintCommand[],
            lines: [] as SceneLine[],
            cells: [] as SceneCell[],
            columns: [] as SceneColumn[],
            blocks: [] as SceneColumn[],
        };
        pages.push(page);
        if (presentation.header.enabled && presentation.header.src) {
            const asset = kernel.images.source(presentation.header.src);
            const size = headerTile(asset.width, asset.height, width, height);
            page.commands.push({
                kind: 'image',
                assetId: asset.id,
                x: 0,
                y: 0,
                width: point(size.width),
                height: point(size.height),
            });
        }
        return page;
    };
    let page = newPage();
    let y = top;
    const owners = new Map<Band, string>();
    const content = (document.root.children ?? []).flatMap((node) => {
        const bands = blocks([node], area, ctx);
        for (const band of bands) owners.set(band, node.id);
        return bands;
    });
    const state = measurements.get(kernel);
    if (state) {
        for (const node of state.active) if (!ctx.measured.has(node)) state.nodes.delete(node);
        state.active = ctx.measured;
    }
    const requiredSpace = new Array<number>(content.length);
    for (let start = 0; start < content.length; ) {
        let end = start,
            total = content[start].minimumHeight ?? content[start].height;
        while (content[end].keepNext && end + 1 < content.length) {
            const next = content[++end];
            total += next.minimumHeight ?? next.height;
        }
        let remaining = total;
        for (let index = start; index <= end; index++) {
            const minimum = content[index].minimumHeight ?? content[index].height;
            requiredSpace[index] = total > height - top - bottom ? minimum : remaining;
            remaining -= minimum;
        }
        start = end + 1;
    }
    content.forEach((original, index) => {
        if (isSpacing(original)) {
            y = point(Math.min(height - bottom, y + original.height));
            return;
        }
        let pending: Band | undefined = original;
        while (pending) {
            const required = pending === original ? requiredSpace[index] : (pending.minimumHeight ?? pending.height);
            if (y + required > height - bottom && y > top) {
                page = newPage();
                y = top;
            }
            const room = point(height - bottom - y);
            const parts: BandParts | undefined = pending.split?.(room);
            if ((pending.split && !parts) || (!pending.split && pending.height > room)) {
                if (y === top) throw new Error('A document block exceeds the writable page height');
                page = newPage();
                y = top;
                continue;
            }
            const band = parts?.head ?? pending;
            const shifted = shiftBand(band, left, y);
            page.commands.push(...shifted.commands);
            page.lines.push(...shifted.lines);
            page.cells.push(...(shifted.cells ?? []));
            page.columns.push(...(shifted.columns ?? []));
            if (band.height > 0)
                page.blocks.push({ id: owners.get(original)!, x: left, y, width: area, height: band.height });
            y = point(y + band.height);
            pending = parts?.rest;
        }
    });
    const floating = document.root.attributes?.floatingImages;
    const variables = document.root.attributes?.blockVariables;
    let anchors: ReturnType<typeof floatingAnchorIndex> | undefined;
    for (const entry of [
        ...(Array.isArray(floating) ? floating : []),
        ...(Array.isArray(variables) ? variables : []),
    ]) {
        if (!isRecord(entry) || entry.surface === 'cover') continue;
        const stride = (landscape ? 794 : 1123) + 30;
        const { page: index, ...position } = resolveFloatingAnchor(
            entry,
            floatingFieldPlacement(entry, { width, height }, stride),
            (anchors ??= floatingAnchorIndex(document, { pages })),
        );
        if (index > 10000) throw new Error('The floating object page is out of range');
        while (pages.length <= index) newPage();
        const bounds = {
            x: point(position.x),
            y: point(position.y),
            width: point(position.width),
            height: point(position.height),
        };
        pages[index].commands.push(
            ...(typeof entry.src === 'string'
                ? [
                      {
                          kind: 'image' as const,
                          nodeId: String(entry.id),
                          attributes: entry,
                          assetId: kernel.images.source(entry.src).id,
                          ...bounds,
                      },
                  ]
                : fieldPaintCommands(
                      { kind: 'field', nodeId: String(entry.id), attributes: entry, ...bounds },
                      kernel,
                      ctx.used,
                  )),
        );
    }
    pages.forEach((entry, index) => {
        const footer = kernel.shape(String(index + 1), area, 8, 'ltr');
        ctx.used.add(footer);
        for (const line of footer.lines)
            for (const run of line.runs)
                entry.commands.push({
                    kind: 'glyphs',
                    fontId: run.fontId,
                    size: run.size,
                    glyphs: run.glyphs,
                    text: run.text,
                    positions: run.positions
                        .slice(0, run.glyphs.length * 2)
                        .map((value, coordinate) =>
                            point(value + (coordinate % 2 ? height - Math.min(bottom / 2, 27) - line.baseline : left)),
                        ),
                    color: run.style.color,
                    reading: readingRun(
                        JSON.stringify(['footer', index]),
                        run,
                        line.top + height - Math.min(bottom / 2, 27) - line.baseline,
                        line.bottom - line.top,
                        left,
                    ),
                });
    });
    if (coverPages) {
        const commands: PaintCommand[] = [];
        if (presentation.cover.src) {
            const asset = kernel.images.source(presentation.cover.src);
            commands.push(
                { kind: 'clipStart', x: 0, y: 0, width, height },
                {
                    kind: 'image',
                    assetId: asset.id,
                    x: 0,
                    y: 0,
                    width,
                    height: point((asset.height * width) / asset.width),
                },
                { kind: 'clipEnd' },
            );
        }
        for (const entry of [
            ...(Array.isArray(floating) ? floating : []),
            ...(Array.isArray(variables) ? variables : []),
        ]) {
            if (!isRecord(entry) || entry.surface !== 'cover') continue;
            const { page: ignored, ...bounds } = floatingFieldPlacement(entry, { width, height }, height / 0.75 + 30);
            void ignored;
            commands.push(
                ...(typeof entry.src === 'string'
                    ? [
                          {
                              kind: 'image' as const,
                              nodeId: String(entry.id),
                              attributes: entry,
                              assetId: kernel.images.source(entry.src).id,
                              ...bounds,
                          },
                      ]
                    : fieldPaintCommands(
                          { kind: 'field', nodeId: String(entry.id), attributes: entry, ...bounds },
                          kernel,
                          ctx.used,
                      )),
            );
        }
        pages.unshift({ width, height, commands, lines: [], cells: [], columns: [], blocks: [] });
    }
    kernel.clearUnused(ctx.used);
    const immutable: ScenePage[] = pages.map((entry) =>
        Object.freeze({
            ...entry,
            commands: Object.freeze(
                layerTableBackgrounds(entry.commands).map((command) => {
                    if ('glyphs' in command) {
                        Object.freeze(command.glyphs);
                        Object.freeze(command.text);
                        Object.freeze(command.positions);
                        if (command.reading) {
                            for (const part of command.reading) {
                                Object.freeze(part.order);
                                Object.freeze(part.box);
                                Object.freeze(part);
                            }
                            Object.freeze(command.reading);
                        }
                    }
                    if ('color' in command && command.color) Object.freeze(command.color);
                    return Object.freeze(command);
                }),
            ),
            lines: Object.freeze(entry.lines.map((line) => Object.freeze(line))),
            cells: coalesceCells(entry.cells),
            columns: coalesceColumns(entry.columns),
            blocks: coalesceColumns(entry.blocks),
        }),
    );
    const glyphCount = immutable.reduce(
        (sum, entry) =>
            sum +
            entry.commands.reduce(
                (count, command) => count + (!command.kind || command.kind === 'glyphs' ? command.glyphs.length : 0),
                0,
            ),
        0,
    );
    return Object.freeze({
        documentId: document.id,
        revision: document.revision,
        fontHash: kernel.fontHash,
        margin: left,
        glyphCount,
        coverPages,
        pages: Object.freeze(immutable),
    });
}

function coalesceColumns(columns: readonly SceneColumn[]): readonly SceneColumn[] {
    const result: SceneColumn[] = [],
        last = new Map<string, number>();
    for (const column of columns) {
        const index = last.get(column.id),
            previous = index === undefined ? undefined : result[index];
        if (
            previous &&
            previous.x === column.x &&
            previous.width === column.width &&
            Math.abs(previous.y + previous.height - column.y) < 0.002
        )
            result[index!] = { ...previous, height: point(column.y + column.height - previous.y) };
        else {
            last.set(column.id, result.length);
            result.push(column);
        }
    }
    return Object.freeze(result.map((column) => Object.freeze(column)));
}

function coalesceCells(cells: readonly SceneCell[]): readonly SceneCell[] {
    const result: SceneCell[] = [],
        last = new Map<string, number>();
    for (const cell of cells) {
        const index = last.get(cell.cellId),
            previous = index === undefined ? undefined : result[index];
        if (
            previous &&
            previous.x === cell.x &&
            previous.width === cell.width &&
            cell.y >= previous.y - 0.002 &&
            cell.y <= previous.y + previous.height + 0.002
        )
            result[index!] = {
                ...previous,
                height: point(Math.max(previous.y + previous.height, cell.y + cell.height) - previous.y),
            };
        else {
            last.set(cell.cellId, result.length);
            result.push(cell);
        }
    }
    return Object.freeze(
        result.map((cell) => {
            Object.freeze(cell.columnEdges);
            return Object.freeze(cell);
        }),
    );
}

function layerTableBackgrounds(commands: readonly PaintCommand[]): readonly PaintCommand[] {
    const background = (command: PaintCommand): command is RectCommand =>
        command.kind === 'rect' && command.tableBackground !== undefined;
    const first = commands.findIndex(background);
    if (first < 0) return commands;
    const backgrounds: RectCommand[] = [];
    const foreground: PaintCommand[] = [];
    let depth = 0;
    for (const command of commands.slice(first)) {
        if (command.kind === 'clipStart') depth++;
        if (background(command) && depth === 0) backgrounds.push(command);
        else foreground.push(command);
        if (command.kind === 'clipEnd') depth--;
    }
    return [
        ...commands.slice(0, first),
        ...backgrounds.sort((a, b) => a.tableBackground! - b.tableBackground!),
        ...foreground,
    ];
}
