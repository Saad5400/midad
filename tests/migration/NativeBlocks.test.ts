import { blockContext, deleteBlock, moveBlock, moveBlockStep } from '@saad5400/midad/blocks';
import { DocumentSession, findNode, importDocument } from '@saad5400/midad/document';
import { blockText, replaceInlineText, splitTextBlock, textBlocks } from '@saad5400/midad/editing';
import { SharedNativeDocument } from '@saad5400/midad/shared-document';
import { describe, expect, it } from 'vitest';

const p = (id: string, text = id) => ({
    type: 'paragraph',
    attrs: { nativeId: id },
    content: [{ type: 'text', text }],
});
const doc = (...content: unknown[]) => importDocument({ type: 'doc', content }, 'blocks');
const order = (document: ReturnType<typeof doc>) => document.root.children!.map((node) => node.id);

describe('native block actions', () => {
    it('moves a whole table from an inner paragraph without changing its content or identities', () => {
        const document = doc(
            p('a'),
            {
                type: 'table',
                attrs: { nativeId: 'table' },
                content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('cell')] }] }],
            },
            p('b'),
        );
        expect(blockContext(document, 'cell')?.node.id).toBe('table');
        const moved = moveBlockStep(document, 'cell', 'down');
        expect(order(moved)).toEqual(['a', 'b', 'table']);
        expect(findNode(moved, 'table')).toBe(findNode(document, 'table'));
        expect(moveBlockStep(moved, 'cell', 'down')).toBe(moved);
    });
    it('reorders before and after another block and keeps undo and redo exact', () => {
        const document = doc(p('a'), p('b'), p('c'));
        const session = new DocumentSession(document);
        const moved = moveBlock(document, 'a', 'c', 'after');
        session.commit(moved);
        expect(order(moved)).toEqual(['b', 'c', 'a']);
        session.undo();
        expect(order(session.document)).toEqual(['a', 'b', 'c']);
        session.redo();
        expect(order(session.document)).toEqual(['b', 'c', 'a']);
        expect(moveBlock(document, 'a', 'a', 'after')).toBe(document);
    });
    it('never moves blocks across imported PDF pages', () => {
        const document = doc(p('a'), { type: 'pdfPage', attrs: { nativeId: 'pdf' } }, p('b'));
        expect(blockContext(document, 'a')?.canMoveDown).toBe(false);
        expect(blockContext(document, 'pdf')).toBeUndefined();
        expect(moveBlock(document, 'a', 'b', 'after')).toBe(document);
    });
    it('deletes the selected container and leaves an editable paragraph with an available caret', () => {
        const document = doc({
            type: 'bulletList',
            attrs: { nativeId: 'list' },
            content: [{ type: 'listItem', content: [p('a')] }],
        });
        const removed = deleteBlock(document, 'a')!;
        expect(findNode(removed.document, 'list')).toBeUndefined();
        expect(textBlocks(removed.document.root)).toHaveLength(1);
        expect(findNode(removed.document, removed.caret.blockId)?.kind).toBe('paragraph');
        expect(deleteBlock(document, 'missing')).toBeUndefined();
    });
    it('preserves peer text edits when a block is reordered', () => {
        const a = SharedNativeDocument.create(doc(p('a'), p('b')));
        const b = SharedNativeDocument.fromState(a.state(), 'blocks');
        try {
            a.publish(moveBlockStep(a.document(), 'a', 'down'));
            b.publish(
                replaceInlineText(b.document(), {
                    blockId: 'a',
                    from: 1,
                    to: 1,
                    text: ' peer',
                    expectedRevision: b.document().revision,
                }),
            );
            a.receive(b.state());
            b.receive(a.state());
            expect(order(a.document())).toEqual(['b', 'a']);
            expect(textBlocks(a.document().root).map(blockText)).toEqual(['b', 'a peer']);
            expect(order(b.document())).toEqual(order(a.document()));
        } finally {
            a.destroy();
            b.destroy();
        }
    });
    it('allows explicit reordering after splitting a paragraph and retains shared undo', () => {
        const a = SharedNativeDocument.create(doc(p('a', 'FirstSecond'), p('b')));
        try {
            a.publish(
                splitTextBlock(a.document(), { blockId: 'a', from: 5, to: 5, expectedRevision: a.document().revision })
                    .document,
            );
            a.undoManager.stopCapturing();
            const split = textBlocks(a.document().root)[1];
            a.publish(moveBlockStep(a.document(), split.id, 'up'));
            expect(textBlocks(a.document().root).map(blockText)).toEqual(['Second', 'First', 'b']);
            const restored = SharedNativeDocument.fromState(a.state(), 'blocks');
            try {
                expect(textBlocks(restored.document().root).map(blockText)).toEqual(['Second', 'First', 'b']);
            } finally {
                restored.destroy();
            }
            expect(textBlocks(a.undo().root).map(blockText)).toEqual(['First', 'Second', 'b']);
            expect(textBlocks(a.redo().root).map(blockText)).toEqual(['Second', 'First', 'b']);
        } finally {
            a.destroy();
        }
    });
});
