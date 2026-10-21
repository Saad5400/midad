import {
    bilingualRows,
    bilingualScopeState,
    configureBilingual,
    droppedLanguages,
    endBilingual,
    setBilingualSettings,
    type BilingualOptions,
} from '@saad5400/midad/bilingual';
import { importDocument, type NativeDocument } from '@saad5400/midad/document';
import { blockText, nodePath, textBlocks } from '@saad5400/midad/editing';
import { describe, expect, it } from 'vitest';
const options: BilingualOptions = { languages: ['ar', 'en'], widths: 'even', gap: 'sm', divider: true, show: null };
const scope = { kind: 'document' } as const;
let seed = 0;
function plain(count = 2): NativeDocument {
    return importDocument(
        {
            type: 'doc',
            content: Array.from({ length: count }, (_, index) => ({
                type: 'paragraph',
                content: [{ type: 'text', text: index % 2 ? 'English contract' : 'العقد العربي' }],
            })),
        },
        `controls-${++seed}`,
    );
}
function split(): NativeDocument {
    return configureBilingual(plain(), options, scope)!.document;
}
describe('bilingual settings and ending controls', () => {
    it('does not wrap unrelated ordinary paragraphs when changing existing split settings', () => {
        const base = split();
        const extra = plain().root.children![0];
        const doc = { ...base, root: { ...base.root, children: [...base.root.children!, extra] } };
        const result = setBilingualSettings(doc, { ...options, gap: 'lg' }, scope)!;
        expect(result.document.root.children![2]).toBe(extra);
        expect(bilingualRows(result.document)).toHaveLength(2);
        expect(result.document.root.children![0].attributes?.gap).toBe('lg');
    });
    it('preserves previously hidden rows while changing settings and resumes an entirely hidden split', () => {
        const base = split();
        const first = base.root.children![0];
        const block = textBlocks(first)[0];
        const selected = {
            kind: 'selection',
            selection: { anchor: { blockId: block.id, offset: 0 }, focus: { blockId: block.id, offset: 1 } },
        } as const;
        const hidden = endBilingual(base, selected, 'ar')!.document;
        const updated = setBilingualSettings(hidden, { ...options, gap: 'lg' }, scope)!.document;
        expect(updated.root.children![0].attributes?.show).toBe('ar');
        expect(updated.root.children![1].attributes?.show).toBeNull();
        const allHidden = endBilingual(hidden, scope, 'all')!.document;
        const resumed = setBilingualSettings(allHidden, options, scope)!.document;
        expect(bilingualRows(resumed).every((row) => row.attributes?.show === null)).toBe(true);
    });
    it('ends only active rows and moves the caret out of a newly hidden language', () => {
        const base = split();
        const english = textBlocks(base.root.children![1])[1];
        const selected = {
            ...scope,
            selection: { anchor: { blockId: english.id, offset: 2 }, focus: { blockId: english.id, offset: 3 } },
        };
        const result = endBilingual(base, selected, 'ar')!;
        expect(result.document.root.children![0].children).toBe(base.root.children![0].children);
        expect(blockText(nodePath(result.document, english.id).at(-1)!)).toBe('English contract');
        expect(result.caret.blockId).not.toBe(english.id);
        expect(
            nodePath(result.document, result.caret.blockId).some((node) => node.id === base.root.children![1].id),
        ).toBe(true);
        expect(
            nodePath(result.document, result.caret.blockId).some(
                (node) => node.kind === 'parallelCell' && node.attributes?.lang === 'ar',
            ),
        ).toBe(true);
    });
    it('restricts single-language endings to languages shared by the selected active rows', () => {
        const base = split();
        const row = configureBilingual(plain(1), { ...options, languages: ['hi', 'bn'] }, scope)!.document.root
            .children![0];
        const doc = { ...base, root: { ...base.root, children: [...base.root.children!, row] } };
        expect(bilingualScopeState(doc, scope).available).toEqual([]);
        expect(() => endBilingual(doc, scope, 'ar')).toThrow('unavailable');
        expect(endBilingual(doc, scope, 'all')!.document.root.children).toHaveLength(3);
    });
    it('accounts for nested written columns without wrapping their container into a second split', () => {
        const row = split().root.children![1];
        const doc = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'blockquote',
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Container' }] }],
                    },
                ],
            },
            'nested',
        );
        const group = { ...doc.root.children![0], children: [row] };
        const nested = { ...doc, root: { ...doc.root, children: [group] } };
        expect(droppedLanguages(nested, { ...options, languages: ['ar'] }, scope)).toEqual(['en']);
        expect(() => setBilingualSettings(nested, { ...options, languages: ['ar'] }, scope)).toThrow(
            'requires confirmation',
        );
        const updated = configureBilingual(nested, { ...options, gap: 'lg' }, scope)!.document;
        expect(updated.root.children![0].kind).toBe('blockquote');
        expect(bilingualRows(updated)).toHaveLength(1);
    });
    it('retains content and cell identities when changing language-tag casing', () => {
        const base = split();
        const updated = setBilingualSettings(base, { ...options, languages: ['AR', 'EN'] }, scope)!.document;
        expect(droppedLanguages(base, { ...options, languages: ['AR', 'EN'] }, scope)).toEqual([]);
        expect(updated.root.children![1].children![1].id).toBe(base.root.children![1].children![1].id);
        expect(updated.root.children![1].children![1].children).toBe(base.root.children![1].children![1].children);
    });
    it('provides a real editable caret for image-only column content', () => {
        const doc = importDocument(
            {
                type: 'doc',
                content: [{ type: 'image', attrs: { src: 'data:image/png;base64,AA==', width: 40, height: 40 } }],
            },
            'image-only',
        );
        const result = configureBilingual(doc, options, scope)!;
        expect(nodePath(result.document, result.caret.blockId).some((node) => node.kind === 'image')).toBe(false);
        expect(result.document.root.children?.some((node) => node.id === result.caret.blockId)).toBe(true);
    });
    it('keeps no-op settings free of extra revisions and scans large documents within the operation budget', () => {
        const doc = configureBilingual(plain(600), options, scope)!.document;
        const started = performance.now();
        expect(setBilingualSettings(doc, options, scope)!.document).toBe(doc);
        expect(bilingualScopeState(doc, scope).languages).toEqual(['ar', 'en']);
        const ended = endBilingual(doc, scope, 'all')!;
        expect(ended.rows).toHaveLength(600);
        expect(performance.now() - started).toBeLessThan(5000);
    });
});
