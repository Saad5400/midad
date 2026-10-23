import {
    DocumentEditError,
    DocumentSession,
    importDocument,
    replaceText,
    applyDocumentEdit,
} from '@saad5400/midad/document';
import { describe, expect, it } from 'vitest';

const document = () =>
    importDocument(
        { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original' }] }] },
        'validation',
    );
const edit = (source: ReturnType<typeof document>, text: string) =>
    replaceText(source, { nodeId: 'validation:root.0.0', from: 0, to: 0, text, expectedRevision: source.revision });

describe('document edit validation', () => {
    it('does not mutate content or undo/redo history when preparation fails', async () => {
        const session = new DocumentSession(document());
        session.commit(edit(session.document, 'First '));
        session.undo();
        const before = session.document;
        await expect(
            applyDocumentEdit(
                edit(before, '\uFFFF'),
                () => session.document,
                () => {
                    throw new Error('Missing glyph');
                },
                () => {
                    throw new Error('Rejected edit committed');
                },
            ),
        ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT_EDIT', cause: { message: 'Missing glyph' } });
        expect(session.document).toBe(before);
        expect(session.canUndo).toBe(false);
        expect(session.canRedo).toBe(true);
        expect(session.redo()).toBe(true);
    });

    it('returns prepared output for an atomic commit after successful validation', async () => {
        const session = new DocumentSession(document());
        const original = session.document.root;
        const next = edit(session.document, 'Valid ');
        const prepared = await applyDocumentEdit(
            next,
            () => session.document,
            async () => ({ pages: 2 }),
            (prepared) => {
                session.commit(next);
                return prepared;
            },
        );
        expect(session.document.revision).toBe(1);
        expect(prepared).toEqual({ pages: 2 });
        expect(session.undo()).toBe(true);
        expect(session.document.root).toBe(original);
    });

    it('rejects a delayed result after another edit or replacement without overwriting it', async () => {
        const session = new DocumentSession(document());
        let release!: () => void;
        const waiting = new Promise<void>((resolve) => {
            release = resolve;
        });
        const pending = applyDocumentEdit(
            edit(session.document, 'Delayed '),
            () => session.document,
            () => waiting,
            () => {
                throw new Error('Stale edit committed');
            },
        );
        session.commit(edit(session.document, 'Newer '));
        const newer = session.document;
        release();
        await expect(pending).rejects.toMatchObject({ code: 'STALE_DOCUMENT_EDIT' });
        expect(session.document).toBe(newer);
        expect(session.canUndo).toBe(true);
    });

    it('accepts at most one concurrently prepared candidate for the same head', async () => {
        const session = new DocumentSession(document());
        const base = session.document;
        const jobs = ['A', 'B'].map((text) => {
            const next = edit(base, text);
            return applyDocumentEdit(
                next,
                () => session.document,
                async () => undefined,
                () => session.commit(next),
            );
        });
        const results = await Promise.allSettled(jobs);
        expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
        expect(session.document.revision).toBe(1);
        expect(session.undo()).toBe(true);
        expect(session.document.root).toBe(base.root);
        expect(session.canUndo).toBe(false);
    });

    it.each(['accepted', 'stale', 'apply failure'])('releases prepared resources after %s', async (mode) => {
        const session = new DocumentSession(document());
        const base = session.document;
        const resources = { released: 0 };
        const task = applyDocumentEdit(
            edit(base, 'Candidate '),
            () => session.document,
            async () => {
                if (mode === 'stale') session.commit(edit(base, 'Other '));
                return resources;
            },
            () => {
                if (mode === 'apply failure') throw new Error('Commit failed');
                return true;
            },
            (value) => {
                value.released++;
            },
        );
        if (mode === 'accepted') await expect(task).resolves.toBe(true);
        else await expect(task).rejects.toBeInstanceOf(Error);
        expect(resources.released).toBe(1);
    });

    it('refuses stale or foreign candidates before preparing resources', async () => {
        const session = new DocumentSession(document());
        let called = false;
        await expect(
            applyDocumentEdit(
                { ...edit(session.document, 'Bad '), id: 'different' },
                () => session.document,
                () => {
                    called = true;
                },
                () => undefined,
            ),
        ).rejects.toBeInstanceOf(DocumentEditError);
        expect(called).toBe(false);
    });
});
