import { copyJson, findNode, type Attributes, type NativeDocument, type NativeMark } from '../document/model.js';
import { blockText, nodePath } from '../document/text.js';
import { commandSelection, type CommandTrigger } from './command.js';
import { selectionRanges, type NativeSelection } from './selection.js';
import { resolveWritingTarget, type WritingTarget } from './writing-position.js';

export interface CommandBookmark {
    readonly document: NativeDocument;
    readonly selection: NativeSelection | null;
    readonly target?: WritingTarget;
    readonly trigger?: CommandTrigger;
    readonly marks?: readonly NativeMark[];
    readonly objectId?: string;
}

export function captureCommandBookmark(bookmark: CommandBookmark): CommandBookmark {
    const selection = bookmark.selection;
    return Object.freeze({
        ...bookmark,
        selection: selection
            ? Object.freeze({
                  ...selection,
                  anchor: Object.freeze({ ...selection.anchor }),
                  focus: Object.freeze({ ...selection.focus }),
                  ...(selection.cells ? { cells: Object.freeze({ ...selection.cells }) } : {}),
              })
            : null,
        ...(bookmark.target ? { target: Object.freeze({ ...bookmark.target }) } : {}),
        ...(bookmark.trigger ? { trigger: Object.freeze({ ...bookmark.trigger }) } : {}),
        ...(bookmark.marks
            ? {
                  marks: Object.freeze(
                      bookmark.marks.map((mark) =>
                          Object.freeze({
                              ...mark,
                              ...(mark.attributes ? { attributes: copyJson(mark.attributes) as Attributes } : {}),
                          }),
                      ),
                  ),
              }
            : {}),
    });
}

function fingerprint(document: NativeDocument, selection: NativeSelection) {
    for (const point of [selection.anchor, selection.focus]) {
        const node = findNode(document, point.blockId);
        if (!node) throw new Error('The selection no longer exists');
        const text = blockText(node),
            offset = point.offset;
        if (
            !Number.isSafeInteger(offset) ||
            offset < 0 ||
            offset > text.length ||
            (offset !== 0 &&
                offset !== text.length &&
                ![...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)].some(
                    (part) => part.index === offset,
                ))
        )
            throw new Error('The selection boundary is invalid');
    }
    return selectionRanges(document, selection).map((range) => {
        const node = findNode(document, range.blockId)!;
        if (selection.scopeId && !nodePath(document, node.id).some((parent) => parent.id === selection.scopeId))
            throw new Error('The selection left its container');
        return { id: node.id, kind: node.kind, text: blockText(node) };
    });
}

export function commandBookmarkValid(document: NativeDocument, bookmark: CommandBookmark, objectId?: string): boolean {
    if (document.id !== bookmark.document.id || (bookmark.objectId && bookmark.objectId !== objectId)) return false;
    try {
        if (bookmark.trigger) {
            fingerprint(document, commandSelection(document, bookmark.trigger));
            return true;
        }
        if (bookmark.objectId) return true;
        if (!bookmark.selection) {
            resolveWritingTarget(document, bookmark.target);
            return true;
        }
        const current = fingerprint(document, bookmark.selection);
        return (
            document === bookmark.document ||
            JSON.stringify(current) === JSON.stringify(fingerprint(bookmark.document, bookmark.selection))
        );
    } catch {
        return false;
    }
}
