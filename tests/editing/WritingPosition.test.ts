import { DocumentSession, exportDocument, findNode, importDocument } from '@saad5400/midad/document';
import { blockText, replaceInlineText } from '@saad5400/midad/editing';
import { insertNativeField } from '@saad5400/midad/content/fields';
import { insertTable } from '@saad5400/midad/editing';
import { writeAtPosition } from '@saad5400/midad/editing';
import { describe, expect, it } from 'vitest';

const edit =
    (text: string) =>
    (
        document: Parameters<typeof writeAtPosition>[0],
        selection: Parameters<Parameters<typeof writeAtPosition>[3]>[1],
    ) => ({
        document: replaceInlineText(document, {
            blockId: selection.focus.blockId,
            from: selection.focus.offset,
            to: selection.focus.offset,
            expectedRevision: document.revision,
            text,
        }),
        caret: { blockId: selection.focus.blockId, offset: selection.focus.offset + text.length },
    });
describe('atomic writing positions', () => {
    it('creates the first paragraph and text in one revision and one undo step', () => {
        const document = importDocument({ type: 'doc', attrs: { retained: ['metadata'] } }, 'empty');
        const before = exportDocument(document),
            session = new DocumentSession(document);
        const result = writeAtPosition(document, null, undefined, edit('مرحبا Hello'))!;
        expect(result.document.revision).toBe(1);
        expect(blockText(findNode(result.document, result.caret.blockId)!)).toBe('مرحبا Hello');
        expect(exportDocument(document)).toEqual(before);
        session.commit(result.document);
        expect(session.undo()).toBe(true);
        expect(exportDocument(session.document)).toEqual(before);
        expect(session.redo()).toBe(true);
        expect(blockText(findNode(session.document, result.caret.blockId)!)).toBe('مرحبا Hello');
    });
    it.each(['parallelCell', 'tableCell', 'tableHeader', 'clauseBody', 'listItem', 'blockquote'])(
        'creates content only inside the selected empty %s',
        (kind) => {
            const document = importDocument(
                {
                    type: 'doc',
                    content: [
                        { type: kind, attrs: { id: 'target', retained: 'value' }, content: [] },
                        { type: 'paragraph', attrs: { id: 'neighbor' }, content: [{ type: 'text', text: 'Keep me' }] },
                    ],
                },
                'container',
            );
            const neighbor = findNode(document, 'neighbor');
            const result = writeAtPosition(document, null, { containerId: 'target' }, edit('New text'))!;
            expect(findNode(result.document, 'neighbor')).toBe(neighbor);
            expect(findNode(result.document, 'target')?.attributes?.retained).toBe('value');
            expect(findNode(result.document, 'target')?.children?.[0].id).toBe(result.caret.blockId);
        },
    );
    it('inserts after a structural node without crossing its language-column boundary', () => {
        const document = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'parallelRow',
                        content: [
                            {
                                type: 'parallelCell',
                                attrs: { id: 'column' },
                                content: [{ type: 'horizontalRule', attrs: { id: 'rule' } }],
                            },
                            {
                                type: 'parallelCell',
                                attrs: { id: 'peer' },
                                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Unchanged' }] }],
                            },
                        ],
                    },
                ],
            },
            'after',
        );
        const peer = findNode(document, 'peer');
        const result = writeAtPosition(document, null, { containerId: 'column', afterId: 'rule' }, edit('After rule'))!;
        expect(findNode(result.document, 'column')?.children?.map((node) => node.kind)).toEqual([
            'horizontalRule',
            'paragraph',
        ]);
        expect(findNode(result.document, 'peer')).toBe(peer);
        expect(() => writeAtPosition(document, null, { containerId: 'peer', afterId: 'rule' }, edit('Wrong'))).toThrow(
            'container',
        );
    });
    it('supports structured insertion and field metadata without a pre-existing paragraph', () => {
        const document = importDocument({ type: 'doc' }, 'structured');
        const table = writeAtPosition(document, null, undefined, (prepared, range) =>
            insertTable(prepared, range.focus, 2, 2, true),
        )!;
        expect(table.document.revision).toBe(1);
        const field = writeAtPosition(document, null, undefined, (prepared, range) =>
            insertNativeField(
                prepared,
                { blockId: range.focus.blockId, from: 0, to: 0, expectedRevision: prepared.revision },
                { type: 'text', name: 'Name' },
            ),
        )!;
        expect(field.fieldId).toBeTruthy();
        expect(findNode(field.document, field.fieldId)?.attributes?.name).toBe('Name');
        expect(field.document.revision).toBe(1);
    });
    it('discards no-ops and failed actions without changing the original document', () => {
        const document = importDocument({ type: 'doc' }, 'cancel'),
            before = exportDocument(document);
        expect(writeAtPosition(document, null, undefined, edit(''))).toBeUndefined();
        expect(() =>
            writeAtPosition(document, null, undefined, () => {
                throw new Error('Cancelled');
            }),
        ).toThrow('Cancelled');
        expect(exportDocument(document)).toEqual(before);
        expect(() => writeAtPosition(document, null, { afterId: 'gone' }, edit('New'))).toThrow('anchor');
        expect(() => writeAtPosition(document, null, { afterId: document.root.id }, edit('New'))).toThrow('anchor');
        expect(writeAtPosition(document, null, undefined, () => ({ document }))).toBeUndefined();
    });
    it('does not seed flow content into an imported frozen PDF body', () => {
        const document = importDocument(
            { type: 'doc', content: [{ type: 'pdfPage', attrs: { src: 'source', width: 100, height: 100 } }] },
            'pdf',
        );
        expect(() => writeAtPosition(document, null, undefined, edit('No'))).toThrow('imported PDF');
    });
});
