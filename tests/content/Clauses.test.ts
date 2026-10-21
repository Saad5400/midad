import {
    activeClauseVariant,
    changeClauseVariant,
    clauseVariants,
    createNativeClause,
    insertNativeClause,
    nativeClauses,
    persistClauseVariants,
    removeNativeClause,
    setClauseProperties,
    type LibraryClause,
} from '@saad5400/midad/content/clauses';
import { exportDocument, findNode, importDocument } from '@saad5400/midad/document';
import { blockText, replaceInlineText, textBlocks } from '@saad5400/midad/editing';
import { persistNativeIdentities } from '@saad5400/midad/document';
import { SharedNativeDocument } from '@saad5400/midad/collaboration';
import { describe, expect, it } from 'vitest';

const rawBody = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const library: LibraryClause = {
    uuid: 'library-group',
    title: 'البند',
    ordered: true,
    optional: true,
    explanation: rawBody('شرح'),
    default_variant: { uuid: 'variant-a' },
    variants: [
        {
            uuid: 'variant-a',
            description: { ar: 'الأول', en: 'First' },
            body_content: rawBody('First body'),
            content_hash: 'hash-a',
        },
        { uuid: 'variant-b', description: 'Second', body_content: rawBody('Second body'), content_hash: 'hash-b' },
    ],
};
const empty = () => importDocument({ type: 'doc', content: [{ type: 'paragraph' }] }, 'contract');
function inserted() {
    const source = empty();
    return insertNativeClause(source, { blockId: source.root.children![0].id, offset: 0 }, library);
}
const bodyText = (node: ReturnType<typeof createNativeClause>) =>
    textBlocks(node.children!.find((child) => child.kind === 'clauseBody')!)
        .map(blockText)
        .join('\n');

