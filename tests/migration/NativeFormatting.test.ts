import { exportDocument, findNode, importDocument } from '@saad5400/midad/document';
import { blockText, replaceInlineText } from '@saad5400/midad/editing';
import {
    changeTextMarks,
    formatBlock,
    formatText,
    normalizeLink,
    selectionTextStyle,
    wholeBlockRange,
} from '@saad5400/midad/formatting';
import { describe, expect, it } from 'vitest';

function source() {
    return importDocument(
        {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    attrs: { id: 'p', dir: 'rtl' },
                    content: [
                        {
                            type: 'text',
                            text: 'نص عادي',
                            marks: [
                                { type: 'textStyle', attrs: { color: '#17355b' } },
                                { type: 'ychange', attrs: { user: 'reviewer' } },
                            ],
                        },
                        { type: 'variable', attrs: { id: 'field', type: 'text', value: 'unchanged' } },
                        { type: 'text', text: ' bold', marks: [{ type: 'bold' }] },
                    ],
                },
            ],
        },
        'contract',
    );
}

describe('native text and block formatting', () => {
    it('formats only the selected graphemes while retaining semantic marks, field metadata and unique identities', () => {
        const document = source();
        const next = formatText(
            document,
            { blockId: 'p', from: 3, to: 7, expectedRevision: 0 },
            { kind: 'toggle', mark: 'bold' },
        );
        const paragraph = findNode(next, 'p')!;
        expect(blockText(paragraph)).toBe(blockText(findNode(document, 'p')!));
        expect(paragraph.children![0].text).toBe('نص ');
        expect(paragraph.children![0].marks?.some((mark) => mark.kind === 'bold')).toBe(false);
        expect(paragraph.children![1].text).toBe('عادي');
        expect(paragraph.children![1].marks?.some((mark) => mark.kind === 'bold')).toBe(true);
        expect(paragraph.children![1].marks?.some((mark) => mark.kind === 'ychange')).toBe(true);
        expect(findNode(next, 'field')).toBe(findNode(document, 'field'));
        expect(() => importDocument(exportDocument(next), 'contract')).not.toThrow();
    });

    it('turns a mixed selection uniformly on and a uniformly formatted selection off', () => {
        let document = source();
        const range = wholeBlockRange(document, 'p');
        expect(selectionTextStyle(document, range).bold).toBeUndefined();
        document = formatText(document, range, { kind: 'toggle', mark: 'bold' });
        expect(selectionTextStyle(document, wholeBlockRange(document, 'p')).bold).toBe(true);
        document = formatText(document, wholeBlockRange(document, 'p'), { kind: 'toggle', mark: 'bold' });
        expect(selectionTextStyle(document, wholeBlockRange(document, 'p')).bold).toBe(false);
    });

    it('applies font family, size, line spacing and independent text/background colors in one operation', () => {
        let document = source();
        document = formatText(document, wholeBlockRange(document, 'p'), {
            kind: 'style',
            attributes: {
                fontFamily: 'Amiri',
                fontSize: '24px',
                lineHeight: '2',
                color: '#336699',
                backgroundColor: '#fff4cc',
            },
        });
        expect(selectionTextStyle(document, wholeBlockRange(document, 'p'))).toMatchObject({
            family: 'Amiri',
            size: 18,
            lineHeight: 2,
            color: [0.2, 0.4, 0.6, 1],
            background: [1, 244 / 255, 204 / 255, 1],
        });
        document = formatText(document, wholeBlockRange(document, 'p'), {
            kind: 'style',
            attributes: { backgroundColor: null },
        });
        expect(selectionTextStyle(document, wholeBlockRange(document, 'p')).background).toBeNull();
    });

    it('removes presentation formatting while preserving links and review metadata', () => {
        const marks = changeTextMarks(
            [
                { kind: 'bold' },
                { kind: 'link', attributes: { href: 'https://example.test' } },
                { kind: 'aiAnalysis', attributes: { id: 'analysis' } },
            ],
            { kind: 'clear' },
        );
        expect(marks.map((mark) => mark.kind)).toEqual(['link', 'aiAnalysis']);
    });

    it('uses stored marks for newly typed text, including the first text in an empty paragraph', () => {
        const document = importDocument(
            { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'p' } }] },
            'contract',
        );
        const marks = changeTextMarks([], { kind: 'toggle', mark: 'italic' });
        const next = replaceInlineText(document, { ...wholeBlockRange(document, 'p'), text: 'جديد', marks });
        expect(findNode(next, 'p')!.children![0].marks).toEqual([{ kind: 'italic' }]);
        expect(formatText(document, wholeBlockRange(document, 'p'), { kind: 'toggle', mark: 'italic' })).toBe(document);
    });

    it('changes headings without losing direction, other styles or block identity, and can remove inherited heading bold', () => {
        let document = formatBlock(source(), 'p', { kind: 'heading', level: 2, textAlign: 'center', indent: 2 });
        expect(findNode(document, 'p')).toMatchObject({
            id: 'p',
            kind: 'heading',
            attributes: { id: 'p', dir: 'rtl', level: 2, textAlign: 'center', indent: 2 },
        });
        expect(selectionTextStyle(document, wholeBlockRange(document, 'p'))).toMatchObject({ bold: true, size: 18 });
        document = formatText(document, wholeBlockRange(document, 'p'), { kind: 'toggle', mark: 'bold' });
        expect(selectionTextStyle(document, wholeBlockRange(document, 'p')).bold).toBe(false);
        document = formatBlock(document, 'p', { kind: 'paragraph' });
        expect(findNode(document, 'p')!.attributes?.level).toBeUndefined();
        expect(selectionTextStyle(document, wholeBlockRange(document, 'p')).size).toBe(10.5);
    });

    it('normalizes links and rejects executable URLs, malformed styles and stale formatting edits', () => {
        expect(normalizeLink('example.test/path')).toBe('https://example.test/path');
        expect(normalizeLink('mailto:editor@example.test')).toBe('mailto:editor@example.test');
        expect(normalizeLink('editor@example.test')).toBe('mailto:editor@example.test');
        expect(normalizeLink('+966 500 000 000')).toBe('tel:+966500000000');
        expect(() => normalizeLink('javascript:alert(1)')).toThrow();
        expect(() => normalizeLink('https://user:password@example.test')).toThrow();
        expect(() => changeTextMarks([], { kind: 'style', attributes: { fontFamily: 'missing font' } })).toThrow();
        expect(() => changeTextMarks([], { kind: 'style', attributes: { onClick: 'bad' } })).toThrow();
        expect(() => changeTextMarks([], { kind: 'style', attributes: { fontFamily: { invalid: true } } })).toThrow();
        expect(() =>
            formatText(
                source(),
                { ...wholeBlockRange(source(), 'p'), expectedRevision: 10 },
                { kind: 'toggle', mark: 'bold' },
            ),
        ).toThrow('conflict');
    });
});
