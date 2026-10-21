import {
    DocumentSession,
    exportDocument,
    findNode,
    importDocument,
    replaceText,
} from '@saad5400/midad/document';
import { describe, expect, it } from 'vitest';
import { CORPUS_CASES, createMigrationFixture } from '../fixtures/migrationCorpus';

describe('our native document runtime', () => {
    it.each(CORPUS_CASES)('preserves every $id fixture field through migration', ({ id }) => {
        const fixture = createMigrationFixture(id);
        expect(exportDocument(importDocument(fixture, 'document'))).toEqual(fixture);
    });

    it('preserves inactive variants, image references and field metadata during text edits', () => {
        const fixture = createMigrationFixture();
        const source = importDocument(fixture, 'document');
        const edited = replaceText(source, {
            nodeId: 'document:root.1.0',
            from: 0,
            to: 0,
            text: 'نص ',
            expectedRevision: 0,
        });
        expect(edited.revision).toBe(1);
        expect(edited.root.attributes).toBe(source.root.attributes);
        expect(edited.root.children![4]).toBe(source.root.children![4]);
        expect(exportDocument(source)).toEqual(fixture);
        expect(findNode(edited, 'document:root.1.0')?.text).toMatch(/^نص /);
    });

    it('rejects stale changes without editing the document', () => {
        const source = importDocument(createMigrationFixture(), 'document');
        expect(() =>
            replaceText(source, { nodeId: 'document:root.1.0', from: 0, to: 0, text: 'نص', expectedRevision: 1 }),
        ).toThrow('revision conflict');
    });

    it.each(['سَ', '👨‍👩‍👧‍👦', '🇸🇦'])('does not split the grapheme %s', (text) => {
        const source = importDocument(
            { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
            'document',
        );
        expect(() =>
            replaceText(source, { nodeId: 'document:root.0.0', from: 1, to: 1, text: 'x', expectedRevision: 0 }),
        ).toThrow('grapheme boundaries');
    });

    it('keeps revisions monotonic through undo and redo', () => {
        const source = importDocument(createMigrationFixture('arabic'), 'document');
        const session = new DocumentSession(source);
        session.replace({ nodeId: 'document:root.1.0', from: 0, to: 0, text: 'نص ', expectedRevision: 0 });
        expect(session.undo()).toBe(true);
        expect(session.document.revision).toBe(2);
        expect(exportDocument(session.document)).toEqual(exportDocument(source));
        expect(session.redo()).toBe(true);
        expect(session.document.revision).toBe(3);
        expect(findNode(session.document, 'document:root.1.0')?.text).toMatch(/^نص /);
    });

    it('rejects duplicate anchors and unknown nodes instead of losing their content', () => {
        expect(() =>
            importDocument(
                {
                    type: 'doc',
                    content: [
                        { type: 'paragraph', attrs: { id: 'same' } },
                        { type: 'paragraph', attrs: { id: 'same' } },
                    ],
                },
                'document',
            ),
        ).toThrow('Duplicate');
        expect(() =>
            importDocument({ type: 'doc', content: [{ type: 'unsupported-business-node' }] }, 'document'),
        ).toThrow('Unsupported');
    });
});