describe('native clause authoring', () => {
    it('inserts library clauses at the cursor without dropping surrounding text', () => {
        const source = importDocument(rawBody('BeforeAfter'), 'contract');
        const result = insertNativeClause(source, { blockId: source.root.children![0].id, offset: 6 }, library);
        expect(result.document.root.children!.map((node) => node.kind)).toEqual(['paragraph', 'clause', 'paragraph']);
        expect(blockText(result.document.root.children![0])).toBe('Before');
        expect(blockText(result.document.root.children![2])).toBe('After');
        expect(result.document.revision).toBe(source.revision + 1);
    });
    it('inserts the same library clause twice with distinct editor anchors and preserves library identifiers', () => {
        const first = inserted();
        const second = insertNativeClause(first.document, first.caret, library);
        const clauses = nativeClauses(second.document);
        expect(clauses).toHaveLength(2);
        expect(clauses[0].id).not.toBe(clauses[1].id);
        expect(clauses.map((node) => node.attributes!.id)).toEqual(['variant-a', 'variant-a']);
        expect(() =>
            importDocument(exportDocument(persistNativeIdentities(second.document)), second.document.id),
        ).not.toThrow();
    });
    it('saves live edits before switching variants and restores them on returning', () => {
        let { document } = inserted();
        const clause = nativeClauses(document)[0],
            block = textBlocks(clause.children![1])[0];
        document = replaceInlineText(document, {
            blockId: block.id,
            from: 0,
            to: 0,
            text: 'Edited ',
            expectedRevision: document.revision,
        });
        const second = changeClauseVariant(document, clause.id, { kind: 'select', id: 'variant-b' });
        expect(bodyText(nativeClauses(second.document)[0])).toBe('Second body');
        const returned = changeClauseVariant(second.document, clause.id, { kind: 'select', id: 'variant-a' });
        const restored = nativeClauses(returned.document)[0];
        expect(restored.id).toBe(clause.id);
        expect(restored.attributes).toMatchObject({
            id: 'variant-a',
            activeVariantId: 'variant-a',
            nativeId: clause.id,
        });
        expect(bodyText(restored)).toBe('Edited First body');
    });
    it('persists edited active bodies into the saved variant cache without changing the local revision', () => {
        let { document } = inserted();
        const clause = nativeClauses(document)[0],
            block = textBlocks(clause.children![1])[0];
        document = replaceInlineText(document, {
            blockId: block.id,
            from: 0,
            to: 5,
            text: 'Updated',
            expectedRevision: document.revision,
        });
        const saved = persistClauseVariants(persistNativeIdentities(document));
        expect(saved.revision).toBe(document.revision);
        expect(JSON.stringify(nativeClauses(saved)[0].attributes!.variants)).toContain('Updated body');
        expect(persistClauseVariants(saved)).toBe(saved);
    });
    it('retains live wording for legacy variants with an empty cache and rejects malformed bodies', () => {
        const source = empty();
        const clause = createNativeClause(source, '', library);
        const raw = JSON.parse(JSON.stringify(exportDocument({ ...source, root: clause }))) as {
            attrs: { variants: Array<{ bodyContent: unknown }> };
        };
        raw.attrs.variants[1].bodyContent = null;
        const document = importDocument({ type: 'doc', content: [raw] }, source.id);
        const selected = changeClauseVariant(document, clause.id, { kind: 'select', id: 'variant-b' });
        expect(bodyText(nativeClauses(selected.document)[0])).toBe('First body');
        expect(() =>
            createNativeClause(source, '', {
                ...library,
                variants: [{ ...library.variants[0], body_content: { type: 'image', attrs: { src: 'missing' } } }],
            }),
        ).toThrow('Invalid clause variant body');
    });
    it('adds, reorders, describes and removes variants while retaining at least one', () => {
        const source = inserted(),
            id = nativeClauses(source.document)[0].id;
        const added = changeClauseVariant(source.document, id, { kind: 'add' });
        const newId = activeClauseVariant(nativeClauses(added.document)[0]);
        expect(clauseVariants(added.document, nativeClauses(added.document)[0])).toHaveLength(3);
        const described = changeClauseVariant(added.document, id, {
            kind: 'describe',
            id: 'variant-a',
            description: 'محدّث',
            locale: 'ar',
        });
        expect(clauseVariants(described.document, nativeClauses(described.document)[0])[0].description).toEqual({
            ar: 'محدّث',
            en: 'First',
        });
        const moved = changeClauseVariant(described.document, id, { kind: 'move', id: newId, delta: -1 });
        expect(clauseVariants(moved.document, nativeClauses(moved.document)[0])[1].id).toBe(newId);
        const removed = changeClauseVariant(moved.document, id, { kind: 'remove', id: newId });
        expect(clauseVariants(removed.document, nativeClauses(removed.document)[0])).toHaveLength(2);
        const one = changeClauseVariant(removed.document, id, { kind: 'remove', id: 'variant-b' });
        expect(() => changeClauseVariant(one.document, id, { kind: 'remove', id: 'variant-a' })).toThrow(
            'at least one',
        );
    });
    it('changes optional configuration across a group without resetting an existing decision for unrelated settings', () => {
        const first = inserted(),
            next = insertNativeClause(first.document, first.caret, library).document;
        const id = nativeClauses(next)[0].id;
        const accepted = setClauseProperties(next, id, { optionalValue: true });
        const styled = setClauseProperties(accepted, id, { ordered: false, optional: true });
        expect(nativeClauses(styled)[0].attributes!.optionalValue).toBe(true);
        const disabled = setClauseProperties(styled, id, { optional: false });
        expect(nativeClauses(disabled).map((node) => node.attributes!.optional)).toEqual([false, false]);
        expect(nativeClauses(disabled).map((node) => node.attributes!.optionalValue)).toEqual([null, null]);
    });
    it('unwraps a clause without losing its rich body and leaves an editable document after removal', () => {
        const source = inserted(),
            clause = nativeClauses(source.document)[0];
        const unwrapped = removeNativeClause(source.document, clause.id, true);
        expect(nativeClauses(unwrapped.document)).toHaveLength(0);
        expect(textBlocks(unwrapped.document.root).map(blockText)).toEqual(['البند', 'First body']);
        expect(unwrapped.document.root.children?.[0].kind).toBe('heading');
        expect(unwrapped.document.root.children?.[0].attributes?.level).toBe(3);
        const removed = removeNativeClause(source.document, clause.id);
        expect(textBlocks(removed.document.root)).toHaveLength(1);
        expect(findNode(removed.document, removed.caret.blockId)?.kind).toBe('paragraph');
    });
    it('synchronizes an unwrapped title and body and restores the clause through shared undo', () => {
        const shared = SharedNativeDocument.create(inserted().document);
        const peer = SharedNativeDocument.fromState(shared.state(), shared.document().id);
        try {
            shared.publish(
                removeNativeClause(shared.document(), nativeClauses(shared.document())[0].id, true).document,
            );
            peer.receive(shared.state());
            expect(textBlocks(peer.document().root).map(blockText)).toEqual(['البند', 'First body']);
            expect(peer.document().root.children?.[0].kind).toBe('heading');
            shared.undo();
            peer.receive(shared.state());
            expect(nativeClauses(peer.document())).toHaveLength(1);
            expect(textBlocks(peer.document().root).map(blockText)).toEqual(['البند', 'First body']);
        } finally {
            shared.destroy();
            peer.destroy();
        }
    });
    it('leaves an editable paragraph when deleting a clause from a table cell', () => {
        const source = empty();
        const clause = createNativeClause(source, '', library);
        const document = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'table',
                        content: [
                            {
                                type: 'tableRow',
                                content: [
                                    { type: 'tableCell', content: [exportDocument({ ...source, root: clause })] },
                                ],
                            },
                        ],
                    },
                ],
            },
            source.id,
        );
        const removed = removeNativeClause(document, clause.id);
        const cell = removed.document.root.children![0].children![0].children![0];
        expect(cell.children!.map((node) => node.kind)).toEqual(['paragraph']);
        expect(removed.caret.blockId).toBe(cell.children![0].id);
    });
    it('gives repeated library fields private UUIDs per insertion and preserves a shared field across variants', () => {
        const variable = {
            type: 'variable',
            attrs: {
                id: '11111111-1111-4111-8111-111111111111',
                type: 'text',
                participant_id: 'foreign-participant',
                value: 'Prefilled',
            },
        };
        const withFields = {
            ...library,
            variants: library.variants.map((variant) => ({
                ...variant,
                body_content: { type: 'doc', content: [{ type: 'paragraph', content: [variable] }] },
            })),
        };
        const source = empty();
        const first = insertNativeClause(source, undefined, withFields);
        const second = insertNativeClause(first.document, undefined, withFields);
        const clauses = nativeClauses(second.document);
        const field = (node: (typeof clauses)[number]) => node.children![1].children![0].children![0];
        expect(field(clauses[0]).id).not.toBe(field(clauses[1]).id);
        expect(field(clauses[0]).attributes).toMatchObject({ participant_id: null, value: 'Prefilled' });
        const switched = changeClauseVariant(second.document, clauses[0].id, { kind: 'select', id: 'variant-b' });
        expect(field(nativeClauses(switched.document)[0]).id).toBe(field(clauses[0]).id);
    });
});
