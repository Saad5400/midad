import { exportDocument, findNode, importDocument } from '@saad5400/midad/document';
import { identity, splitTextBlock } from '@saad5400/midad/editing';
import { persistNativeIdentities } from '@saad5400/midad/identities';
import { describe, expect, it } from 'vitest';

describe('persistent native node identities', () => {
    it('keeps anchors attached to their paragraphs after an earlier paragraph is split and saved', () => {
        const original = importDocument(
            {
                type: 'doc',
                content: ['First', 'Second'].map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
            },
            'contract',
        );
        const saved = persistNativeIdentities(original);
        const anchor = original.root.children![1].id;
        const edited = splitTextBlock(saved, {
            blockId: saved.root.children![0].id,
            from: 2,
            to: 2,
            expectedRevision: saved.revision,
        });
        const reloaded = importDocument(exportDocument(persistNativeIdentities(edited.document)), original.id);
        expect(reloaded.root.children).toHaveLength(3);
        expect(findNode(reloaded, anchor)?.children?.[0].text).toBe('Second');
        expect(original.root.children![1].attributes).toBeUndefined();
        expect(saved.revision).toBe(original.revision);
    });
    it('preserves numeric domain identifiers using a separate native identity', () => {
        const original = importDocument(
            {
                type: 'doc',
                attrs: { id: 12 },
                content: [
                    {
                        type: 'paragraph',
                        attrs: { id: 34, extra: ['metadata'] },
                        content: [{ type: 'text', text: 'عقد' }],
                    },
                ],
            },
            'contract',
        );
        const saved = persistNativeIdentities(original);
        const reloaded = importDocument(exportDocument(saved), original.id);
        expect(saved.root.attributes!.id).toBe(12);
        expect(saved.root.children![0].attributes).toMatchObject({
            id: 34,
            extra: ['metadata'],
            nativeId: original.root.children![0].id,
        });
        expect(reloaded.root.children![0].id).toBe(original.root.children![0].id);
    });
    it('is idempotent and retains unmodified text objects', () => {
        const original = importDocument(
            { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }] },
            'contract',
        );
        const saved = persistNativeIdentities(original);
        expect(persistNativeIdentities(saved)).toBe(saved);
        expect(saved.root.children![0].children![0]).toBe(original.root.children![0].children![0]);
    });

    it('preserves a changed string domain identifier without moving the native anchor', () => {
        const original = importDocument({ type: 'doc', attrs: { id: 'original' }, content: [] }, 'contract');
        const changed = { ...original, root: { ...original.root, attributes: { id: 'another-variant' } } };
        const saved = persistNativeIdentities(changed);
        expect(saved.root.attributes).toMatchObject({ id: 'another-variant', nativeId: 'original' });
        expect(importDocument(exportDocument(saved), original.id).root.id).toBe('original');
    });
    it('keeps a signing field tied to its existing variable UUID', () => {
        const uuid = '11111111-1111-4111-8111-111111111111';
        const original = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            { type: 'variable', attrs: { id: uuid, nativeId: 'foreign-metadata', type: 'signature' } },
                        ],
                    },
                ],
            },
            'contract',
        );
        const saved = persistNativeIdentities(original);
        const reloaded = importDocument(exportDocument(saved), original.id);
        expect(reloaded.root.children![0].children![0].id).toBe(uuid);
        expect(reloaded.root.children![0].children![0].attributes!.id).toBe(uuid);
    });
    it('assigns a fresh native identity to a copied node', () => {
        const node = importDocument({ type: 'doc', attrs: { id: 1 }, content: [] }, 'contract').root;
        const saved = persistNativeIdentities({ schemaVersion: 1, id: 'contract', revision: 0, root: node });
        const copy = identity(saved.root, 'copy');
        expect(copy.id).toBe('copy');
        expect(copy.attributes!.nativeId).toBe('copy');
        expect(saved.root.attributes!.nativeId).toBe('contract:root');
    });
    it('rejects duplicate persisted identities', () => {
        expect(() =>
            importDocument(
                {
                    type: 'doc',
                    attrs: { nativeId: 'same' },
                    content: [{ type: 'paragraph', attrs: { nativeId: 'same' } }],
                },
                'contract',
            ),
        ).toThrow('Duplicate node identity');
    });

    it('keeps generated text identities distinct when a previously nested paragraph is unwrapped', () => {
        const original = persistNativeIdentities(
            importDocument(
                {
                    type: 'doc',
                    content: [
                        {
                            type: 'blockquote',
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }],
                        },
                    ],
                },
                'contract',
            ),
        );
        const paragraph = original.root.children![0].children![0];
        const unwrapped = { ...original, root: { ...original.root, children: [paragraph] } };
        const reloaded = importDocument(exportDocument(unwrapped), original.id);
        expect(reloaded.root.children![0].id).toBe(paragraph.id);
        expect(reloaded.root.children![0].children![0].id).not.toBe(paragraph.id);
        expect(reloaded.root.children![0].children![0].text).toBe('Text');
    });
});
