import { importDocument } from '@saad5400/midad/document';
import { documentOutline } from '@saad5400/midad/outline';
import { textBlocks } from '@saad5400/midad/editing';
import type { DocumentScene, SceneLine } from '@saad5400/midad/layout';
import { describe, expect, it } from 'vitest';
const heading = (text: string, level = 1) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const clause = (text: string) => ({
    type: 'clause',
    content: [
        { type: 'clauseTitle', content: [{ type: 'text', text }] },
        { type: 'clauseBody', content: [paragraph('Body')] },
    ],
});
const row = (...cells: unknown[][]) => ({
    type: 'parallelRow',
    content: cells.map((content, index) => ({ type: 'parallelCell', attrs: { lang: index ? 'en' : 'ar' }, content })),
});
function fixture(content: unknown[]) {
    const document = importDocument({ type: 'doc', content }, 'outline');
    const blocks = textBlocks(document.root);
    const scene = (pages: number[][]): DocumentScene => ({
        documentId: document.id,
        revision: document.revision,
        pages: pages.map((indices) => ({
            width: 595,
            height: 842,
            commands: [],
            lines: indices.map(
                (index, position) => ({ paragraphId: blocks[index].id, top: 90 + position * 20 }) as SceneLine,
            ),
        })),
    });
    return { document, blocks, scene };
}
describe('portable document outline', () => {
    it('groups headings and clause titles by their rendered page and ignores ordinary paragraphs', () => {
        const f = fixture([heading('Introduction'), paragraph('Plain'), clause('Payment'), heading('Details', 2)]);
        const groups = documentOutline(
            f.document,
            f.scene([
                [0, 1],
                [2, 3, 4],
            ]),
        );
        expect(groups[0].headings).toMatchObject([{ text: 'Introduction', level: 1, page: 1, top: 90 }]);
        expect(groups[1].headings).toMatchObject([
            { text: 'Payment', level: 3 },
            { text: 'Details', level: 2 },
        ]);
    });
    it('uses the first visible line of a heading that continues onto another page', () => {
        const f = fixture([heading('Long title'), heading('Next')]);
        const groups = documentOutline(f.document, f.scene([[0], [0, 1]]));
        expect(groups.map((group) => group.headings.map((heading) => heading.text))).toEqual([
            ['Long title'],
            ['Next'],
        ]);
    });
    it('lists the first language with visible headings once and supports nested rows and tables', () => {
        const f = fixture([
            row(
                [paragraph('No heading')],
                [heading('English title'), row([heading('Nested Arabic')], [heading('Nested English')])],
            ),
            {
                type: 'table',
                content: [
                    { type: 'tableRow', content: [{ type: 'tableCell', content: [heading('Table section', 4)] }] },
                ],
            },
        ]);
        const groups = documentOutline(f.document, f.scene([[0, 1, 2, 3, 4]]));
        expect(groups[0].headings.map((heading) => heading.text)).toEqual([
            'English title',
            'Nested Arabic',
            'Table section',
        ]);
    });
    it('uses the displayed language rather than a hidden first column', () => {
        const f = fixture([row([heading('Hidden Arabic')], [heading('Visible English')])]);
        expect(documentOutline(f.document, f.scene([[1]]))[0].headings.map((heading) => heading.text)).toEqual([
            'Visible English',
        ]);
    });
    it('retains empty pages and omits whitespace-only or invisible headings', () => {
        const f = fixture([heading('   '), heading('Hidden'), heading('Visible')]);
        expect(
            documentOutline(f.document, f.scene([[], [0, 2]])).map((group) =>
                group.headings.map((heading) => heading.text),
            ),
        ).toEqual([[], ['Visible']]);
    });
    it('rejects geometry belonging to another document or revision', () => {
        const f = fixture([heading('Title')]);
        expect(() => documentOutline(f.document, { ...f.scene([[0]]), documentId: 'other' })).toThrow('stale');
        expect(() => documentOutline(f.document, { ...f.scene([[0]]), revision: f.document.revision + 1 })).toThrow(
            'stale',
        );
    });
    it('keeps the input unchanged while outlining 600 headings within the operation budget', () => {
        const f = fixture(Array.from({ length: 600 }, (_, index) => heading(`Section ${index}`)));
        const before = JSON.stringify(f.document);
        const started = performance.now();
        expect(
            documentOutline(f.document, f.scene([Array.from({ length: 600 }, (_, index) => index)]))[0].headings,
        ).toHaveLength(600);
        expect(performance.now() - started).toBeLessThan(5000);
        expect(JSON.stringify(f.document)).toBe(before);
    });
});
