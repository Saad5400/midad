import { importDocument } from '@saad5400/midad/document';
import { blockText } from '@saad5400/midad/editing';
import {
    replaceSelection,
    selectedText,
    selectionRanges,
    selectionRegion,
    selectNodeText,
    wordRange,
} from '@saad5400/midad/editing';
import { describe, expect, it } from 'vitest';

const paragraph = (id: string, text: string) => ({
    type: 'paragraph',
    attrs: { id },
    content: [{ type: 'text', text }],
});
const document = () =>
    importDocument(
        {
            type: 'doc',
            content: [
                paragraph('first', 'First paragraph'),
                paragraph('second', 'Second paragraph'),
                paragraph('last', 'Last paragraph'),
            ],
        },
        'selection',
    );

describe('native document selections', () => {
    it('treats deleting an already empty document as a no-op and versions removal after an empty first paragraph', () => {
        const empty = importDocument({ type: 'doc', content: [paragraph('empty', '')] }, 'empty');
        expect(replaceSelection(empty, selectNodeText(empty.root)!, '').document).toBe(empty);
        const populated = importDocument(
            { type: 'doc', content: [paragraph('first', ''), paragraph('second', 'Remove')] },
            'populated',
        );
        const result = replaceSelection(populated, selectNodeText(populated.root)!, '');
        expect(result.document.revision).toBe(1);
        expect(result.document.root.children).toHaveLength(1);
        expect(blockText(result.document.root.children![0])).toBe('');
    });
    it.each([
        ['Hello world', 8, { from: 6, to: 11 }],
        ['مرحبا بالعالم', 9, { from: 6, to: 13 }],
        ['Hello world', 11, { from: 6, to: 11 }],
        ['A 👨‍👩‍👧 family', 3, { from: 2, to: 10 }],
        ['', 0, { from: 0, to: 0 }],
    ])('selects a complete Unicode word or grapheme in %s', (text, offset, range) => {
        expect(wordRange(text, offset)).toEqual(range);
    });

    it('copies a backward selection across paragraphs in document order', () => {
        const doc = document();
        const selection = { anchor: { blockId: 'last', offset: 4 }, focus: { blockId: 'first', offset: 6 } };
        expect(selectedText(doc, selection)).toBe('paragraph\nSecond paragraph\nLast');
        expect(selectionRanges(doc, selection)).toHaveLength(3);
    });

    it('replaces a multi-paragraph selection atomically while preserving the unselected prefix and suffix', () => {
        const doc = document();
        const result = replaceSelection(
            doc,
            { anchor: { blockId: 'first', offset: 6 }, focus: { blockId: 'last', offset: 4 } },
            'new',
        );
        expect(result.document.revision).toBe(1);
        expect(result.document.root.children).toHaveLength(1);
        expect(blockText(result.document.root.children![0])).toBe('First new paragraph');
        expect(result.caret).toEqual({ blockId: 'first', offset: 9 });
        expect(blockText(doc.root.children![0])).toBe('First paragraph');
    });

    it('selects a whole table cell as a region and preserves the grid when deleting across cells', () => {
        const doc = importDocument(
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
                                        attrs: { id: 'cell-a' },
                                        content: [paragraph('a', 'Alpha'), paragraph('b', 'Beta')],
                                    },
                                    { type: 'tableCell', attrs: { id: 'cell-b' }, content: [paragraph('c', 'Gamma')] },
                                ],
                            },
                        ],
                    },
                ],
            },
            'grid',
        );
        const region = selectionRegion(doc.root, 'a');
        expect(region.id).toBe('cell-a');
        expect(selectedText(doc, selectNodeText(region)!)).toBe('Alpha\nBeta');
        const { anchor, focus } = selectNodeText(doc.root)!;
        const cleared = replaceSelection(doc, { anchor, focus }, '').document;
        const cells = cleared.root.children![0].children![0].children!;
        expect(cells).toHaveLength(2);
        expect(cells.map((cell) => selectedText(cleared, selectNodeText(cell)!))).toEqual(['\n', '']);
    });

    it('replaces a whole document selection with a single paragraph, including selected structural nodes', () => {
        const doc = importDocument(
            {
                type: 'doc',
                content: [
                    paragraph('start', 'Before'),
                    { type: 'horizontalRule' },
                    {
                        type: 'table',
                        content: [
                            {
                                type: 'tableRow',
                                content: [{ type: 'tableCell', content: [paragraph('end', 'Inside')] }],
                            },
                        ],
                    },
                ],
            },
            'all',
        );
        const result = replaceSelection(doc, selectNodeText(doc.root)!, 'Replacement');
        expect(result.document.root.children).toHaveLength(1);
        expect(result.document.root.children![0].kind).toBe('paragraph');
        expect(blockText(result.document.root.children![0])).toBe('Replacement');
        expect(result.document.revision).toBe(1);
    });

    it('rejects a stale selection', () => {
        expect(() =>
            selectedText(document(), {
                anchor: { blockId: 'missing', offset: 0 },
                focus: { blockId: 'last', offset: 0 },
            }),
        ).toThrow('no longer');
    });
});
