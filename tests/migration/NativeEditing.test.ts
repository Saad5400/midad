import {
    DocumentSession,
    exportDocument,
    findNode,
    importDocument,
    type NativeDocument,
} from '@saad5400/midad/document';
import {
    blockText,
    joinPreviousTextBlock,
    replaceInlineText,
    splitTextBlock,
    textDifference,
} from '@saad5400/midad/editing';
import { describe, expect, it } from 'vitest';

const source = () =>
    importDocument(
        {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    attrs: { id: 'p', dir: 'rtl' },
                    content: [
                        { type: 'text', text: 'نص ', marks: [{ type: 'bold' }] },
                        { type: 'text', text: 'عادي', marks: [{ type: 'italic' }] },
                        { type: 'variable', attrs: { id: 'field', type: 'signature', participant_id: 'party' } },
                        { type: 'text', text: ' نهاية' },
                    ],
                },
            ],
        },
        'contract',
    );
function edit(document: NativeDocument, from: number, to: number, text: string) {
    return replaceInlineText(document, { blockId: 'p', from, to, text, expectedRevision: document.revision });
}

describe('native paragraph editing', () => {
    it('inherits the selected run when replacing a selection at a style boundary', () => {
        const base = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        attrs: { id: 'p' },
                        content: [
                            { type: 'text', text: 'Bold ', marks: [{ type: 'bold' }] },
                            { type: 'text', text: 'Italic', marks: [{ type: 'italic' }] },
                        ],
                    },
                ],
            },
            'boundary',
        );
        const selected = replaceInlineText(base, {
            blockId: 'p',
            from: 5,
            to: 11,
            text: 'New',
            expectedRevision: base.revision,
        });
        expect(findNode(selected, 'p')!.children!.map((node) => [node.text, node.marks])).toEqual([
            ['Bold ', [{ kind: 'bold' }]],
            ['New', [{ kind: 'italic' }]],
        ]);
        const inserted = replaceInlineText(base, {
            blockId: 'p',
            from: 5,
            to: 5,
            text: 'New',
            expectedRevision: base.revision,
        });
        expect(findNode(inserted, 'p')!.children![0].text).toBe('Bold New');
    });
    it('replaces selections across styled runs without losing untouched marks, fields or block metadata', () => {
        const document = edit(source(), 1, 5, 'جديد');
        const paragraph = findNode(document, 'p')!;
        expect(blockText(paragraph)).toBe('نجديددي\uFFFC نهاية');
        expect(paragraph.attributes).toEqual({ id: 'p', dir: 'rtl' });
        expect(paragraph.children![0].marks).toEqual([{ kind: 'bold' }]);
        expect(paragraph.children![1].marks).toEqual([{ kind: 'italic' }]);
        expect(findNode(document, 'field')?.attributes).toMatchObject({ type: 'signature', participant_id: 'party' });
    });

    it('edits empty paragraphs and coalesces typing instead of creating a run per keystroke', () => {
        let document = importDocument(
            { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'p' } }] },
            'contract',
        );
        for (let index = 0; index < 100; index++) document = edit(document, index, index, 'a');
        expect(findNode(document, 'p')!.children).toHaveLength(1);
        expect(blockText(findNode(document, 'p')!)).toBe('a'.repeat(100));
    });

    it('preserves hard breaks and allows atomic inline fields to be deleted as a whole', () => {
        const document = edit(source(), 7, 8, '\n');
        expect(findNode(document, 'field')).toBeUndefined();
        expect(blockText(findNode(document, 'p')!)).toBe('نص عادي\n نهاية');
        expect(findNode(document, 'p')!.children!.some((node) => node.kind === 'hardBreak')).toBe(true);
    });

    it('splits and rejoins nested table paragraphs with unique identities and undo history', () => {
        const document = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'table',
                        content: [
                            {
                                type: 'tableRow',
                                content: [
                                    {
                                        type: 'tableCell',
                                        content: [
                                            {
                                                type: 'paragraph',
                                                attrs: { id: 'p' },
                                                content: [
                                                    {
                                                        type: 'text',
                                                        attrs: { id: 'text' },
                                                        text: 'before after',
                                                        marks: [{ type: 'bold' }],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            'contract',
        );
        const session = new DocumentSession(document);
        const split = splitTextBlock(session.document, { blockId: 'p', from: 6, to: 7, expectedRevision: 0 });
        session.commit(split.document);
        expect(blockText(findNode(session.document, 'p')!)).toBe('before');
        expect(blockText(findNode(session.document, split.caret.blockId)!)).toBe('after');
        const exported = exportDocument(session.document);
        expect(() => importDocument(exported, 'contract')).not.toThrow();
        const joined = joinPreviousTextBlock(session.document, split.caret.blockId)!;
        expect(joined.caret).toEqual({ blockId: 'p', offset: 6 });
        session.commit(joined.document);
        expect(blockText(findNode(session.document, 'p')!)).toBe('beforeafter');
        session.undo();
        expect(findNode(session.document, split.caret.blockId)).toBeDefined();
        session.undo();
        expect(session.document.root).toEqual(document.root);
    });

    it('joins top-level paragraphs and never joins text across separate table cells', () => {
        const document = importDocument(
            {
                type: 'doc',
                content: [
                    { type: 'paragraph', attrs: { id: 'first' }, content: [{ type: 'text', text: 'a' }] },
                    { type: 'paragraph', attrs: { id: 'p' }, content: [{ type: 'text', text: 'b' }] },
                ],
            },
            'contract',
        );
        const joined = joinPreviousTextBlock(document, 'p')!;
        expect(joined.document.root.children).toHaveLength(1);
        expect(blockText(findNode(joined.document, 'first')!)).toBe('ab');
        expect(joinPreviousTextBlock(source(), 'p')).toBeNull();
    });

    it('rejects stale revisions and partial grapheme edits', () => {
        const document = importDocument(
            {
                type: 'doc',
                content: [{ type: 'paragraph', attrs: { id: 'p' }, content: [{ type: 'text', text: 'عَ👩‍👩‍👧‍👦' }] }],
            },
            'contract',
        );
        expect(() => edit(document, 1, 2, '')).toThrow('grapheme');
        expect(() =>
            replaceInlineText(document, { blockId: 'p', from: 0, to: 0, text: 'a', expectedRevision: 2 }),
        ).toThrow('conflict');
        expect(textDifference('عَ👩‍👩‍👧‍👦', 'عُ👩‍👩‍👧‍👦')).toEqual({ from: 0, to: 2, text: 'عُ' });
    });

    it('uses the actual selection to disambiguate repeated text at formatting boundaries', () => {
        expect(textDifference('aaa', 'aaaa', { from: 1, to: 1 })).toEqual({ from: 1, to: 1, text: 'a' });
        expect(textDifference('aaa', 'aa', { from: 1, to: 1 })).toEqual({ from: 1, to: 2, text: '' });
        expect(textDifference('aba', 'a', { from: 0, to: 3 })).toEqual({ from: 0, to: 3, text: 'a' });
    });
});
