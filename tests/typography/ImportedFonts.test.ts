import { importDocument } from '@saad5400/midad/document';
import { chooseFont, documentFontReplacements } from '@saad5400/midad/typography';
import { neededFontFiles } from '@saad5400/midad/rendering';
import { changeTextMarks } from '@saad5400/midad/editing';
import { DEFAULT_TEXT_STYLE } from '@saad5400/midad/typography';
import { describe, expect, it } from 'vitest';

describe('imported font fallbacks', () => {
    it.each([
        'DIN Next LT Arabic',
        'din next arabic',
        'DIN  Next LT Arabic Regular',
        'DIN Next LT Arabic Light',
        'DIN Next LT Arabic Medium',
    ])('uses the retained default face for unavailable imported %s', (family) => {
        expect(chooseFont({ ...DEFAULT_TEXT_STYLE, family })).toEqual(chooseFont(DEFAULT_TEXT_STYLE));
    });
    it('retains bold and italic when using the fallback face', () => {
        expect(chooseFont({ ...DEFAULT_TEXT_STYLE, family: 'DIN Next LT Arabic', bold: true, italic: true })).toEqual(
            chooseFont({ ...DEFAULT_TEXT_STYLE, bold: true, italic: true }),
        );
        expect(chooseFont({ ...DEFAULT_TEXT_STYLE, family: 'DIN Next LT Arabic Bold' })).toEqual(
            chooseFont({ ...DEFAULT_TEXT_STYLE, bold: true }),
        );
    });
    it('reports fallback use across headings, tables and field settings without rewriting the saved font', () => {
        const text = {
            type: 'text',
            text: 'Synthetic text',
            marks: [{ type: 'textStyle', attrs: { fontFamily: '"DIN Next LT Arabic", sans-serif' } }],
        };
        const document = importDocument(
            {
                type: 'doc',
                content: [
                    { type: 'heading', content: [text] },
                    {
                        type: 'table',
                        content: [
                            {
                                type: 'tableRow',
                                content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [text] }] }],
                            },
                        ],
                    },
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'variable',
                                attrs: {
                                    id: 'field',
                                    type: 'text',
                                    name: 'Field',
                                    settings: { fontFamily: 'DIN Next LT Arabic' },
                                },
                            },
                        ],
                    },
                ],
            },
            'imported-font',
        );
        const before = JSON.stringify(document);
        expect(documentFontReplacements(document)).toEqual([{ requested: 'DIN Next LT Arabic', actual: 'Arial' }]);
        expect([...neededFontFiles(document)]).toContain('liberationsans');
        expect(JSON.stringify(document)).toBe(before);
    });
    it('allows edits to existing imported font runs while keeping explicit new font choices registered', () => {
        const marks = [{ kind: 'textStyle', attributes: { fontFamily: 'DIN Next LT Arabic' } }];
        expect(() => changeTextMarks(marks, { kind: 'style', attributes: { fontSize: '20px' } })).not.toThrow();
        expect(() => chooseFont({ ...DEFAULT_TEXT_STYLE, family: 'DIN Next LT Arabic' }, false)).toThrow(
            'not registered',
        );
        expect(() => changeTextMarks([], { kind: 'style', attributes: { fontFamily: 'missing font' } })).toThrow(
            'not registered',
        );
    });
    it('keeps registered families unchanged, falls back for imported names and refuses malformed font names', () => {
        expect(
            documentFontReplacements(importDocument({ type: 'doc', content: [{ type: 'paragraph' }] }, 'no-fallback')),
        ).toEqual([]);
        expect(chooseFont({ ...DEFAULT_TEXT_STYLE, family: 'Amiri' }).file).toBe('amiri');
        expect(chooseFont({ ...DEFAULT_TEXT_STYLE, family: ' Times  New Roman ' })).toEqual(
            chooseFont({ ...DEFAULT_TEXT_STYLE, family: 'Times New Roman' }),
        );
        expect(chooseFont({ ...DEFAULT_TEXT_STYLE, family: '"Arial", sans-serif' })).toEqual(
            chooseFont(DEFAULT_TEXT_STYLE),
        );
        expect(chooseFont({ ...DEFAULT_TEXT_STYLE, family: 'An imported office font' })).toEqual(
            chooseFont(DEFAULT_TEXT_STYLE),
        );
        expect(chooseFont({ ...DEFAULT_TEXT_STYLE, family: 'خط مستورد' })).toEqual(chooseFont(DEFAULT_TEXT_STYLE));
        expect(chooseFont({ ...DEFAULT_TEXT_STYLE, family: 'monospace' })).toEqual(
            chooseFont({ ...DEFAULT_TEXT_STYLE, family: 'Courier New' }),
        );
        expect(chooseFont({ ...DEFAULT_TEXT_STYLE, family: 'serif' })).toEqual(
            chooseFont({ ...DEFAULT_TEXT_STYLE, family: 'Times New Roman' }),
        );
        expect(() => chooseFont({ ...DEFAULT_TEXT_STYLE, family: 'url(https://example.invalid/font)' })).toThrow(
            'not registered',
        );
    });
});
