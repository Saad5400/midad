import { bilingualRows, configureBilingual, type BilingualOptions } from '@saad5400/midad/content/bilingual';
import { bilingualContentKey } from '@saad5400/midad/content/bilingual';
import {
    alignBilingualSources,
    applyBilingualTranslations,
    bilingualTranslationJobs,
} from '@saad5400/midad/content/bilingual';
import { BilingualTranslationRunner } from '@saad5400/midad/content/bilingual';
import { importDocument, type NativeDocument, type NativeNode } from '@saad5400/midad/document';
import { blockText, textBlocks } from '@saad5400/midad/editing';
import { persistClauseVariants } from '@saad5400/midad/content/clauses';
import { describe, expect, it, vi } from 'vitest';
const options: BilingualOptions = {
    languages: ['ar', 'en'],
    widths: 'even',
    gap: 'sm',
    divider: true,
    show: null,
    fill: 'auto',
};
let seed = 0;
function doc(content: unknown[], extra = {}): NativeDocument {
    return configureBilingual(
        importDocument({ type: 'doc', content } as never, `translation-${++seed}`),
        { ...options, ...extra },
        { kind: 'document' },
    )!.document;
}
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
function jobs(document: NativeDocument) {
    return bilingualTranslationJobs(document, new Set(bilingualRows(document).map((row) => row.id)));
}
const response = (requests: ReturnType<typeof jobs>) =>
    new Map(
        requests.flatMap((job) =>
            job.segments.map((segment) => [segment.id, segment.text.replace(/العقد/g, 'The contract')] as const),
        ),
    );
