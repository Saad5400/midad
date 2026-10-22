import { findNode, type NativeDocument, type NativeNode } from '../../document/model.js';
import { marksAtCaret } from '../../editing/formatting.js';
import { replaceSelection, selectionRanges, type NativeSelection } from '../../editing/selection.js';
import { pasteTableCells } from '../../editing/tables.js';
import { pasteBlocks, type TextCaret } from '../../editing/text.js';
import type { NativeFragment } from './model.js';

export function pasteFragment(
    document: NativeDocument,
    selection: NativeSelection,
    fragment: NativeFragment,
): { document: NativeDocument; caret: TextCaret } {
    if (!fragment.blocks.length) return { document, caret: selection.focus };
    if (selection.cells) return pasteTableCells(document, selection.cells, fragment.blocks, fragment.plain);
    const ranges = selectionRanges(document, selection);
    let base = document,
        caret = { blockId: ranges[0].blockId, offset: ranges[0].from };
    if (selection.cells || selection.scopeId || ranges.length > 1)
        ({ document: base, caret } = replaceSelection(document, selection, ''));
    const inherited = fragment.plain ? marksAtCaret(findNode(document, ranges[0].blockId)!, ranges[0].from) : undefined;
    const inherit = (node: NativeNode): NativeNode =>
        node.kind === 'text'
            ? { ...node, marks: inherited }
            : node.children
              ? { ...node, children: node.children.map(inherit) }
              : node;
    const blocks = inherited ? fragment.blocks.map(inherit) : fragment.blocks;
    const result = pasteBlocks(
        base,
        {
            blockId: caret.blockId,
            from: caret.offset,
            to: base === document ? ranges[0].to : caret.offset,
            expectedRevision: base.revision,
        },
        blocks,
    );
    return { ...result, document: Object.freeze({ ...result.document, revision: document.revision + 1 }) };
}
