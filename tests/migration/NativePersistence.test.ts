import { DocumentSession, importDocument } from '@saad5400/midad/document';
import { VersionedDocumentSave, type SaveSnapshot } from '@saad5400/midad/persistence';
import { afterEach, describe, expect, it, vi } from 'vitest';

function session() {
    return new DocumentSession(
        importDocument(
            { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'عقد' }] }] },
            'contract',
        ),
    );
}
function edit(document: DocumentSession) {
    document.replace({
        nodeId: 'contract:root.0.0',
        from: 0,
        to: 0,
        text: 'نص ',
        expectedRevision: document.document.revision,
    });
    return document.document;
}

afterEach(() => vi.useRealTimers());
describe('native contract persistence', () => {
    it('saves the initial renderer migration without dropping the first text edit', async () => {
        const document = session(),
            revisions: number[] = [];
        const saver = new VersionedDocumentSave(
            10,
            -1,
            async (snapshot) => {
                revisions.push(snapshot.revision);
                return { version: 11 + revisions.length };
            },
            () => undefined,
        );
        saver.queue(document.document);
        await saver.flush();
        saver.queue(edit(document));
        await saver.flush();
        expect(revisions).toEqual([0, 1]);
        expect(saver.snapshot().dirty).toBe(false);
    });
    it('serializes saves and advances the base version before saving edits made during a request', async () => {
        const document = session();
        const calls: Array<{ revision: number; base: number }> = [];
        let finish!: (value: { version: number }) => void;
        let state: SaveSnapshot;
        const saver = new VersionedDocumentSave(
            10,
            0,
            async (snapshot, base) => {
                calls.push({ revision: snapshot.revision, base });
                if (calls.length === 1) return new Promise((resolve) => (finish = resolve));
                return { version: 12 };
            },
            (next) => (state = next),
        );
        saver.queue(edit(document));
        const save = saver.flush();
        saver.queue(edit(document));
        saver.queue(edit(document));
        expect(calls).toEqual([{ revision: 1, base: 10 }]);
        finish({ version: 11 });
        expect(await save).toBe(true);
        expect(calls).toEqual([
            { revision: 1, base: 10 },
            { revision: 3, base: 11 },
        ]);
        expect(state!).toEqual({ status: 'saved', version: 12, dirty: false });
        saver.dispose();
    });

    it('retains the latest unsaved revision after a failed request and retries without advancing its base', async () => {
        const document = session();
        const write = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ version: 11 });
        const saver = new VersionedDocumentSave(10, 0, write, () => undefined);
        saver.queue(edit(document));
        expect(await saver.flush()).toBe(false);
        expect(saver.snapshot()).toEqual({ status: 'error', version: 10, dirty: true });
        saver.queue(edit(document));
        expect(await saver.flush()).toBe(true);
        expect(write.mock.calls[1][0].revision).toBe(2);
        expect(write.mock.calls[1][1]).toBe(10);
        expect(saver.snapshot().dirty).toBe(false);
        saver.dispose();
    });

    it('stops on a version conflict and never silently overwrites the other revision', async () => {
        const document = session();
        const write = vi.fn().mockRejectedValue({ response: { status: 409 } });
        const saver = new VersionedDocumentSave(10, 0, write, () => undefined);
        saver.queue(edit(document));
        expect(await saver.flush()).toBe(false);
        saver.queue(edit(document));
        expect(await saver.flush()).toBe(false);
        expect(write).toHaveBeenCalledTimes(1);
        expect(saver.snapshot()).toEqual({ status: 'conflict', version: 10, dirty: true });
        saver.dispose();
    });

    it('debounces typing but saves within the maximum delay during continuous edits', async () => {
        vi.useFakeTimers();
        const document = session();
        const write = vi.fn().mockResolvedValue({ version: 11 });
        const saver = new VersionedDocumentSave(10, 0, write, () => undefined);
        for (let index = 0; index < 5; index++) {
            saver.queue(edit(document));
            await vi.advanceTimersByTimeAsync(1000);
        }
        expect(write).toHaveBeenCalledTimes(1);
        expect(write.mock.calls[0][0].revision).toBe(5);
        saver.dispose();
    });

    it('rejects missing concurrency tokens and preserves unsaved state for invalid acknowledgments', async () => {
        expect(() => new VersionedDocumentSave(0, 0, vi.fn(), vi.fn())).toThrow();
        const document = session();
        const saver = new VersionedDocumentSave(
            10,
            0,
            async () => ({ version: NaN }),
            () => undefined,
        );
        saver.queue(edit(document));
        expect(await saver.flush()).toBe(false);
        expect(saver.snapshot().dirty).toBe(true);
        saver.dispose();
    });

    it('cancels pending timers when leaving the editor', async () => {
        vi.useFakeTimers();
        const document = session();
        const write = vi.fn();
        const saver = new VersionedDocumentSave(10, 0, write, () => undefined);
        saver.queue(edit(document));
        saver.dispose();
        await vi.advanceTimersByTimeAsync(6000);
        expect(write).not.toHaveBeenCalled();
    });
});
