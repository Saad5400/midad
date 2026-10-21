import type { CanvasKit } from 'canvaskit-wasm';
import type { NativeDocument, NativeNode } from './document.js';
import { blockText, isTextBlock, type TextCaret } from './editing.js';
import type { ShapedLine, ShapedParagraph } from './kernel.js';
import type { DocumentScene, SceneLine } from './layout.js';
import { selectionRanges, textBlocks, type NativeSelection } from './selection.js';

export type CaretAffinity = 'upstream' | 'downstream';
export interface NavigationCaret extends TextCaret {
    readonly affinity: CaretAffinity;
}
interface CaretStop {
    offset: number;
    x: number;
    top: number;
    bottom: number;
    affinity: CaretAffinity;
}
export interface NavigationRow {
    readonly blockId: string;
    readonly prefix: number;
    readonly pageIndex: number;
    readonly placement: SceneLine;
    readonly line: ShapedLine;
}

const graphemes = new WeakMap<ShapedParagraph, readonly { index: number; end: number }[]>();

function graphemeRanges(shaped: ShapedParagraph): readonly { index: number; end: number }[] {
    let parts = graphemes.get(shaped);
    if (!parts) {
        parts = [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(shaped.text)].map((part) => ({
            index: part.index,
            end: part.index + part.segment.length,
        }));
        graphemes.set(shaped, parts);
    }
    return parts;
}

export function wordBoundary(text: string, offset: number, direction: -1 | 1): number {
    const words = [...new Intl.Segmenter('und', { granularity: 'word' }).segment(text)].filter(
        (part) => part.isWordLike || part.segment.includes('\uFFFC'),
    );
    const word =
        direction > 0
            ? words.find((part) => part.index + part.segment.length > offset)
            : [...words].reverse().find((part) => part.index < offset);
    return word ? word.index + (direction > 0 ? word.segment.length : 0) : direction > 0 ? text.length : 0;
}

export class NativeNavigation {
    readonly rows: readonly NavigationRow[];
    private readonly byBlock = new Map<string, readonly NavigationRow[]>();
    private readonly stops = new Map<NavigationRow, readonly CaretStop[]>();
    private readonly paths = new Map<string, readonly NativeNode[]>();
    private readonly blocks: readonly NativeNode[];

    constructor(
        readonly document: NativeDocument,
        readonly scene: DocumentScene,
        private readonly ck: CanvasKit,
    ) {
        const placements = new Map<string, Array<{ placement: SceneLine; pageIndex: number }>>();
        scene.pages.forEach((page, pageIndex) =>
            page.lines.forEach((placement) => {
                let list = placements.get(placement.paragraphId);
                if (!list) placements.set(placement.paragraphId, (list = []));
                list.push({ placement, pageIndex });
            }),
        );
        const collect = (node: NativeNode, parents: readonly NativeNode[]): NativeNode[] => {
            const path = [...parents, node];
            if (isTextBlock(node)) {
                this.paths.set(node.id, path);
                return placements.has(node.id) ? [node] : [];
            }
            return node.children?.flatMap((child) => collect(child, path)) ?? [];
        };
        this.blocks = collect(document.root, []);
        this.rows = this.blocks.flatMap((block) => {
            const rows = (placements.get(block.id) ?? [])
                .sort((a, b) => a.placement.originalTop - b.placement.originalTop)
                .map(({ placement, pageIndex }) => {
                    const first = placement.shaped.sources[0];
                    return {
                        blockId: block.id,
                        prefix: first?.nodeId === block.id && !first.editable ? first.to : 0,
                        placement,
                        pageIndex,
                        line: placement.shaped.lines.find((line) => line.top === placement.originalTop)!,
                    };
                });
            this.byBlock.set(block.id, rows);
            return rows;
        });
    }

    row(target: TextCaret, affinity: CaretAffinity = 'downstream'): NavigationRow | undefined {
        const rows = this.byBlock.get(target.blockId);
        if (!rows?.length) return;
        const position = target.offset + rows[0].prefix;
        const start = rows.findIndex((row) => row.line.start === position);
        if (affinity === 'upstream' && target.offset && start > 0 && rows[start - 1].line.end === position)
            return rows[start - 1];
        return rows.find((row) => position < row.line.endWithBreak) ?? rows.at(-1);
    }

