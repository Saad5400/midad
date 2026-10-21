import {
    bilingualOptions,
    configureBilingual,
    droppedLanguages,
    type BilingualOptions,
} from '@saad5400/midad/content/bilingual';
import { exportDocument, importDocument } from '@saad5400/midad/document';
import { blockText, textBlocks } from '@saad5400/midad/editing';
import { persistNativeIdentities } from '@saad5400/midad/document';
import type { DocumentScene } from '@saad5400/midad/layout';
import { tableGrid } from '@saad5400/midad/editing';
import { describe, expect, it } from 'vitest';

const options: BilingualOptions = { languages: ['ar', 'en'], widths: 'even', gap: 'sm', divider: true, show: null };
const document = () =>
    importDocument(
        {
            type: 'doc',
            content: ['يلتزم الطرف بأحكام العقد', 'The parties agree'].map((text) => ({
                type: 'paragraph',
                content: [{ type: 'text', text }],
            })),
        },
        'contract',
    );

describe('native bilingual authoring', () => {
    it('detects the existing language, preserves source nodes and makes editable blank counterparts', () => {
        const source = document();
        const result = configureBilingual(source, options, { kind: 'document' })!;
        const rows = result.document.root.children!;
        expect(rows.map((row) => row.kind)).toEqual(['parallelRow', 'parallelRow']);
        expect(rows[0].children![0].children![0]).toBe(source.root.children![0]);
        expect(rows[1].children![1].children![0]).toBe(source.root.children![1]);
        expect(blockText(rows[0].children![1].children![0])).toBe('');
        expect(result.document.revision).toBe(source.revision + 1);
        expect(() => importDocument(exportDocument(persistNativeIdentities(result.document)), source.id)).not.toThrow();
    });
    it('changes only selected paragraphs and retains the selected source caret', () => {
        const source = document(),
            block = source.root.children![1];
        const result = configureBilingual(source, options, {
            kind: 'selection',
            selection: { anchor: { blockId: block.id, offset: 2 }, focus: { blockId: block.id, offset: 4 } },
        })!;
        expect(result.document.root.children![0]).toBe(source.root.children![0]);
        expect(result.document.root.children![1].kind).toBe('parallelRow');
        expect(result.caret).toEqual({ blockId: block.id, offset: 4 });
    });
    it('mirrors manual alignment and respects explicit source column selection', () => {
        const source = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        attrs: { dir: 'rtl', textAlign: 'right', custom: ['metadata'] },
                        content: [{ type: 'text', text: 'Text' }],
                    },
                ],
            },
            'contract',
        );
        const result = configureBilingual(source, { ...options, source: 'ar' }, { kind: 'document' })!;
        const cells = result.document.root.children![0].children!;
        expect(cells[0].children![0]).toBe(source.root.children![0]);
        expect(cells[1].children![0].attributes).toMatchObject({
            dir: 'auto',
            textAlign: 'left',
            custom: ['metadata'],
        });
    });
    it('requires confirmation before removing a written language', () => {
        const split = configureBilingual(document(), options, { kind: 'document' })!.document;
        const single = { ...options, languages: ['ar'] };
        expect(droppedLanguages(split, single, { kind: 'document' })).toEqual(['en']);
        expect(() => configureBilingual(split, single, { kind: 'document' })).toThrow('requires confirmation');
        const confirmed = configureBilingual(split, single, { kind: 'document' }, true)!;
        expect(confirmed.document.root.children![1].children).toHaveLength(1);
    });
    it('requires confirmation before removing a blank clause with saved alternatives or explanations', () => {
        const source = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'clause',
                        attrs: {
                            explanation: {
                                type: 'doc',
                                content: [
                                    { type: 'paragraph', content: [{ type: 'text', text: 'Keep this explanation' }] },
                                ],
                            },
                            variants: [
                                {
                                    id: 'saved',
                                    bodyContent: {
                                        type: 'doc',
                                        content: [
                                            {
                                                type: 'paragraph',
                                                content: [{ type: 'text', text: 'Keep this variant' }],
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                        content: [{ type: 'clauseTitle' }, { type: 'clauseBody', content: [{ type: 'paragraph' }] }],
                    },
                ],
            },
            'contract',
        );
        const split = configureBilingual(source, { ...options, source: 'en' }, { kind: 'document' })!.document;
        expect(droppedLanguages(split, { ...options, languages: ['ar'] }, { kind: 'document' })).toEqual(['en']);
    });
    it('retains all language content when switching between stacked and single-language views', () => {
        const split = configureBilingual(document(), { ...options, fill: 'auto' }, { kind: 'document' })!.document;
        const stacked = configureBilingual(split, { ...options, show: 'all' }, { kind: 'document' })!.document;
        const single = configureBilingual(stacked, { ...options, show: 'en' }, { kind: 'document' })!.document;
        expect(single.root.children![0].children).toEqual(split.root.children![0].children);
        expect(textBlocks(single.root).map(blockText)).toEqual(textBlocks(split.root).map(blockText));
        expect(bilingualOptions(single.root.children![0]).fill).toBe('auto');
    });
    it('keeps grouped table structure and creates fresh blank target cells', () => {
        const source = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'table',
                        content: [
                            {
                                type: 'tableRowGroup',
                                content: [
                                    {
                                        type: 'tableRow',
                                        content: [0, 1].map(() => ({
                                            type: 'tableCell',
                                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'جدول' }] }],
                                        })),
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            'contract',
        );
        const result = configureBilingual(source, options, { kind: 'document' })!.document;
        const sourceTable = result.root.children![0].children![0].children![0];
        const targetTable = result.root.children![0].children![1].children![0];
        expect(sourceTable).toBe(source.root.children![0]);
        expect(tableGrid(targetTable).rows).toHaveLength(1);
        expect(tableGrid(targetTable).columns).toBe(2);
        expect(textBlocks(targetTable).map(blockText)).toEqual(['', '']);
    });
    it('makes independent clause counterparts without copying inactive variants', () => {
        const source = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'clause',
                        attrs: {
                            id: 'source-clause',
                            groupId: 'source-group',
                            activeVariantId: 'source-variant',
                            variants: [{ id: 'source-variant' }],
                            contentHash: 'source-hash',
                        },
                        content: [
                            { type: 'clauseTitle', content: [{ type: 'text', text: 'عنوان' }] },
                            {
                                type: 'clauseBody',
                                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'نص عربي' }] }],
                            },
                        ],
                    },
                ],
            },
            'contract',
        );
        const split = configureBilingual(source, options, { kind: 'document' })!.document;
        const target = split.root.children![0].children![1].children![0];
        expect(target.attributes!.groupId).not.toBe('source-group');
        expect(target.attributes).toMatchObject({ variants: null, variantCount: 1, contentHash: null });
        expect(source.root.children![0].attributes!.variants).toEqual([{ id: 'source-variant' }]);
    });
    it('refuses stale page scopes', () => {
        const source = document();
        const scene = { documentId: source.id, revision: source.revision + 1, pages: [] } as unknown as DocumentScene;
        expect(() => configureBilingual(source, options, { kind: 'page', page: 0, scene })).toThrow('scope is stale');
    });
    it.each([[], ['ar', 'ar'], ['ar', 'en', 'fr', 'de']].map((languages) => ({ languages })))(
        'rejects invalid column languages $languages',
        ({ languages }) => {
            expect(() => configureBilingual(document(), { ...options, languages }, { kind: 'document' })).toThrow(
                'distinct column languages',
            );
        },
    );
});
