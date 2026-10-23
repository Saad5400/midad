import {
    changeClauseVariant,
    createNativeClause,
    nativeClauses,
    persistClauseVariants,
    type LibraryClause,
} from '@saad5400/midad/content/clauses';
import { exportDocument, importDocument } from '@saad5400/midad/document';
import {
    blockText,
    deleteBlock,
    joinPreviousTextBlock,
    moveBlock,
    replaceBlockNode,
    replaceInlineText,
    splitTextBlock,
    textBlocks,
} from '@saad5400/midad/editing';
import { nativeFields } from '@saad5400/midad/content/fields';
import { formatText } from '@saad5400/midad/editing';
import { SharedNativeDocument } from '@saad5400/midad/collaboration';
import { readSharedAttributes } from '@saad5400/midad/collaboration';
import { nodeTextStyle } from '@saad5400/midad/typography';
import {
    mergeTableCells,
    resizeTableColumns,
    splitTableCell,
    tableCommand,
    type TableCommand,
} from '@saad5400/midad/editing';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { makeNativeFixture, makeNestedRichFixture } from '../fixtures/nativeDocument';

const create = (text = 'Hello العربية world') =>
    SharedNativeDocument.create(
        importDocument(
            { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
            'shared-test',
        ),
    );
const edit = (shared: SharedNativeDocument, from: number, to: number, text: string) => {
    const document = shared.document(),
        block = textBlocks(document.root)[0];
    shared.publish(
        replaceInlineText(document, { blockId: block.id, from, to, text, expectedRevision: document.revision }),
    );
};
const text = (shared: SharedNativeDocument) => textBlocks(shared.document().root).map(blockText).join('\n');
function peers() {
    const a = create(),
        b = SharedNativeDocument.fromState(a.state(), a.document().id);
    return { a, b };
}
function merge(a: SharedNativeDocument, b: SharedNativeDocument): void {
    const fromA = a.state(b.vector()),
        fromB = b.state(a.vector());
    a.receive(fromB);
    b.receive(fromA);
}
function independentPeers() {
    const seed = SharedNativeDocument.create(
        importDocument(
            {
                type: 'doc',
                content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
                    { type: 'horizontalRule', attrs: { nativeId: 'divider' } },
                    { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
                ],
            },
            'independent-join',
        ),
    );
    seed.publish(deleteBlock(seed.document(), 'divider')!.document, false);
    const a = SharedNativeDocument.fromState(seed.state(), seed.document().id);
    const b = SharedNativeDocument.fromState(seed.state(), seed.document().id);
    seed.destroy();
    return { a, b };
}

describe('our shared native document', () => {
    it('does not reuse an empty-container identity after its paragraph moves elsewhere', () => {
        const seed = SharedNativeDocument.create(
            importDocument(
                {
                    type: 'doc',
                    content: [
                        { type: 'blockquote', attrs: { id: 'quote' }, content: [] },
                        { type: 'paragraph', attrs: { id: 'sibling' }, content: [{ type: 'text', text: 'Sibling' }] },
                    ],
                },
                'empty-move',
            ),
        );
        const a = SharedNativeDocument.fromState(seed.state(), 'empty-move');
        const b = SharedNativeDocument.fromState(seed.state(), 'empty-move');
        try {
            const materialized = replaceBlockNode(a.document(), 'quote', (node) => ({
                ...node,
                attributes: { ...node.attributes, label: 'Materialized' },
            }));
            b.receive(a.publish(materialized));
            const paragraph = a.document().root.children![0].children![0];
            const root = a.document().root;
            const moved = {
                ...a.document(),
                revision: a.document().revision + 1,
                root: { ...root, children: [{ ...root.children![0], children: [] }, root.children![1], paragraph] },
            };
            expect(() => b.receive(a.publish(moved))).not.toThrow();
            const fresh = b.document().root.children![0].children![0];
            expect(fresh.id).not.toBe(paragraph.id);
            const changed = replaceBlockNode(b.document(), 'quote', (node) => ({
                ...node,
                attributes: { ...node.attributes, label: 'Again' },
            }));
            expect(() => a.receive(b.publish(changed))).not.toThrow();
            expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
        } finally {
            seed.destroy();
            a.destroy();
            b.destroy();
        }
    });
    it.each(['doc', 'tableCell', 'tableHeader', 'parallelCell', 'clauseBody', 'listItem', 'blockquote'])(
        'materializes an empty %s safely when only its metadata changes',
        (kind) => {
            const empty = { type: kind, attrs: { id: 'empty-container' }, content: [] };
            let root: unknown = { type: 'doc', content: [empty] };
            if (kind === 'doc') root = empty;
            if (kind === 'tableCell' || kind === 'tableHeader')
                root = { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [empty] }] }] };
            if (kind === 'parallelCell') root = { type: 'doc', content: [{ type: 'parallelRow', content: [empty] }] };
            if (kind === 'clauseBody')
                root = {
                    type: 'doc',
                    content: [
                        {
                            type: 'clause',
                            content: [{ type: 'clauseTitle', content: [{ type: 'text', text: 'Title' }] }, empty],
                        },
                    ],
                };
            if (kind === 'listItem') root = { type: 'doc', content: [{ type: 'bulletList', content: [empty] }] };
            const seed = SharedNativeDocument.create(importDocument(root, 'empty-shared'));
            const a = SharedNativeDocument.fromState(seed.state(), 'empty-shared');
            const b = SharedNativeDocument.fromState(seed.state(), 'empty-shared');
            try {
                const next = persistClauseVariants(
                    replaceBlockNode(a.document(), 'empty-container', (node) => ({
                        ...node,
                        attributes: { ...node.attributes, label: 'Changed' },
                    })),
                );
                const update = a.publish(next);
                expect(() => b.receive(update)).not.toThrow();
                expect(exportDocument(b.document())).toEqual(exportDocument(a.document()));
                const reopened = SharedNativeDocument.fromState(a.state(), 'empty-shared');
                try {
                    expect(exportDocument(reopened.document())).toEqual(exportDocument(a.document()));
                } finally {
                    reopened.destroy();
                }
            } finally {
                seed.destroy();
                a.destroy();
                b.destroy();
            }
        },
    );

    it.each([
        'rowBefore',
        'rowAfter',
        'deleteRow',
        'columnBefore',
        'columnAfter',
        'deleteColumn',
        'deleteTable',
        'headerRow',
        'merge',
        'split',
        'resize',
    ])('synchronizes and undoes %s inside nested tables and language columns without a self-conflict', (operation) => {
        const a = SharedNativeDocument.create(importDocument(makeNestedRichFixture(), 'nested-save'));
        const b = SharedNativeDocument.fromState(a.state(), a.document().id);
        try {
            const initial = exportDocument(b.document());
            const doc = a.document();
            const changed =
                operation === 'merge'
                    ? mergeTableCells(doc, {
                          tableId: 'arabic-table',
                          anchorId: 'arabic-table-merged',
                          focusId: 'arabic-table-last-cell',
                      })
                    : operation === 'split'
                      ? splitTableCell(doc, 'arabic-table-merged')
                      : operation === 'resize'
                        ? { document: resizeTableColumns(doc, 'arabic-table', 1, 10, 300) }
                        : tableCommand(doc, 'arabic-table-rich', operation as TableCommand);
            expect(changed).not.toBeNull();
            const update = a.publish(changed!.document);
            b.receive(update);
            expect(exportDocument(b.document())).toEqual(exportDocument(changed!.document));
            a.undo();
            merge(a, b);
            expect(exportDocument(b.document())).toEqual(initial);
            a.redo();
            merge(a, b);
            expect(exportDocument(b.document())).toEqual(exportDocument(changed!.document));
        } finally {
            a.destroy();
            b.destroy();
        }
    });
    it('initializes and reopens a deeply structured 600-row document within five seconds', () => {
        const body = {
            type: 'doc',
            content: Array.from({ length: 600 }, (_, index) => ({
                type: 'parallelRow',
                content: ['ar', 'en'].map((lang) => ({
                    type: 'parallelCell',
                    attrs: { lang },
                    content: [
                        { type: 'paragraph', content: [{ type: 'text', text: `البند ${index} English text` }] },
                        ...(index % 3 === 0
                            ? [
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
                                                              content: [
                                                                  { type: 'text', text: 'خلية متداخلة Nested cell' },
                                                              ],
                                                          },
                                                      ],
                                                  },
                                              ],
                                          },
                                      ],
                                  },
                              ]
                            : []),
                    ],
                })),
            })),
        };
        const started = performance.now();
        const a = SharedNativeDocument.create(importDocument(body, 'structured-shared'));
        let b: SharedNativeDocument | undefined;
        try {
            expect(performance.now() - started).toBeLessThan(5000);
            const reopen = performance.now();
            b = SharedNativeDocument.fromState(a.state(), a.document().id);
            expect(performance.now() - reopen).toBeLessThan(5000);
            expect(b.document().root.children).toHaveLength(600);
            expect(textBlocks(b.document().root)).toHaveLength(1600);
            expect(performance.now() - started).toBeLessThan(5000);
            const original = text(b);
            edit(b, 0, 0, 'Changed ');
            expect(b.canUndo).toBe(true);
            b.undo();
            expect(text(b)).toBe(original);
            b.redo();
            expect(text(b)).toBe(`Changed ${original}`);
        } finally {
            a.destroy();
            b?.destroy();
        }
    }, 15000);
    it('round trips Arabic rich text and independent document identities', () => {
        const a = create(),
            b = SharedNativeDocument.fromState(a.state(), a.document().id);
        expect(text(a)).toBe('Hello العربية world');
        expect(text(b)).toBe(text(a));
        expect(exportDocument(b.document())).toMatchObject({ type: 'doc', content: [{ type: 'paragraph' }] });
        a.destroy();
        b.destroy();
    });
    it('merges concurrent edits in the same paragraph without dropping either insertion', () => {
        const { a, b } = peers();
        edit(a, 0, 0, 'First ');
        edit(b, 'Hello العربية world'.length, 'Hello العربية world'.length, ' Last');
        merge(a, b);
        expect(text(a)).toBe('First Hello العربية world Last');
        expect(text(b)).toBe(text(a));
        a.destroy();
        b.destroy();
    });
    it('merges concurrent insertions at the same offset deterministically', () => {
        const { a, b } = peers();
        edit(a, 0, 0, 'One ');
        edit(b, 0, 0, 'Two ');
        merge(a, b);
        expect(text(a)).toBe(text(b));
        expect(text(a)).toContain('One ');
        expect(text(a)).toContain('Two ');
        a.destroy();
        b.destroy();
    });
    it('undoes only this users work and retains remote edits', () => {
        const { a, b } = peers();
        edit(a, 0, 0, 'Mine ');
        edit(b, 0, 0, 'Theirs ');
        merge(a, b);
        a.undo();
        merge(a, b);
        expect(text(a)).toBe('Theirs Hello العربية world');
        expect(text(b)).toBe(text(a));
        a.redo();
        merge(a, b);
        expect(text(a)).toContain('Mine ');
        expect(text(a)).toContain('Theirs ');
        a.destroy();
        b.destroy();
    });
    it('merges different formatting marks on the same text', () => {
        const { a, b } = peers();
        for (const [shared, mark] of [
            [a, 'bold'],
            [b, 'italic'],
        ] as const) {
            const document = shared.document(),
                block = textBlocks(document.root)[0];
            shared.publish(
                formatText(
                    document,
                    { blockId: block.id, from: 0, to: 5, expectedRevision: document.revision },
                    { kind: 'toggle', mark },
                ),
            );
        }
        merge(a, b);
        const marks = textBlocks(a.document().root)[0].children![0].marks!.map((mark) => mark.kind);
        expect(marks).toContain('bold');
        expect(marks).toContain('italic');
        expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
        a.destroy();
        b.destroy();
    });
    it('keeps caret anchors attached to their text when another user inserts before them', () => {
        const { a, b } = peers(),
            block = textBlocks(a.document().root)[0];
        const caret = a.caret({ blockId: block.id, offset: 5 })!;
        edit(b, 0, 0, 'Prefix ');
        merge(a, b);
        expect(a.resolve(caret)).toEqual({ blockId: block.id, offset: 12 });
        a.destroy();
        b.destroy();
    });
    it('keeps edits to an inactive clause variant when another user switches wording', () => {
        const body = (text: string) => ({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        });
        const library: LibraryClause = {
            uuid: 'group',
            title: 'Clause',
            variants: [
                { uuid: 'a', body_content: body('First') },
                { uuid: 'b', body_content: body('Second') },
            ],
        };
        const original = importDocument({ type: 'doc' }, 'clause-document');
        const clause = createNativeClause(original, library.title, library);
        const a = SharedNativeDocument.create({ ...original, root: { ...original.root, children: [clause] } }),
            b = SharedNativeDocument.fromState(a.state(), a.document().id);
        const document = a.document(),
            liveClause = nativeClauses(document)[0],
            paragraph = textBlocks(liveClause.children![1])[0];
        a.publish(
            replaceInlineText(document, {
                blockId: paragraph.id,
                from: 0,
                to: 0,
                text: 'Edited ',
                expectedRevision: document.revision,
            }),
        );
        b.publish(changeClauseVariant(b.document(), liveClause.id, { kind: 'select', id: 'b' }).document);
        merge(a, b);
        a.publish(changeClauseVariant(a.document(), liveClause.id, { kind: 'select', id: 'a' }).document);
        merge(a, b);
        expect(text(a)).toContain('Edited First');
        expect(text(b)).toBe(text(a));
        a.destroy();
        b.destroy();
    });
    it.each(['', 'First'])('keeps a caret at the old left boundary when its suffix is joined (%s)', (prefix) => {
        const a = SharedNativeDocument.create(
            importDocument(
                {
                    type: 'doc',
                    content: [prefix, 'Second'].map((text, index) => ({
                        type: 'paragraph',
                        attrs: { nativeId: `boundary-${index}` },
                        content: text ? [{ type: 'text', text }] : [],
                    })),
                },
                'join-caret-affinity',
            ),
        );
        const b = SharedNativeDocument.fromState(a.state(), a.document().id);
        try {
            const caret = b.caret({ blockId: 'boundary-0', offset: prefix.length })!;
            a.publish(joinPreviousTextBlock(a.document(), 'boundary-1')!.document);
            merge(a, b);
            expect(b.resolve(caret)).toEqual({ blockId: 'boundary-0', offset: prefix.length });
        } finally {
            a.destroy();
            b.destroy();
        }
    });
    it('keeps shared updates small for a 600-paragraph document', () => {
        const started = performance.now();
        const a = SharedNativeDocument.create(importDocument(makeNativeFixture(600), 'large-shared'));
        const document = a.document(),
            block = textBlocks(document.root)[300],
            vector = a.vector();
        a.publish(
            replaceInlineText(document, {
                blockId: block.id,
                from: 0,
                to: 0,
                text: 'جديد ',
                expectedRevision: document.revision,
            }),
        );
        expect(a.state(vector).length).toBeLessThan(2000);
        expect(performance.now() - started).toBeLessThan(5000);
        a.destroy();
    });
    it('merges concurrent paragraph splits without copying or losing suffix text', () => {
        const a = create('ABCDEFGHIJ'),
            b = SharedNativeDocument.fromState(a.state(), a.document().id);
        for (const [shared, offset] of [
            [a, 3],
            [b, 7],
        ] as const) {
            const document = shared.document(),
                block = textBlocks(document.root)[0];
            shared.publish(
                splitTextBlock(document, {
                    blockId: block.id,
                    from: offset,
                    to: offset,
                    expectedRevision: document.revision,
                }).document,
            );
        }
        merge(a, b);
        expect(text(a)).toBe('ABC\nDEFG\nHIJ');
        expect(text(b)).toBe(text(a));
        a.destroy();
        b.destroy();
    });
    it('keeps edits inside a suffix moved by a concurrent paragraph split', () => {
        const a = create('ABCDEFGHIJ'),
            b = SharedNativeDocument.fromState(a.state(), a.document().id);
        const document = a.document(),
            block = textBlocks(document.root)[0];
        a.publish(
            splitTextBlock(document, { blockId: block.id, from: 3, to: 3, expectedRevision: document.revision })
                .document,
        );
        edit(b, 8, 8, 'new');
        merge(a, b);
        expect(text(a)).toBe('ABC\nDEFGHnewIJ');
        expect(text(b)).toBe(text(a));
        a.destroy();
        b.destroy();
    });
    it('undoes a split while keeping another authors edits in the new paragraph', () => {
        const a = create('ABCDEFGHIJ'),
            b = SharedNativeDocument.fromState(a.state(), a.document().id);
        const document = a.document(),
            block = textBlocks(document.root)[0];
        a.publish(
            splitTextBlock(document, { blockId: block.id, from: 3, to: 3, expectedRevision: document.revision })
                .document,
        );
        merge(a, b);
        const right = textBlocks(b.document().root)[1];
        b.publish(
            replaceInlineText(b.document(), {
                blockId: right.id,
                from: 0,
                to: 0,
                text: 'peer',
                expectedRevision: b.document().revision,
            }),
        );
        merge(a, b);
        a.undo();
        merge(a, b);
        expect(text(a)).toBe('ABCpeerDEFGHIJ');
        expect(text(b)).toBe(text(a));
        a.destroy();
        b.destroy();
    });
    it('keeps a concurrent edit when adjacent paragraphs are joined', () => {
        const a = SharedNativeDocument.create(
            importDocument(
                {
                    type: 'doc',
                    content: ['First', 'Second'].map((text) => ({
                        type: 'paragraph',
                        content: [{ type: 'text', text }],
                    })),
                },
                'join-test',
            ),
        );
        const b = SharedNativeDocument.fromState(a.state(), a.document().id);
        const right = textBlocks(a.document().root)[1];
        a.publish(joinPreviousTextBlock(a.document(), right.id)!.document);
        b.publish(
            replaceInlineText(b.document(), {
                blockId: right.id,
                from: 0,
                to: 0,
                text: 'Peer ',
                expectedRevision: b.document().revision,
            }),
        );
        merge(a, b);
        expect(text(a)).toBe('FirstPeer Second');
        expect(text(b)).toBe(text(a));
        a.destroy();
        b.destroy();
    });
    it('keeps concurrent typing when joining paragraphs from independent text flows', () => {
        const { a, b } = independentPeers();
        try {
            const right = textBlocks(a.document().root)[1];
            a.publish(joinPreviousTextBlock(a.document(), right.id)!.document);
            b.publish(
                replaceInlineText(b.document(), {
                    blockId: right.id,
                    from: 0,
                    to: 0,
                    text: 'Peer ',
                    expectedRevision: b.document().revision,
                }),
            );
            merge(a, b);
            expect(text(a)).toBe('FirstPeer Second');
            expect(text(b)).toBe(text(a));
        } finally {
            a.destroy();
            b.destroy();
        }
    });
    it.each([false, true].flatMap((independent) => [false, true].map((reverse) => ({ independent, reverse }))))(
        'keeps an old left-paragraph append before its joined suffix ($independent, $reverse)',
        ({ independent, reverse }) => {
            const pair = () => {
                const a = SharedNativeDocument.create(
                    importDocument(
                        {
                            type: 'doc',
                            content: ['First', 'Second'].map((text) => ({
                                type: 'paragraph',
                                content: [{ type: 'text', text }],
                            })),
                        },
                        'join-end-affinity',
                    ),
                );
                return { a, b: SharedNativeDocument.fromState(a.state(), a.document().id) };
            };
            const { a, b } = independent ? independentPeers() : pair();
            a.ydoc.clientID = reverse ? 1002 : 1001;
            b.ydoc.clientID = reverse ? 1001 : 1002;
            try {
                a.publish(joinPreviousTextBlock(a.document(), textBlocks(a.document().root)[1].id)!.document);
                edit(b, 5, 5, ' peer ');
                merge(a, b);
                expect(text(a)).toBe('First peer Second');
                expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
                a.stopCapturing();
                const document = a.document(),
                    block = textBlocks(document.root)[0];
                a.publish(
                    splitTextBlock(document, { blockId: block.id, from: 7, to: 7, expectedRevision: document.revision })
                        .document,
                );
                merge(a, b);
                expect(text(a)).toBe('First p\neer Second');
                a.undo();
                merge(a, b);
                expect(text(a)).toBe('First peer Second');
                expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
            } finally {
                a.destroy();
                b.destroy();
            }
        },
    );

    it.each(['edit', 'format', 'split', 'undo', 'redo', 'reopen', 'caret'])(
        'preserves independent joined flows through %s',
        (operation) => {
            const { a, b } = independentPeers();
            try {
                const right = textBlocks(a.document().root)[1];
                const caret = b.caret({ blockId: right.id, offset: 2 })!;
                a.publish(joinPreviousTextBlock(a.document(), right.id)!.document);
                a.stopCapturing();
                b.publish(
                    replaceInlineText(b.document(), {
                        blockId: right.id,
                        from: 0,
                        to: 0,
                        text: 'Peer ',
                        expectedRevision: b.document().revision,
                    }),
                );
                merge(a, b);
                let expected = 'FirstPeer Second';
                const block = textBlocks(a.document().root)[0];
                if (operation === 'edit') {
                    edit(a, 5, 10, 'Local ');
                    expected = 'FirstLocal Second';
                } else if (operation === 'format') {
                    a.publish(
                        formatText(
                            a.document(),
                            { blockId: block.id, from: 2, to: 14, expectedRevision: a.document().revision },
                            { kind: 'toggle', mark: 'bold' },
                        ),
                    );
                } else if (operation === 'split') {
                    a.publish(
                        splitTextBlock(a.document(), {
                            blockId: block.id,
                            from: 8,
                            to: 8,
                            expectedRevision: a.document().revision,
                        }).document,
                    );
                    expected = 'FirstPee\nr Second';
                } else if (operation === 'undo' || operation === 'redo') {
                    a.undo();
                    expected = 'First\nPeer Second';
                    if (operation === 'redo') {
                        a.redo();
                        expected = 'FirstPeer Second';
                    }
                } else if (operation === 'caret') {
                    expect(a.resolve(caret)).toEqual({ blockId: block.id, offset: 12 });
                }
                merge(a, b);
                expect(text(a)).toBe(expected);
                expect(text(b)).toBe(expected);
                expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
                const c = SharedNativeDocument.fromState(a.state(), a.document().id);
                try {
                    expect(text(c)).toBe(expected);
                    expect(exportDocument(c.document())).toEqual(exportDocument(b.document()));
                } finally {
                    c.destroy();
                }
            } finally {
                a.destroy();
                b.destroy();
            }
        },
    );

    it('preserves all text when authors join the same paragraphs in opposite orders', () => {
        const a = SharedNativeDocument.create(
            importDocument(
                {
                    type: 'doc',
                    content: [
                        { type: 'paragraph', attrs: { nativeId: 'one' }, content: [{ type: 'text', text: 'First' }] },
                        { type: 'paragraph', attrs: { nativeId: 'two' }, content: [{ type: 'text', text: 'Second' }] },
                    ],
                },
                'opposite-joins',
            ),
        );
        const b = SharedNativeDocument.fromState(a.state(), a.document().id);
        try {
            a.publish(joinPreviousTextBlock(a.document(), 'two')!.document);
            b.publish(moveBlock(b.document(), 'two', 'one', 'before'));
            b.publish(joinPreviousTextBlock(b.document(), 'one')!.document);
            merge(a, b);
            expect([...text(a).replaceAll('\n', '')].sort().join('')).toBe([...'FirstSecond'].sort().join(''));
            expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
        } finally {
            a.destroy();
            b.destroy();
        }
    });

    it.each([false, true])('restores an earlier paragraph structure after independent joins (%s)', (reorder) => {
        const { a, b } = independentPeers();
        try {
            const original = a.document();
            const [left, right] = textBlocks(original.root);
            if (reorder) a.publish(moveBlock(a.document(), right.id, left.id, 'before'));
            const last = textBlocks(a.document().root)[1];
            a.publish(joinPreviousTextBlock(a.document(), last.id)!.document);
            a.stopCapturing();
            merge(a, b);
            a.publish({ ...original, revision: a.document().revision + 1 });
            merge(a, b);
            expect(text(a)).toBe('First\nSecond');
            expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
            const c = SharedNativeDocument.fromState(a.state(), a.document().id);
            try {
                expect(text(c)).toBe('First\nSecond');
            } finally {
                c.destroy();
            }
        } finally {
            a.destroy();
            b.destroy();
        }
    });
    it.each(['plain', 'table'].flatMap((container) => ['first', 'second'].map((removed) => ({ container, removed }))))(
        'restores deleted paragraph text and attributes from a snapshot ($container, $removed)',
        ({ container, removed }) => {
            const paragraphs = ['First', 'Second'].map((text, index) => ({
                type: 'paragraph',
                attrs: { nativeId: index ? 'second' : 'first' },
                content: [{ type: 'text', text }],
            }));
            const content =
                container === 'table'
                    ? [
                          {
                              type: 'table',
                              content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: paragraphs }] }],
                          },
                      ]
                    : paragraphs;
            const a = SharedNativeDocument.create(
                importDocument({ type: 'doc', content }, 'deleted-paragraph-restore'),
            );
            const b = SharedNativeDocument.fromState(a.state(), a.document().id);
            const original = a.document();
            try {
                a.publish(
                    replaceBlockNode(a.document(), removed, (node) => ({
                        ...node,
                        attributes: { ...node.attributes, textAlign: 'center' },
                    })),
                );
                a.publish(deleteBlock(a.document(), removed)!.document);
                merge(a, b);
                a.publish({ ...original, revision: a.document().revision + 1 });
                merge(a, b);
                expect(text(a)).toBe('First\nSecond');
                expect(exportDocument(a.document())).toEqual(exportDocument(original));
                expect(exportDocument(b.document())).toEqual(exportDocument(original));
            } finally {
                a.destroy();
                b.destroy();
            }
        },
    );

    it('moves the full original paragraph when another author splits it concurrently', () => {
        const a = SharedNativeDocument.create(
            importDocument(
                {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            attrs: { nativeId: 'original' },
                            content: [{ type: 'text', text: 'ABCDEFGHIJ' }],
                        },
                        {
                            type: 'paragraph',
                            attrs: { nativeId: 'target' },
                            content: [{ type: 'text', text: 'Target' }],
                        },
                    ],
                },
                'split-move',
            ),
        );
        const b = SharedNativeDocument.fromState(a.state(), a.document().id);
        try {
            a.publish(
                splitTextBlock(a.document(), {
                    blockId: 'original',
                    from: 3,
                    to: 3,
                    expectedRevision: a.document().revision,
                }).document,
            );
            b.publish(moveBlock(b.document(), 'original', 'target', 'after'));
            merge(a, b);
            expect(text(a)).toBe('Target\nABC\nDEFGHIJ');
            expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
        } finally {
            a.destroy();
            b.destroy();
        }
    });

    it.each([0, 3, 7].flatMap((offset) => [false, true].map((independent) => ({ offset, independent }))))(
        'keeps existing split siblings after splitting their joined prefix ($offset, $independent)',
        ({ offset, independent }) => {
            const pair = () => {
                const a = SharedNativeDocument.create(
                    importDocument(
                        {
                            type: 'doc',
                            content: ['First', 'Second'].map((text) => ({
                                type: 'paragraph',
                                content: [{ type: 'text', text }],
                            })),
                        },
                        'shared-prefix',
                    ),
                );
                return { a, b: SharedNativeDocument.fromState(a.state(), a.document().id) };
            };
            const { a, b } = independent ? independentPeers() : pair();
            try {
                const [left, right] = textBlocks(a.document().root);
                a.publish(
                    splitTextBlock(a.document(), {
                        blockId: right.id,
                        from: 2,
                        to: 2,
                        expectedRevision: a.document().revision,
                    }).document,
                );
                a.publish(joinPreviousTextBlock(a.document(), right.id)!.document);
                expect(text(a)).toBe('FirstSe\ncond');
                a.publish(
                    splitTextBlock(a.document(), {
                        blockId: left.id,
                        from: offset,
                        to: offset,
                        expectedRevision: a.document().revision,
                    }).document,
                );
                merge(a, b);
                expect(text(a)).toBe('FirstSe'.slice(0, offset) + '\n' + 'FirstSe'.slice(offset) + '\ncond');
                expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
            } finally {
                a.destroy();
                b.destroy();
            }
        },
    );

    it('keeps split siblings after a paragraph containing an empty joined prefix is split', () => {
        const a = SharedNativeDocument.create(
            importDocument(
                {
                    type: 'doc',
                    content: [
                        { type: 'paragraph', attrs: { nativeId: 'left' }, content: [] },
                        {
                            type: 'paragraph',
                            attrs: { nativeId: 'right' },
                            content: [{ type: 'text', text: 'Second' }],
                        },
                    ],
                },
                'empty-joined-prefix',
            ),
        );
        const b = SharedNativeDocument.fromState(a.state(), a.document().id);
        try {
            a.publish(
                splitTextBlock(a.document(), {
                    blockId: 'right',
                    from: 0,
                    to: 0,
                    expectedRevision: a.document().revision,
                }).document,
            );
            a.publish(joinPreviousTextBlock(a.document(), 'right')!.document);
            edit(a, 0, 0, 'First');
            expect(text(a)).toBe('First\nSecond');
            a.publish(
                splitTextBlock(a.document(), {
                    blockId: 'left',
                    from: 0,
                    to: 0,
                    expectedRevision: a.document().revision,
                }).document,
            );
            merge(a, b);
            expect(text(a)).toBe('\nFirst\nSecond');
            expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
        } finally {
            a.destroy();
            b.destroy();
        }
    });

    it.each([false, true])('splits an empty joined paragraph before its known suffix (%s)', (independent) => {
        const a = SharedNativeDocument.create(
            importDocument(
                {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            attrs: { nativeId: 'left' },
                            content: [{ type: 'text', text: 'FirstSecond' }],
                        },
                        ...(independent ? [{ type: 'horizontalRule', attrs: { nativeId: 'divider' } }] : []),
                        { type: 'paragraph', attrs: { nativeId: 'right' }, content: [] },
                    ],
                },
                'empty-joined-split',
            ),
        );
        const b = SharedNativeDocument.fromState(a.state(), a.document().id);
        try {
            if (independent) a.publish(deleteBlock(a.document(), 'divider')!.document);
            a.publish(
                splitTextBlock(a.document(), {
                    blockId: 'left',
                    from: 5,
                    to: 5,
                    expectedRevision: a.document().revision,
                }).document,
            );
            a.publish(moveBlock(a.document(), 'right', 'left', 'after'));
            a.publish(joinPreviousTextBlock(a.document(), 'right')!.document);
            edit(a, 0, 5, '');
            expect(text(a)).toBe('\nSecond');
            a.publish(
                splitTextBlock(a.document(), {
                    blockId: 'left',
                    from: 0,
                    to: 0,
                    expectedRevision: a.document().revision,
                }).document,
            );
            merge(a, b);
            expect(text(a)).toBe('\n\nSecond');
            expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
        } finally {
            a.destroy();
            b.destroy();
        }
    });

    it('moves the remaining joined references into the suffix when splitting composed text', () => {
        const a = SharedNativeDocument.create(
            importDocument(
                {
                    type: 'doc',
                    content: ['A', 'B', 'C'].map((text, i) => ({
                        type: 'paragraph',
                        attrs: { nativeId: `part-${i}` },
                        content: [{ type: 'text', text }],
                    })),
                },
                'composed-split',
            ),
        );
        const b = SharedNativeDocument.fromState(a.state(), a.document().id);
        try {
            a.publish(joinPreviousTextBlock(a.document(), 'part-1')!.document);
            b.publish(moveBlock(b.document(), 'part-2', 'part-0', 'after'));
            b.publish(joinPreviousTextBlock(b.document(), 'part-2')!.document);
            merge(a, b);
            const before = text(a),
                block = textBlocks(a.document().root)[0];
            a.publish(
                splitTextBlock(a.document(), {
                    blockId: block.id,
                    from: 2,
                    to: 2,
                    expectedRevision: a.document().revision,
                }).document,
            );
            merge(a, b);
            expect(text(a)).toBe(before.slice(0, 2) + '\n' + before.slice(2));
            expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
        } finally {
            a.destroy();
            b.destroy();
        }
    });

    it.each(['plain', 'bilingual-table', 'list', 'clause'])(
        'keeps consecutive Enter operations ahead of a suffix after concurrent moves and joins in %s',
        (container) => {
            const paragraphs = ['A😀', 'Bب', 'C'].map((text, index) => ({
                type: 'paragraph',
                attrs: { nativeId: `p-${index}` },
                content: [{ type: 'text', text }],
            }));
            let content: unknown[] = paragraphs;
            if (container === 'bilingual-table')
                content = [
                    {
                        type: 'parallelRow',
                        content: [
                            {
                                type: 'parallelCell',
                                attrs: { direction: 'rtl' },
                                content: [
                                    {
                                        type: 'table',
                                        content: [
                                            {
                                                type: 'tableRow',
                                                content: [
                                                    { type: 'tableCell', content: paragraphs },
                                                    {
                                                        type: 'tableCell',
                                                        content: [
                                                            {
                                                                type: 'paragraph',
                                                                content: [{ type: 'text', text: 'جدول' }],
                                                            },
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                            {
                                type: 'parallelCell',
                                attrs: { direction: 'ltr' },
                                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'English' }] }],
                            },
                        ],
                    },
                ];
            if (container === 'list')
                content = [{ type: 'bulletList', content: [{ type: 'listItem', content: paragraphs }] }];
            if (container === 'clause')
                content = [
                    {
                        type: 'clause',
                        content: [
                            { type: 'clauseTitle', content: [{ type: 'text', text: 'عنوان البند' }] },
                            { type: 'clauseBody', content: paragraphs },
                        ],
                    },
                ];
            const seed = SharedNativeDocument.create(importDocument({ type: 'doc', content }, 'concurrent-enter'));
            const peers = [0, 1, 2].map((actor) => {
                const peer = SharedNativeDocument.fromState(seed.state(), seed.document().id);
                peer.ydoc.clientID = 1001 + actor;
                return peer;
            });
            seed.destroy();
            const ids = new Map([
                ['A', 'p-0'],
                ['B', 'p-1'],
                ['C', 'p-2'],
            ]);
            const steps: Array<
                [number, 'split' | 'type' | 'move' | 'join', string, number | string, string?, boolean?]
            > = [
                [0, 'split', 'C', 1, 'N1'],
                [2, 'type', 'A', 0, 'X'],
                [0, 'split', 'N1', 0, 'N2', true],
                [2, 'split', 'N2', 0, 'N3'],
                [2, 'split', 'N2', 0, 'N4'],
                [1, 'type', 'A', 4, 'Y', true],
                [2, 'type', 'N3', 0, 'Z', true],
                [1, 'split', 'A', 4, 'N5', true],
                [0, 'move', 'N5', 'N2', 'before', true],
                [0, 'split', 'N3', 0, 'N6'],
                [1, 'move', 'N3', 'N4', 'before'],
                [0, 'split', 'N4', 0, 'N7', true],
                [1, 'split', 'N6', 1, 'N8', true],
                [0, 'move', 'N5', 'N6', 'after'],
                [0, 'move', 'N6', 'N7', 'before'],
                [2, 'move', 'N8', 'N2', 'after'],
                [1, 'join', 'N3', 0, undefined, true],
                [0, 'join', 'N5', 0, undefined, true],
                [2, 'split', 'N8', 0, 'N9', true],
                [2, 'split', 'N8', 0, 'N10'],
            ];
            const synchronize = () => {
                for (let round = 0; round < 2; round++)
                    for (const from of peers)
                        for (const to of peers) if (from !== to) to.receive(from.state(to.vector()));
            };
            try {
                for (const [actor, operation, alias, argument, value, sync] of steps) {
                    const peer = peers[actor],
                        document = peer.document(),
                        id = ids.get(alias)!;
                    let candidate = document;
                    if (operation === 'split') {
                        candidate = splitTextBlock(document, {
                            blockId: id,
                            from: argument as number,
                            to: argument as number,
                            expectedRevision: document.revision,
                        }).document;
                        const previous = new Set(textBlocks(document.root).map((block) => block.id));
                        ids.set(value!, textBlocks(candidate.root).find((block) => !previous.has(block.id))!.id);
                    } else if (operation === 'type') {
                        candidate = replaceInlineText(document, {
                            blockId: id,
                            from: argument as number,
                            to: argument as number,
                            text: value!,
                            expectedRevision: document.revision,
                        });
                    } else if (operation === 'move') {
                        candidate = moveBlock(document, id, ids.get(argument as string)!, value as 'before' | 'after');
                    } else candidate = joinPreviousTextBlock(document, id)!.document;
                    peer.publish(candidate);
                    expect(text(peer)).toBe(textBlocks(candidate.root).map(blockText).join('\n'));
                    if (sync) synchronize();
                }
                synchronize();
                for (const peer of peers)
                    expect(exportDocument(peer.document())).toEqual(exportDocument(peers[0].document()));
            } finally {
                peers.forEach((peer) => peer.destroy());
            }
        },
    );

    it('keeps peer suffix edits through several paragraph splits published together', () => {
        const a = create('ABCDEFGHIJ'),
            b = SharedNativeDocument.fromState(a.state(), a.document().id);
        try {
            const first = textBlocks(a.document().root)[0];
            let branch = splitTextBlock(a.document(), {
                blockId: first.id,
                from: 3,
                to: 3,
                expectedRevision: a.document().revision,
            }).document;
            const right = textBlocks(branch.root)[1];
            branch = splitTextBlock(branch, {
                blockId: right.id,
                from: 4,
                to: 4,
                expectedRevision: branch.revision,
            }).document;
            a.publish(branch);
            edit(b, 8, 8, 'Peer');
            merge(a, b);
            expect(text(a)).toBe('ABC\nDEFG\nHPeerIJ');
            expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
        } finally {
            a.destroy();
            b.destroy();
        }
    });

    it('does not create a new visible revision for a duplicate network update', () => {
        const { a, b } = peers();
        const before = b.document();
        b.receive(a.state());
        expect(b.document()).toBe(before);
        a.destroy();
        b.destroy();
    });
    it('keeps text identities canonical through formatting, insertion, deletion and undo', () => {
        const a = SharedNativeDocument.create(
            importDocument(
                {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                { type: 'text', attrs: { nativeId: 'original-text' }, text: 'Hello العربية world' },
                            ],
                        },
                    ],
                },
                'canonical-text',
            ),
        );
        const b = SharedNativeDocument.fromState(a.state(), a.document().id);
        const verify = () => {
            merge(a, b);
            const fresh = SharedNativeDocument.fromState(a.state(), a.document().id);
            try {
                expect(exportDocument(a.document())).toEqual(exportDocument(fresh.document()));
                expect(exportDocument(b.document())).toEqual(exportDocument(fresh.document()));
            } finally {
                fresh.destroy();
            }
        };
        try {
            for (const [from, to] of [
                [1, 5],
                [3, 8],
                [0, 9],
                [2, 6],
            ]) {
                const document = a.document(),
                    block = textBlocks(document.root)[0];
                a.publish(
                    formatText(
                        document,
                        { blockId: block.id, from, to, expectedRevision: document.revision },
                        { kind: 'toggle', mark: 'bold' },
                    ),
                );
                verify();
            }
            a.stopCapturing();
            edit(a, 0, 0, 'Prefix ');
            verify();
            a.stopCapturing();
            edit(b, 8, 11, '😀');
            verify();
            a.undo();
            verify();
            a.redo();
            verify();
            b.undo();
            verify();
        } finally {
            a.destroy();
            b.destroy();
        }
    });
    it.each([false, true])('keeps one field after concurrent inline/floating moves and undo: %s', (reverse) => {
        const original = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        attrs: { nativeId: 'first' },
                        content: [
                            { type: 'variable', attrs: { id: 'field', type: 'text', name: 'Name', value: 'Original' } },
                        ],
                    },
                    { type: 'paragraph', attrs: { nativeId: 'second' }, content: [{ type: 'text', text: 'Second' }] },
                ],
            },
            'field-document',
        );
        const a = SharedNativeDocument.create(original),
            b = SharedNativeDocument.fromState(a.state(), original.id);
        const clients = [1, 2, 3].filter((id) => id !== a.ydoc.clientID).slice(0, 2);
        a.ydoc.clientID = clients[reverse ? 1 : 0];
        b.ydoc.clientID = clients[reverse ? 0 : 1];
        for (const [shared, floating] of [
            [a, true],
            [b, false],
        ] as const) {
            const document = shared.document(),
                [first, second] = document.root.children!,
                field = first.children![0];
            shared.publish({
                ...document,
                revision: document.revision + 1,
                root: {
                    ...document.root,
                    attributes: {
                        ...document.root.attributes,
                        ...(floating ? { blockVariables: [{ ...field.attributes, x: 20, y: 30 }] } : {}),
                    },
                    children: [
                        { ...first, children: [] },
                        floating ? second : { ...second, children: [...second.children!, field] },
                    ],
                },
            });
        }
        merge(a, b);
        expect(nativeFields(a.document()).filter((field) => field.id === 'field')).toHaveLength(1);
        expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
        a.undo();
        merge(a, b);
        expect(nativeFields(a.document()).filter((field) => field.id === 'field')).toHaveLength(1);
        expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
        a.destroy();
        b.destroy();
    });
    it('merges independent nested settings on a shared field', () => {
        const original = importDocument(
            {
                type: 'doc',
                attrs: {
                    blockVariables: [{ id: 'field', type: 'text', settings: { fontSize: 14, color: '#000000' } }],
                },
                content: [{ type: 'paragraph' }],
            },
            'settings-document',
        );
        const a = SharedNativeDocument.create(original),
            b = SharedNativeDocument.fromState(a.state(), original.id);
        for (const [shared, settings] of [
            [a, { fontSize: 20 }],
            [b, { color: '#ff0000' }],
        ] as const) {
            const document = shared.document(),
                field = nativeFields(document)[0].attributes;
            shared.publish({
                ...document,
                revision: document.revision + 1,
                root: {
                    ...document.root,
                    attributes: {
                        ...document.root.attributes,
                        blockVariables: [{ ...field, settings: { ...(field.settings as object), ...settings } }],
                    },
                },
            });
        }
        merge(a, b);
        expect(nativeFields(a.document())[0].attributes.settings).toMatchObject({ fontSize: 20, color: '#ff0000' });
        expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
        a.destroy();
        b.destroy();
    });
    it('preserves the ordering of inline code and font overrides', () => {
        const source = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Code',
                                marks: [{ type: 'textStyle', attrs: { fontFamily: 'Arial' } }, { type: 'code' }],
                            },
                        ],
                    },
                ],
            },
            'marks',
        );
        const a = SharedNativeDocument.create(source),
            b = SharedNativeDocument.fromState(a.state(), source.id);
        expect(nodeTextStyle(textBlocks(b.document().root)[0].children![0]).family).toBe(
            nodeTextStyle(textBlocks(source.root)[0].children![0]).family,
        );
        a.destroy();
        b.destroy();
    });
    it('stores a long formatting operation as a small update', () => {
        const a = create('Long text '.repeat(500)),
            document = a.document(),
            block = textBlocks(document.root)[0],
            vector = a.vector();
        a.publish(
            formatText(
                document,
                { blockId: block.id, from: 0, to: blockText(block).length, expectedRevision: document.revision },
                { kind: 'toggle', mark: 'bold' },
            ),
        );
        expect(a.state(vector).length).toBeLessThan(2000);
        a.destroy();
    });
    it('does not allow shared attribute paths to modify object prototypes', () => {
        const doc = new Y.Doc(),
            map = doc.getMap<import('@saad5400/midad/document').Json>('attributes');
        map.set(JSON.stringify(['settings']), {});
        map.set(JSON.stringify(['settings', '__proto__', 'clmPolluted']), true);
        const attributes = readSharedAttributes(map);
        expect(({} as Record<string, unknown>).clmPolluted).toBeUndefined();
        const settings = attributes.settings as Record<string, unknown>;
        expect(Object.hasOwn(settings, '__proto__')).toBe(true);
        expect((settings['__proto__'] as Record<string, unknown>).clmPolluted).toBe(true);
        doc.destroy();
    });
    it('rejects updates that replace protocol identity and retains a recoverable document', () => {
        const { a, b } = peers(),
            before = a.document();
        b.ydoc.getMap('native').set('schema', 999);
        expect(() => a.receive(b.state(a.vector()))).toThrow('identity');
        expect(a.document()).toBe(before);
        expect(() => a.publish(before)).toThrow('closed');
        a.destroy();
        b.destroy();
    });
    it.each([1, 2, 4])('rejects incompatible shared protocol %s instead of misreading its text histories', (schema) => {
        const a = create();
        try {
            a.ydoc.getMap('native').set('schema', schema);
            expect(() => SharedNativeDocument.fromState(a.state(), a.document().id)).toThrow(
                'Unsupported shared document',
            );
        } finally {
            a.destroy();
        }
    });
    it('switches legacy variants with shared node ids without splitting their text a second time', () => {
        const paragraph = (id: string, text: string) => ({
            type: 'paragraph',
            attrs: { id },
            content: [{ type: 'text', text }],
        });
        const first = { type: 'clauseBody', attrs: { id: 'body' }, content: [paragraph('p', 'FirstSecond')] };
        const second = {
            type: 'clauseBody',
            attrs: { id: 'body' },
            content: [paragraph('p', 'First'), paragraph('p2', 'Second')],
        };
        const document = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'clause',
                        attrs: {
                            id: 'a',
                            nativeId: 'clause',
                            activeVariantId: 'a',
                            variants: [
                                { id: 'a', bodyContent: first },
                                { id: 'b', bodyContent: second },
                            ],
                        },
                        content: [{ type: 'clauseTitle' }, first],
                    },
                ],
            },
            'legacy-variants',
        );
        const a = SharedNativeDocument.create(document),
            b = SharedNativeDocument.fromState(a.state(), document.id);
        const boundaries = () =>
            [...b.ydoc.share.keys()]
                .filter((name) => name.startsWith('t:'))
                .flatMap((name) => b.ydoc.getText(name).toDelta())
                .filter((part) => typeof part.insert === 'object' && part.insert?.block).length;
        const count = boundaries();
        a.publish(
            changeClauseVariant(a.document(), nativeClauses(a.document())[0].id, { kind: 'select', id: 'b' }).document,
        );
        merge(a, b);
        expect(boundaries()).toBe(count);
        expect(text(b)).toContain('First\nSecond');
        a.destroy();
        b.destroy();
    });
});
