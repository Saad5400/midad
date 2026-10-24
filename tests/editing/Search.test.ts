import { importDocument } from '@saad5400/midad/document';
import { DocumentSearch, findText, matchSelection } from '@saad5400/midad/editing';
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
                {
                    type: 'paragraph',
                    attrs: { id: 'a' },
                    content: [
                        { type: 'text', text: 'Pay ' },
                        { type: 'text', text: 'ment', marks: [{ type: 'bold' }] },
                        { type: 'text', text: ' PAYMENT pay' },
                    ],
                },
                {
                    type: 'parallelRow',
                    content: [
                        { type: 'parallelCell', attrs: { lang: 'ar' }, content: [paragraph('ar', 'قيمة العقد قيمة')] },
                        {
                            type: 'parallelCell',
                            attrs: { lang: 'en' },
                            content: [
                                {
                                    type: 'table',
                                    content: [
                                        {
                                            type: 'tableRow',
                                            content: [
                                                {
                                                    type: 'tableCell',
                                                    content: [paragraph('cell', 'Payment in a cell')],
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
        'search',
    );

describe('document text search', () => {
    it('finds literal text across rich runs and throughout nested containers without mutation', () => {
        const doc = document(),
            before = JSON.stringify(doc);
        expect(findText(doc, 'pay')).toEqual([
            { blockId: 'a', from: 0, to: 3 },
            { blockId: 'a', from: 9, to: 12 },
            { blockId: 'a', from: 17, to: 20 },
            { blockId: 'cell', from: 0, to: 3 },
        ]);
        expect(findText(doc, 'قيمة')).toEqual([
            { blockId: 'ar', from: 0, to: 4 },
            { blockId: 'ar', from: 11, to: 15 },
        ]);
        expect(findText(doc, 'Pay ment', { caseSensitive: true })).toHaveLength(1);
        expect(JSON.stringify(doc)).toBe(before);
    });
    it('supports case and Unicode whole-word matching without losing original UTF-16 offsets', () => {
        const doc = importDocument(
            { type: 'doc', content: [paragraph('p', '😀 École école إقرار إقرارات foo_foo foo')] },
            'unicode',
        );
        expect(findText(doc, 'école')).toEqual([
            { blockId: 'p', from: 3, to: 8 },
            { blockId: 'p', from: 9, to: 14 },
        ]);
        expect(findText(doc, 'école', { caseSensitive: true })).toEqual([{ blockId: 'p', from: 9, to: 14 }]);
        expect(findText(doc, 'إقرار', { wholeWord: true })).toHaveLength(1);
        expect(findText(doc, 'foo', { wholeWord: true })).toHaveLength(1);
        expect(matchSelection(findText(doc, '😀')[0])).toEqual({
            anchor: { blockId: 'p', offset: 0 },
            focus: { blockId: 'p', offset: 2 },
        });
    });
    it('treats regular expression syntax and whitespace as literal input', () => {
        const doc = importDocument({ type: 'doc', content: [paragraph('p', 'a.* [x] \\test  $^ +?')] }, 'literal');
        for (const query of ['.*', '[x]', '\\test', '  ', '$^', '+?']) expect(findText(doc, query)).toHaveLength(1);
        expect(findText(doc, '')).toEqual([]);
        expect(findText(doc, '\uFFFC')).toEqual([]);
    });
    it('restricts search to rendered or explicitly scoped blocks', () => {
        expect(findText(document(), 'pay', { blockIds: new Set(['cell']) })).toEqual([
            { blockId: 'cell', from: 0, to: 3 },
        ]);
        expect(findText(document(), 'pay', { blockIds: new Set() })).toEqual([]);
    });
    it('wraps forward and backward and retains an active result across a new snapshot', () => {
        const search = new DocumentSearch(),
            doc = document();
        search.update(doc, 'قيمة');
        expect(search.index).toBe(0);
        expect(search.move(-1)?.from).toBe(11);
        search.update(doc, 'قيمة');
        expect(search.index).toBe(1);
        expect(search.move(1)?.from).toBe(0);
        search.update(doc, 'missing');
        expect(search.index).toBe(-1);
        expect(search.move(1)).toBeUndefined();
    });
    it('searches a dense long paragraph within the operation budget', () => {
        const doc = importDocument({ type: 'doc', content: [paragraph('dense', 'word '.repeat(40000))] }, 'dense');
        const started = performance.now();
        expect(findText(doc, 'word', { wholeWord: true })).toHaveLength(40000);
        expect(performance.now() - started).toBeLessThan(5000);
    });
    it('matches canonically equivalent text while selecting the original complete characters', () => {
        const doc = importDocument(
            { type: 'doc', content: [paragraph('unicode', 'cafe\u0301 café ا\u0654قرار أقرار')] },
            'canonical',
        );
        expect(findText(doc, 'café')).toEqual([
            { blockId: 'unicode', from: 0, to: 5 },
            { blockId: 'unicode', from: 6, to: 10 },
        ]);
        expect(findText(doc, 'cafe\u0301')).toEqual(findText(doc, 'café'));
        expect(findText(doc, 'أقرار')).toEqual([
            { blockId: 'unicode', from: 11, to: 17 },
            { blockId: 'unicode', from: 18, to: 23 },
        ]);
    });
    it('keeps navigation bounded when active text is removed or its block is hidden', () => {
        const search = new DocumentSearch(),
            doc = document();
        search.update(doc, 'pay');
        search.move(-1);
        expect(search.current?.blockId).toBe('cell');
        search.update(doc, 'pay', { blockIds: new Set(['a']) });
        expect(search.index).toBe(2);
        expect(search.current).toEqual({ blockId: 'a', from: 17, to: 20 });
        search.update(doc, 'pay', { blockIds: new Set() });
        expect(search.current).toBeUndefined();
        expect(search.index).toBe(-1);
    });
});
