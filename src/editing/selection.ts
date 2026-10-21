import { findNode, type NativeDocument, type NativeNode } from '../document/model.js';
import { tableRectangle, type TableCellSelection } from './table-grid.js';
import { replaceTableCells } from './tables.js';
import { blockText, replaceInlineText, textBlocks, type TextCaret } from './text.js';

export interface NativeSelection {
    readonly anchor: TextCaret;
    readonly focus: TextCaret;
    readonly scopeId?: string;
    readonly cells?: TableCellSelection;
}

export { textBlocks } from './text.js';

export function selectionRanges(
    document: NativeDocument,
    selection: NativeSelection,
): Array<{
    blockId: string;
    from: number;
    to: number;
}> {
    if (selection.cells) {
        const rectangle = tableRectangle(document, selection.cells);
        if (!rectangle) throw new Error('The cell selection is no longer in the document');
        return rectangle.cells.flatMap((cell) =>
            textBlocks(cell.node).map((block) => ({ blockId: block.id, from: 0, to: blockText(block).length })),
        );
    }
    const blocks = textBlocks(document.root);
    let first = blocks.findIndex((block) => block.id === selection.anchor.blockId);
    let last = blocks.findIndex((block) => block.id === selection.focus.blockId);
    if (first < 0 || last < 0) throw new Error('The selection is no longer in the document');
    let start = selection.anchor.offset,
        end = selection.focus.offset;
    if (first > last || (first === last && start > end)) {
        [first, last] = [last, first];
        [start, end] = [end, start];
    }
    return blocks.slice(first, last + 1).map((block, index) => ({
        blockId: block.id,
        from: index === 0 ? start : 0,
        to: first + index === last ? end : blockText(block).length,
    }));
}

export function selectedText(document: NativeDocument, selection: NativeSelection): string {
    if (selection.cells) {
        const rectangle = tableRectangle(document, selection.cells);
        if (!rectangle) return '';
        const { cells, top, bottom, left, right } = rectangle;
        return Array.from({ length: bottom - top }, (_, row) =>
            Array.from({ length: right - left }, (_, column) => {
                const cell = cells.find((cell) => cell.row === row + top && cell.column === column + left);
                return cell ? textBlocks(cell.node).map(blockText).join('\n') : '';
            }).join('\t'),
        ).join('\n');
    }
    return selectionRanges(document, selection)
        .map((range) => blockText(findNode(document, range.blockId)!).slice(range.from, range.to))
        .join('\n');
}

export function selectNodeText(node: NativeNode): NativeSelection | null {
    const blocks = textBlocks(node);
    if (!blocks.length) return null;
    return {
        scopeId: node.id,
        anchor: { blockId: blocks[0].id, offset: 0 },
        focus: { blockId: blocks.at(-1)!.id, offset: blockText(blocks.at(-1)!).length },
    };
}

export function selectionRegion(root: NativeNode, blockId: string): NativeNode {
    const visit = (node: NativeNode, region: NativeNode): NativeNode | undefined => {
        const next = ['tableCell', 'tableHeader', 'parallelCell'].includes(node.kind) ? node : region;
        if (node.id === blockId) return next;
        for (const child of node.children ?? []) {
            const found = visit(child, next);
            if (found) return found;
        }
    };
    return visit(root, root) ?? root;
}

export function wordRange(text: string, offset: number): { from: number; to: number } {
    const parts = [...new Intl.Segmenter('und', { granularity: 'word' }).segment(text)];
    const index = Math.max(0, Math.min(offset, text.length - 1));
    const part = parts.find((part) => index >= part.index && index < part.index + part.segment.length);
    return part ? { from: part.index, to: part.index + part.segment.length } : { from: 0, to: 0 };
}

export function replaceSelection(
    document: NativeDocument,
    selection: NativeSelection,
    text: string,
): {
    document: NativeDocument;
    caret: TextCaret;
} {
    if (selection.cells) {
        const result = replaceTableCells(document, selection.cells, text);
        if (!result) throw new Error('The cell selection is no longer in the document');
        return result;
    }
    const ranges = selectionRanges(document, selection);
    if (selection.scopeId) {
        const region = findNode(document, selection.scopeId);
        if (!region) throw new Error('The selection region no longer exists');
        const firstRange = ranges[0];
        const replaced = replaceInlineText(document, { ...firstRange, text, expectedRevision: document.revision });
        const head = findNode(replaced, firstRange.blockId)!;
        if (region.id === head.id) return { document: replaced, caret: { blockId: head.id, offset: text.length } };
        const paragraph = head.kind === 'clauseTitle' ? Object.freeze({ ...head, kind: 'paragraph' }) : head;
        if (replaced === document && region.children?.length === 1 && region.children[0] === paragraph)
            return { document, caret: { blockId: head.id, offset: text.length } };
        const visit = (node: NativeNode): NativeNode => {
            if (node.id === region.id) return Object.freeze({ ...node, children: Object.freeze([paragraph]) });
            if (!node.children) return node;
            const children = node.children.map(visit);
            return children.some((child, index) => child !== node.children![index])
                ? Object.freeze({ ...node, children: Object.freeze(children) })
                : node;
        };
        return {
            document: Object.freeze({ ...replaced, revision: document.revision + 1, root: visit(document.root) }),
            caret: { blockId: head.id, offset: text.length },
        };
    }
    const first = ranges[0],
        last = ranges.at(-1)!;
    let next = document;
    for (const range of [...ranges].reverse())
        next = replaceInlineText(next, {
            ...range,
            text: range === first ? text : '',
            expectedRevision: next.revision,
        });
    if (ranges.length > 1) {
        const selectedIds = new Set(ranges.slice(1).map((range) => range.blockId));
        const lastNode = findNode(next, last.blockId)!;
        const merge = (node: NativeNode): NativeNode => {
            if (!node.children) return node;
            const firstIndex = node.children.findIndex((child) => child.id === first.blockId);
            const lastIndex = node.children.findIndex((child) => child.id === last.blockId);
            if (
                firstIndex >= 0 &&
                lastIndex > firstIndex &&
                node.children.slice(firstIndex + 1, lastIndex + 1).every((child) => selectedIds.has(child.id))
            ) {
                const head = node.children[firstIndex];
                const joined = Object.freeze({
                    ...head,
                    children: Object.freeze([...(head.children ?? []), ...(lastNode.children ?? [])]),
                });
                return Object.freeze({
                    ...node,
                    children: Object.freeze([
                        ...node.children.slice(0, firstIndex),
                        joined,
                        ...node.children.slice(lastIndex + 1),
                    ]),
                });
            }
            const children = node.children.map(merge);
            return children.some((child, index) => child !== node.children![index])
                ? Object.freeze({ ...node, children: Object.freeze(children) })
                : node;
        };
        next = Object.freeze({ ...next, root: merge(next.root) });
    }
    return {
        document: Object.freeze({ ...next, revision: document.revision + 1 }),
        caret: { blockId: first.blockId, offset: first.from + text.length },
    };
}
