import { clauseNumbers, persistClauseNumbers, rejectedClause } from '@saad5400/midad/clause-numbering';
import { inheritedDirection, languageDirection } from '@saad5400/midad/direction';
import { findNode, importDocument } from '@saad5400/midad/document';
import { describe, expect, it } from 'vitest';

describe('native bilingual layout rules', () => {
    it.each(['ar', 'he-IL', 'fa', 'ur-PK', 'ps', 'yi', 'ckb', 'sd', 'ug', 'dv'])(
        'reads %s from right to left',
        (language) => {
            expect(languageDirection(language)).toBe('rtl');
        },
    );
    it('uses language direction while retaining explicit paragraph choices and custom column direction', () => {
        expect(inheritedDirection({ id: 'cell', kind: 'parallelCell', attributes: { lang: 'en' } }, 'rtl')).toBe('ltr');
        expect(
            inheritedDirection({ id: 'cell', kind: 'parallelCell', attributes: { lang: 'en', dir: 'rtl' } }, 'ltr'),
        ).toBe('rtl');
        expect(languageDirection('x-c1', 'rtl')).toBe('rtl');
        expect(languageDirection('x-c1', 'ltr')).toBe('ltr');
    });
    it('shares clause numbers across languages, counts hidden languages and skips rejected optional clauses', () => {
        const clause = (id: string, attrs = {}) => ({ type: 'clause', attrs: { id, ...attrs }, content: [] });
        const document = importDocument(
            {
                type: 'doc',
                content: [
                    clause('before'),
                    {
                        type: 'parallelRow',
                        attrs: { show: 'en' },
                        content: [
                            { type: 'parallelCell', attrs: { lang: 'ar' }, content: [clause('ar-1'), clause('ar-2')] },
                            { type: 'parallelCell', attrs: { lang: 'en' }, content: [clause('en-1')] },
                        ],
                    },
                    clause('after'),
                    clause('rejected', { optional: true, optionalValue: false, order: 99 }),
                    clause('unnumbered', { ordered: false }),
                    clause('hidden-title', { isTitleHidden: true }),
                ],
            },
            'contract',
        );
        expect([...clauseNumbers(document)]).toEqual([
            ['before', 1],
            ['ar-1', 2],
            ['ar-2', 3],
            ['en-1', 2],
            ['after', 4],
            ['hidden-title', 5],
        ]);
        const saved = persistClauseNumbers(document);
        expect(findNode(saved, 'en-1')!.attributes!.order).toBe(2);
        expect(findNode(saved, 'after')!.attributes!.order).toBe(4);
        expect(findNode(saved, 'rejected')!.attributes!.order).toBe(99);
        expect(saved.revision).toBe(document.revision);
        expect(persistClauseNumbers(saved)).toBe(saved);
    });
    it.each([false, 'false', '0'])('recognizes the saved optional rejection value %s', (optionalValue) => {
        expect(rejectedClause({ id: 'optional', kind: 'clause', attributes: { optional: true, optionalValue } })).toBe(
            true,
        );
    });
});