    lineStops(row: NavigationRow): readonly CaretStop[] {
        const cached = this.stops.get(row);
        if (cached) return cached;
        const shaped = row.placement.shaped;
        const segments = graphemeRanges(shaped);
        const result: CaretStop[] = [];
        let low = 0,
            high = segments.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (segments[middle].index < Math.max(row.prefix, row.line.start)) low = middle + 1;
            else high = middle;
        }
        for (let index = low; index < segments.length; index++) {
            const part = segments[index];
            if (part.index >= row.line.end) break;
            const end = Math.min(part.end, row.line.end);
            if (/^[\r\n]+$/.test(shaped.text.slice(part.index, end))) continue;
            for (const box of shaped.paragraph.getRectsForRange(
                part.index,
                end,
                this.ck.RectHeightStyle.Tight,
                this.ck.RectWidthStyle.Tight,
            )) {
                const [left, top, right, bottom] = box.rect;
                const rtl = box.dir === this.ck.TextDirection.RTL;
                result.push(
                    { offset: part.index - row.prefix, x: rtl ? right : left, top, bottom, affinity: 'downstream' },
                    { offset: end - row.prefix, x: rtl ? left : right, top, bottom, affinity: 'upstream' },
                );
            }
        }
        if (!result.length) {
            const prefix =
                row.prefix && row.line.start < row.prefix
                    ? shaped.paragraph
                          .getRectsForRange(
                              row.prefix - 1,
                              row.prefix,
                              this.ck.RectHeightStyle.Tight,
                              this.ck.RectWidthStyle.Tight,
                          )
                          .at(-1)
                    : undefined;
            result.push({
                offset: Math.max(0, row.line.start - row.prefix),
                x: prefix
                    ? prefix.rect[prefix.dir === this.ck.TextDirection.RTL ? 0 : 2]
                    : row.line.left + (shaped.direction === 'rtl' ? row.line.width : 0),
                top: prefix?.rect[1] ?? row.line.top,
                bottom: prefix?.rect[3] ?? row.line.bottom,
                affinity: 'downstream',
            });
        }
        result.sort((a, b) => a.x - b.x || a.offset - b.offset);
        this.stops.set(row, result);
        return result;
    }

    caret(target: TextCaret, affinity: CaretAffinity = 'downstream'): (CaretStop & { row: NavigationRow }) | undefined {
        const row = this.row(target, affinity);
        if (!row) return;
        const stops = this.lineStops(row);
        const stop =
            stops.find((stop) => stop.offset === target.offset && stop.affinity === affinity) ??
            stops.find((stop) => stop.offset === target.offset) ??
            stops.reduce((best, stop) =>
                Math.abs(stop.offset - target.offset) < Math.abs(best.offset - target.offset) ? stop : best,
            );
        return { ...stop, row };
    }

    horizontal(target: TextCaret, direction: -1 | 1, affinity: CaretAffinity, word = false): NavigationCaret {
        const current = this.caret(target, affinity);
        if (!current) return { ...target, affinity };
        const forward = direction === (current.row.placement.shaped.direction === 'rtl' ? -1 : 1);
        const blocks = this.blocks,
            index = blocks.findIndex((block) => block.id === target.blockId);
        const text = blockText(blocks[index]);
        let offset: number;
        if (word) offset = wordBoundary(text, target.offset, forward ? 1 : -1);
        else {
            const parts = graphemeRanges(current.row.placement.shaped),
                position = target.offset + current.row.prefix;
            let low = 0,
                high = parts.length;
            while (low < high) {
                const middle = (low + high) >>> 1;
                if (forward ? parts[middle].end <= position : parts[middle].index < position) low = middle + 1;
                else high = middle;
            }
            const part = parts[forward ? low : low - 1];
            offset =
                part && part.index >= current.row.prefix
                    ? (forward ? part.end : part.index) - current.row.prefix
                    : target.offset;
        }
        if (offset !== target.offset)
            return {
                blockId: target.blockId,
                offset,
                affinity: forward && text[offset - 1] !== '\n' ? 'upstream' : 'downstream',
            };
        const next = blocks[index + (forward ? 1 : -1)];
        if (!next) return { ...target, affinity };
        const value = blockText(next);
        return {
            blockId: next.id,
            offset: forward ? 0 : value.length,
            affinity: !forward && !value.endsWith('\n') ? 'upstream' : 'downstream',
        };
    }

    vertical(
        target: TextCaret,
        direction: -1 | 1,
        affinity: CaretAffinity,
        column?: number,
    ): { caret: NavigationCaret; column: number } | undefined {
        const current = this.caret(target, affinity);
        if (!current) return;
        column ??= (current.row.placement.left ?? this.scene.margin) + current.x;
        const next = this.rows[this.rows.indexOf(current.row) + direction];
        if (!next) return;
        const x = column - (next.placement.left ?? this.scene.margin);
        const stop = this.lineStops(next).reduce((best, stop) =>
            Math.abs(stop.x - x) < Math.abs(best.x - x) ? stop : best,
        );
        return { caret: { blockId: next.blockId, offset: stop.offset, affinity: stop.affinity }, column };
    }

    edge(target: TextCaret, end: boolean, affinity: CaretAffinity): NavigationCaret {
        const row = this.row(target, affinity);
        return row
            ? {
                  blockId: row.blockId,
                  offset: Math.max(0, (end ? row.line.end : row.line.start) - row.prefix),
                  affinity: end ? 'upstream' : 'downstream',
              }
            : { ...target, affinity };
    }

    boundary(end: boolean): NavigationCaret | undefined {
        const block = end ? this.blocks.at(-1) : this.blocks[0];
        return block
            ? { blockId: block.id, offset: end ? blockText(block).length : 0, affinity: 'downstream' }
            : undefined;
    }

    paragraph(target: TextCaret, direction: -1 | 1): NavigationCaret {
        const blocks = this.blocks,
            index = blocks.findIndex((block) => block.id === target.blockId);
        if (index < 0) return { ...target, affinity: 'downstream' };
        const next = direction < 0 && target.offset ? blocks[index] : blocks[index + direction];
        return next ? { blockId: next.id, offset: 0, affinity: 'downstream' } : { ...target, affinity: 'downstream' };
    }

    parallel(target: TextCaret, direction: -1 | 1): NavigationCaret | undefined {
        const path = this.paths.get(target.blockId);
        const index = path?.map((node) => node.kind).lastIndexOf('parallelRow') ?? -1;
        if (!path || index < 0) return;
        const row = path[index],
            current = path[index + 1];
        const cells = (row.children ?? [])
            .flatMap((cell) => {
                const blocks = textBlocks(cell).filter((block) => this.byBlock.get(block.id)?.length);
                const positions = blocks.flatMap((block) => this.byBlock.get(block.id) ?? []);
                return positions.length
                    ? [
                          {
                              cell,
                              blocks,
                              x: Math.min(...positions.map((row) => row.placement.left ?? this.scene.margin)),
                          },
                      ]
                    : [];
            })
            .sort((a, b) => a.x - b.x);
        const next = cells[cells.findIndex(({ cell }) => cell.id === current.id) + direction];
        const block = next?.blocks.at(-1);
        return block
            ? { blockId: block.id, offset: blockText(block).length, affinity: 'upstream' }
            : { ...target, affinity: 'downstream' };
    }

    page(
        target: TextCaret,
        direction: -1 | 1,
        height: number,
        affinity: CaretAffinity,
        column?: number,
    ): { caret: NavigationCaret; column: number } | undefined {
        const current = this.caret(target, affinity);
        if (!current) return;
        column ??= (current.row.placement.left ?? this.scene.margin) + current.x;
        const pageTops: number[] = [];
        let top = 0;
        for (const page of this.scene.pages) {
            pageTops.push(top);
            top += page.height + 21;
        }
        const desired = pageTops[current.row.pageIndex] + current.row.placement.top + direction * height;
        const distance = (row: NavigationRow): number => {
            const left = row.placement.left ?? this.scene.margin;
            const dx = Math.max(left - column!, 0, column! - left - row.placement.shaped.width);
            const dy = pageTops[row.pageIndex] + row.placement.top - desired;
            return dx * dx + dy * dy;
        };
        const row = this.rows.reduce((best, row) => (distance(row) < distance(best) ? row : best));
        const x = column - (row.placement.left ?? this.scene.margin);
        const stop = this.lineStops(row).reduce((best, stop) =>
            Math.abs(stop.x - x) < Math.abs(best.x - x) ? stop : best,
        );
        return { caret: { blockId: row.blockId, offset: stop.offset, affinity: stop.affinity }, column };
    }

    collapse(selection: NativeSelection, direction: -1 | 1): NavigationCaret {
        const ranges = selectionRanges(this.document, selection),
            first = ranges[0],
            last = ranges.at(-1)!;
        const start = { blockId: first.blockId, offset: first.from },
            end = { blockId: last.blockId, offset: last.to };
        const a = this.caret(start, 'downstream');
        const forward = direction === (a?.row.placement.shaped.direction === 'rtl' ? -1 : 1);
        return forward ? { ...end, affinity: 'upstream' } : { ...start, affinity: 'downstream' };
    }
}