function alter(document: NativeDocument, id: string, change: (node: NativeNode) => NativeNode): NativeDocument {
    const visit = (node: NativeNode): NativeNode =>
        node.id === id ? change(node) : node.children ? { ...node, children: node.children.map(visit) } : node;
    return { ...document, revision: document.revision + 1, root: visit(document.root) };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
describe('portable bilingual translation', () => {
    it('preserves marks and field values while allocating an independent field and retaining the empty target caret identity', () => {
        const base = doc([
            {
                type: 'paragraph',
                attrs: { dir: 'rtl', dirLocked: true, textAlign: 'right' },
                content: [
                    { type: 'text', text: 'العقد', marks: [{ type: 'bold' }] },
                    {
                        type: 'variable',
                        attrs: {
                            id: 'source-field',
                            type: 'attachment',
                            name: 'Evidence',
                            value: [{ id: 'media-id', name: 'proof.pdf' }],
                        },
                    },
                ],
            },
        ]);
        const task = jobs(base);
        expect(task).toHaveLength(1);
        const applied = applyBilingualTranslations(base, task, response(task));
        expect(applied.applied).toHaveLength(1);
        const source = base.root.children![0].children![0],
            before = base.root.children![0].children![1],
            target = applied.document.root.children![0].children![1];
        expect(applied.document.root.children![0].children![0]).toBe(source);
        expect(target.children![0].id).toBe(before.children![0].id);
        expect(target.children![0].attributes).toMatchObject({ dir: 'ltr', textAlign: 'left' });
        expect(target.children![0].children![0]).toMatchObject({ text: 'The contract', marks: [{ kind: 'bold' }] });
        const field = target.children![0].children![1];
        expect(field.attributes?.id).not.toBe('source-field');
        expect(field.attributes?.value).toEqual([{ id: 'media-id', name: 'proof.pdf' }]);
    });
    it('fills table cells without losing row groups, merged-cell attributes or source content', () => {
        const base = doc([
            {
                type: 'table',
                content: [
                    {
                        type: 'tableRowGroup',
                        attrs: { groupType: 'tbody' },
                        content: [
                            {
                                type: 'tableRow',
                                content: [
                                    {
                                        type: 'tableCell',
                                        attrs: { colspan: 2, backgroundColor: '#fff000' },
                                        content: [paragraph('العقد')],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ]);
        const task = jobs(base);
        expect(task).toHaveLength(1);
        const target = applyBilingualTranslations(base, task, response(task)).document.root.children![0].children![1];
        expect(target.children![0].kind).toBe('table');
        expect(target.children![0].children![0].kind).toBe('tableRowGroup');
        expect(target.children![0].children![0].children![0].children![0].attributes).toMatchObject({
            colspan: 2,
            backgroundColor: '#fff000',
        });
        expect(textBlocks(target).map(blockText)).toEqual(['The contract']);
    });
    it('does not shift translations into an empty clause title and keeps the copied clause independent', () => {
        const base = doc([
            {
                type: 'clause',
                attrs: { groupId: 'source-group', activeVariantId: 'source-variant', variants: null },
                content: [{ type: 'clauseTitle' }, { type: 'clauseBody', content: [paragraph('العقد')] }],
            },
        ]);
        const normalized = persistClauseVariants(base);
        expect(bilingualContentKey(normalized.root.children![0].children![1].children!)).toBe(
            bilingualContentKey(base.root.children![0].children![1].children!),
        );
        const task = jobs(normalized);
        expect(task).toHaveLength(1);
        const target = applyBilingualTranslations(normalized, task, response(task)).document.root.children![0]
            .children![1].children![0];
        expect(blockText(target.children![0])).toBe('');
        expect(textBlocks(target.children![1]).map(blockText)).toEqual(['The contract']);
        expect(target.attributes?.groupId).not.toBe('source-group');
        expect(target.attributes?.activeVariantId).not.toBe('source-variant');
    });
    it.each(['missing', 'duplicate', 'formatting'])(
        'rejects %s rich placeholders without partially changing a target',
        (failure) => {
            const base = doc([
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'العقد', marks: [{ type: 'bold' }] },
                        { type: 'variable', attrs: { id: 'field', type: 'text', name: 'Amount' } },
                    ],
                },
            ]);
            const task = jobs(base),
                result = response(task);
            const id = task[0].segments[0].id;
            result.set(
                id,
                failure === 'missing'
                    ? '<t1>The contract</t1>'
                    : failure === 'duplicate'
                      ? '<t1>The contract</t1><x1/><x1/>'
                      : 'The contract<x1/>',
            );
            const applied = applyBilingualTranslations(base, task, result);
            expect(applied.document).toBe(base);
            expect(applied.failed).toEqual([task[0].key]);
        },
    );
    it('rejects source changes and a target the user has begun editing', () => {
        const base = doc([paragraph('العقد')]);
        const task = jobs(base);
        const sourceText = base.root.children![0].children![0].children![0].children![0];
        const sourceChanged = alter(base, sourceText.id, (node) => ({ ...node, text: 'تغيير المصدر' }));
        expect(applyBilingualTranslations(sourceChanged, task, response(task)).document).toBe(sourceChanged);
        const target = base.root.children![0].children![1].children![0];
        const targetChanged = alter(base, target.id, (node) => ({
            ...node,
            children: [{ id: 'typed', kind: 'text', text: 'User draft' }],
        }));
        expect(applyBilingualTranslations(targetChanged, task, response(task)).document).toBe(targetChanged);
    });
    it('merges into the latest document while retaining an unrelated edit', () => {
        const base = doc([paragraph('العقد')]);
        const task = jobs(base);
        const outside = importDocument({ type: 'doc', content: [paragraph('Unrelated new text')] }, 'outside').root
            .children![0];
        const edited = {
            ...base,
            revision: base.revision + 1,
            root: { ...base.root, children: [...base.root.children!, outside] },
        };
        const result = applyBilingualTranslations(edited, task, response(task));
        expect(result.applied).toHaveLength(1);
        expect(result.document.root.children![1]).toBe(outside);
    });
    it('moves text from the wrong column before filling and retains the original paragraph identity', () => {
        const base = doc([paragraph('العقد')], { source: 'en' });
        const paragraphId = base.root.children![0].children![1].children![0].id;
        const aligned = alignBilingualSources(base, new Set(bilingualRows(base).map((row) => row.id)));
        expect(aligned.root.children![0].children![0].children![0].id).toBe(paragraphId);
        expect(jobs(aligned)[0].from).toBe('ar');
    });
    it('applies ready batches before a slower batch finishes and retains three-request concurrency', async () => {
        let current = doc(Array.from({ length: 120 }, () => paragraph('العقد')));
        const calls: Array<{
            request: { segments: readonly { id: string; text: string }[] };
            result: ReturnType<typeof deferred<{ segments: { id: string; text: string }[]; failed: string[] }>>;
        }> = [];
        const translator = {
            translate: vi.fn((request) => {
                const result = deferred<{ segments: { id: string; text: string }[]; failed: string[] }>();
                calls.push({ request, result });
                return result.promise;
            }),
        };
        const runner = new BilingualTranslationRunner({
            document: () => current,
            apply: async (change) => {
                const value = change(current);
                current = value.document;
                return value;
            },
            translator,
        });
        runner.start(bilingualRows(current).map((row) => row.id));
        await expect.poll(() => calls.length).toBe(3);
        calls[0].result.resolve({
            segments: calls[0].request.segments.map((segment) => ({ ...segment, text: 'The contract' })),
            failed: [],
        });
        await expect.poll(() => runner.status.translated).toBe(40);
        expect(runner.status.pending).toBe(80);
        calls.slice(1).forEach(({ request, result }) =>
            result.resolve({
                segments: request.segments.map((segment) => ({ ...segment, text: 'The contract' })),
                failed: [],
            }),
        );
        await runner.idle();
        expect(runner.status.translated).toBe(120);
        expect(runner.status.pending).toBe(0);
        runner.dispose();
    });
    it('cancels a late provider without applying it or keeping the runner alive', async () => {
        let current = doc([paragraph('العقد')]);
        const before = current;
        const provider = deferred<{ segments: { id: string; text: string }[]; failed: string[] }>();
        const translate = vi.fn(() => provider.promise);
        const runner = new BilingualTranslationRunner({
            document: () => current,
            apply: async (change) => {
                const value = change(current);
                current = value.document;
                return value;
            },
            translator: { translate },
        });
        runner.start(bilingualRows(current).map((row) => row.id));
        await expect.poll(() => translate.mock.calls.length).toBe(1);
        runner.dispose();
        await runner.idle();
        provider.resolve({ segments: [], failed: [] });
        await Promise.resolve();
        expect(current).toBe(before);
    });
    it('does not apply a result after automatic filling or the split has been disabled', () => {
        const base = doc([paragraph('العقد')]);
        const task = jobs(base);
        const row = base.root.children![0];
        for (const attrs of [
            { ...row.attributes, fill: 'manual' },
            { ...row.attributes, show: 'ar' },
        ]) {
            const changed = alter(base, row.id, (node) => ({ ...node, attributes: attrs }));
            expect(applyBilingualTranslations(changed, task, response(task)).document).toBe(changed);
        }
    });
    it('can populate an untouched empty target after its source has gained a paragraph', () => {
        const base = doc([paragraph('العقد')]);
        const cell = base.root.children![0].children![0];
        const extra = importDocument({ type: 'doc', content: [paragraph('العقد الجديد')] }, 'extra-source').root
            .children![0];
        const changed = alter(base, cell.id, (node) => ({ ...node, children: [...node.children!, extra] }));
        const task = jobs(changed);
        expect(task).toHaveLength(1);
        expect(task[0].segments).toHaveLength(2);
        expect(applyBilingualTranslations(changed, task, response(task)).applied).toHaveLength(1);
    });
    it('copies neutral numbers and placeholders without a provider request', async () => {
        let current = doc([paragraph('123.45')]);
        const translate = vi.fn();
        const runner = new BilingualTranslationRunner({
            document: () => current,
            apply: async (change) => {
                const result = change(current);
                current = result.document;
                return result;
            },
            translator: { translate },
        });
        runner.start(bilingualRows(current).map((row) => row.id));
        await runner.idle();
        expect(translate).not.toHaveBeenCalled();
        expect(runner.status.translated).toBe(1);
        expect(textBlocks(current.root.children![0].children![1]).map(blockText)).toEqual(['123.45']);
        runner.dispose();
    });
    it('does not overwrite an attachment that replaced the initial empty target', () => {
        const base = doc([paragraph('العقد')]);
        const cell = base.root.children![0].children![1];
        const changed = alter(base, cell.id, (node) => ({
            ...node,
            children: [
                {
                    id: 'own-paragraph',
                    kind: 'paragraph',
                    children: [
                        {
                            id: 'own-field',
                            kind: 'variable',
                            attributes: {
                                id: 'owned',
                                type: 'attachment',
                                name: 'Uploaded evidence',
                                value: [{ id: 'new-media-id' }],
                            },
                        },
                    ],
                },
            ],
        }));
        expect(jobs(changed)).toHaveLength(0);
    });
    it('keeps failed targets empty, suppresses automatic repeated requests and permits explicit retry', async () => {
        let current = doc([paragraph('العقد')]);
        const rows = bilingualRows(current).map((row) => row.id);
        const translate = vi
            .fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockImplementationOnce(async (request) => ({
                segments: request.segments.map((segment) => ({ ...segment, text: 'The contract' })),
                failed: [],
            }));
        const runner = new BilingualTranslationRunner({
            document: () => current,
            apply: async (change) => {
                const value = change(current);
                current = value.document;
                return value;
            },
            translator: { translate },
        });
        runner.start(rows);
        await runner.idle();
        expect(runner.status.failed).toBe(1);
        runner.start(rows);
        await runner.idle();
        expect(translate).toHaveBeenCalledOnce();
        runner.start(rows, true);
        await runner.idle();
        expect(translate).toHaveBeenCalledTimes(2);
        expect(runner.status.translated).toBe(1);
        runner.dispose();
    });
});
