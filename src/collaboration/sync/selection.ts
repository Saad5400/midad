import type { NativeDocument } from '../../document/model.js';
import type { NativeSelection } from '../../editing/selection.js';
import { blockText, textBlocks } from '../../editing/text.js';
import type { SharedNativeDocument, SharedCaret } from '../document.js';

export function captureSelection(
    shared: SharedNativeDocument | undefined,
    selection: NativeSelection | null,
): {
    anchor: SharedCaret | null;
    focus: SharedCaret | null;
    scopeId?: string;
    cells?: NativeSelection['cells'];
} | null {
    if (!selection || !shared) return null;
    const blocks = textBlocks(shared.document().root).map((block) => block.id);
    const collapsed =
        selection.anchor.blockId === selection.focus.blockId && selection.anchor.offset === selection.focus.offset;
    const forward =
        selection.anchor.blockId === selection.focus.blockId
            ? selection.anchor.offset < selection.focus.offset
            : blocks.indexOf(selection.anchor.blockId) < blocks.indexOf(selection.focus.blockId);
    return {
        anchor: shared.caret(selection.anchor, collapsed || !forward ? -1 : 0),
        focus: shared.caret(selection.focus, collapsed || forward ? -1 : 0),
        scopeId: selection.scopeId,
        cells: selection.cells,
    };
}
export function resolveSelection(
    shared: SharedNativeDocument | undefined,
    selection: ReturnType<typeof captureSelection>,
): NativeSelection | null {
    const anchor = selection?.anchor && shared?.resolve(selection.anchor),
        focus = selection?.focus && shared?.resolve(selection.focus);
    return anchor && focus ? { anchor, focus, scopeId: selection?.scopeId, cells: selection?.cells } : null;
}

export function clampSelection(document: NativeDocument, selection: NativeSelection | null): NativeSelection | null {
    const blocks = new Map(textBlocks(document.root).map((block) => [block.id, block]));
    const clamp = (point: NativeSelection['anchor']) => {
        const block = blocks.get(point.blockId);
        if (!block) return null;
        const text = blockText(block),
            offset = Math.min(point.offset, text.length);
        const boundaries = [
            0,
            ...Array.from(new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text), (part) => part.index),
            text.length,
        ];
        return {
            blockId: point.blockId,
            offset: boundaries.findLast((boundary) => boundary <= offset) ?? 0,
        };
    };
    const anchor = selection && clamp(selection.anchor),
        focus = selection && clamp(selection.focus);
    return anchor && focus ? { anchor, focus } : null;
}
