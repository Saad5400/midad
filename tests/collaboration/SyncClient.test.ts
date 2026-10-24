import {
    decodeSharedBytes,
    encodeSharedBytes,
    NativeSyncClient,
    SharedNativeDocument,
    type SyncEditor,
    type SyncTransport,
} from '@saad5400/midad/collaboration';
import { exportDocument, importDocument } from '@saad5400/midad/document';
import { blockText, replaceInlineText, textBlocks } from '@saad5400/midad/editing';
import { afterEach, describe, expect, it, vi } from 'vitest';

const clients: NativeSyncClient[] = [],
    models: SharedNativeDocument[] = [];
afterEach(() => {
    clients.splice(0).forEach((client) => client.destroy());
    models.splice(0).forEach((model) => model.destroy());
    vi.useRealTimers();
});
const document = () =>
    importDocument(
        {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Original العربية' }],
                },
            ],
        },
        'sync-test',
    );
function server() {
    let shared = SharedNativeDocument.create(document());
    models.push(shared);
    const requests = new Set<string>();
    let number = 1,
        writes = 0;
    const transport: SyncTransport = {
        read: async (input) => ({
            epoch: shared.epoch(),
            number,
            changed: input.since_number !== number,
            ...(input.vector && (!input.epoch || input.epoch === shared.epoch())
                ? {
                      update: encodeSharedBytes(shared.state(decodeSharedBytes(input.vector))),
                  }
                : { state: encodeSharedBytes(shared.state()) }),
            vector: encodeSharedBytes(shared.vector()),
            persisted: true,
        }),
        write: async (input) => {
            if (input.epoch !== shared.epoch())
                throw {
                    response: { status: 409, data: { reason: 'content_changed' } },
                };
            writes++;
            if (!requests.has(input.request_id)) {
                const before = JSON.stringify(exportDocument(shared.document()));
                shared.receive(decodeSharedBytes(input.update));
                if (JSON.stringify(exportDocument(shared.document())) !== before) number++;
                requests.add(input.request_id);
            }
            return {
                epoch: shared.epoch(),
                number,
                changed: true,
                update: encodeSharedBytes(shared.state(decodeSharedBytes(input.vector))),
                vector: encodeSharedBytes(shared.vector()),
            };
        },
    };
    return {
        get shared() {
            return shared;
        },
        transport,
        writes: () => writes,
        version: () => number,
        replace(text: string) {
            const source = document(),
                block = textBlocks(source.root)[0];
            shared = SharedNativeDocument.create(
                replaceInlineText(source, {
                    blockId: block.id,
                    from: 0,
                    to: blockText(block).length,
                    text,
                    expectedRevision: source.revision,
                }),
            );
            models.push(shared);
            number++;
        },
    };
}
function editor(transport: SyncTransport, writable = true) {
    let current = document(),
        previous = current,
        locked = false,
        busy = false,
        invalid = false;
    const adapter: SyncEditor = {
        initial: async (value) => {
            current = value;
        },
        prepare: async (value) => {
            if (invalid) throw new Error('Invalid glyph');
            return value;
        },
        preview: async () => undefined,
        lock: () => {
            if (busy || locked) return false;
            locked = true;
            return null;
        },
        unlock: () => {
            locked = false;
        },
        apply: async (value) => {
            current = value;
        },
        undoLocal: async () => {
            current = previous;
            invalid = false;
            client.queue(current);
        },
    };
    const client = new NativeSyncClient('sync-test', writable, transport, adapter, () => undefined, 60_000);
    clients.push(client);
    return {
        client,
        adapter,
        document: () => current,
        text: () => textBlocks(current.root).map(blockText).join('\n'),
        edit(from: number, to: number, text: string) {
            previous = current;
            const block = textBlocks(current.root)[0];
            current = replaceInlineText(current, {
                blockId: block.id,
                from,
                to,
                text,
                expectedRevision: current.revision,
            });
            client.queue(current);
        },
        busy(value: boolean) {
            busy = value;
        },
        invalid(value: boolean) {
            invalid = value;
        },
    };
}

describe('native synchronization client', () => {
    it('pauses automatic retries of a rejected draft and resumes after a real correction', async () => {
        vi.useFakeTimers();
        const backend = server();
        let rejected = true;
        const write = vi.fn(async (input: Parameters<SyncTransport['write']>[0]) => {
            if (rejected)
                throw {
                    response: { status: 422, data: { reason: 'invalid_content' } },
                };
            return backend.transport.write(input);
        });
        const a = editor({ ...backend.transport, write });
        await a.client.start();
        a.edit(0, 0, 'Rejected ');
        expect(await a.client.flush()).toBe(false);
        expect(a.client.state()).toMatchObject({
            status: 'error',
            dirty: true,
            canUndo: true,
        });
        await vi.advanceTimersByTimeAsync(180000);
        expect(write).toHaveBeenCalledTimes(1);
        expect(a.text()).toBe('Rejected Original العربية');
        rejected = false;
        a.edit(0, 9, 'Corrected ');
        await vi.advanceTimersByTimeAsync(350);
        expect(write).toHaveBeenCalledTimes(2);
        expect(write.mock.calls[1][0].request_id).not.toBe(write.mock.calls[0][0].request_id);
        expect(a.text()).toBe('Corrected Original العربية');
        expect(a.client.state()).toMatchObject({ status: 'saved', dirty: false });
    });
    it('keeps the rejected request identity for an explicit retry of the same draft', async () => {
        const backend = server();
        const write = vi.fn(async (input: Parameters<SyncTransport['write']>[0]) => {
            if (write.mock.calls.length === 1) throw { response: { status: 422 } };
            return backend.transport.write(input);
        });
        const a = editor({ ...backend.transport, write });
        await a.client.start();
        a.edit(0, 0, 'Retry ');
        expect(await a.client.flush()).toBe(false);
        expect(await a.client.flush()).toBe(true);
        expect(write.mock.calls[1][0]).toEqual(write.mock.calls[0][0]);
        expect(a.text()).toBe('Retry Original العربية');
    });
    it.each(['update', 'encoding', 'vector'] as const)(
        'recovers from malformed %s in a write acknowledgement without duplicating the accepted save',
        async (corruption) => {
            vi.useFakeTimers();
            const backend = server();
            const write = vi.fn(async (input: Parameters<SyncTransport['write']>[0]) => {
                const reply = await backend.transport.write(input);
                return write.mock.calls.length === 1
                    ? {
                          ...reply,
                          ...(corruption === 'vector'
                              ? { vector: encodeSharedBytes(Uint8Array.of(255)) }
                              : {
                                    update:
                                        corruption === 'encoding' ? 'invalid!' : encodeSharedBytes(Uint8Array.of(255)),
                                }),
                      }
                    : reply;
            });
            const a = editor({ ...backend.transport, write });
            await a.client.start();
            a.edit(0, 0, 'Mine ');
            expect(await a.client.flush()).toBe(false);
            expect(a.client.state()).toMatchObject({
                status: 'error',
                reason: 'invalid_shared_state',
                canUndo: true,
            });
            await vi.advanceTimersByTimeAsync(180000);
            expect(write).toHaveBeenCalledTimes(1);
            expect(await a.client.flush()).toBe(true);
            expect(write.mock.calls[1][0]).toEqual(write.mock.calls[0][0]);
            expect(backend.version()).toBe(2);
            expect(a.text()).toBe('Mine Original العربية');
            await a.client.undo();
            await a.client.flush();
            expect(a.text()).toBe('Original العربية');
        },
    );
    it('retains local undo after a malformed remote read and recovers the peer text', async () => {
        const backend = server();
        let corrupt = false;
        const a = editor({
            ...backend.transport,
            read: async (input) => {
                const reply = await backend.transport.read(input);
                return corrupt ? { ...reply, update: encodeSharedBytes(Uint8Array.of(255)) } : reply;
            },
        });
        await a.client.start();
        a.edit(0, 0, 'Mine ');
        await a.client.flush();
        const b = editor(backend.transport);
        await b.client.start();
        b.edit(b.text().length, b.text().length, ' Theirs');
        await b.client.flush();
        corrupt = true;
        expect(await a.client.flush()).toBe(false);
        expect(a.client.state().canUndo).toBe(true);
        await a.client.undo();
        expect(a.text()).toBe('Original العربية');
        corrupt = false;
        expect(await a.client.flush()).toBe(true);
        expect(a.text()).toBe('Original العربية Theirs');
        expect(a.client.state().canRedo).toBe(true);
    });
    it('sends a correction queued while a rejected write is still in flight', async () => {
        vi.useFakeTimers();
        const backend = server();
        let release!: () => void;
        const waiting = new Promise<void>((resolve) => (release = resolve));
        const write = vi.fn(async (input: Parameters<SyncTransport['write']>[0]) => {
            if (write.mock.calls.length === 1) {
                await waiting;
                throw { response: { status: 422 } };
            }
            return backend.transport.write(input);
        });
        const a = editor({ ...backend.transport, write });
        await a.client.start();
        a.edit(0, 0, 'Rejected ');
        const saving = a.client.flush();
        await vi.advanceTimersByTimeAsync(0);
        expect(write).toHaveBeenCalledTimes(1);
        a.edit(0, 9, 'Corrected ');
        await vi.advanceTimersByTimeAsync(350);
        release();
        expect(await saving).toBe(false);
        await vi.advanceTimersByTimeAsync(350);
        expect(write).toHaveBeenCalledTimes(2);
        expect(a.client.state()).toMatchObject({ status: 'saved', dirty: false });
        expect(a.text()).toBe('Corrected Original العربية');
    });
    it('waits for another edit when a rejected draft correction cannot be prepared', async () => {
        vi.useFakeTimers();
        const backend = server();
        const write = vi.fn(async () => {
            throw { response: { status: 422 } };
        });
        const a = editor({ ...backend.transport, write });
        await a.client.start();
        a.edit(0, 0, 'Rejected ');
        expect(await a.client.flush()).toBe(false);
        a.edit(0, 9, 'Invalid ');
        a.invalid(true);
        expect(await a.client.flush(false)).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        expect(write).toHaveBeenCalledTimes(1);
        expect(a.client.state()).toMatchObject({ status: 'error', dirty: true, canUndo: true });
    });
    it('does not retry when the same rejected content is queued again', async () => {
        vi.useFakeTimers();
        const backend = server();
        const write = vi.fn(async () => {
            throw { response: { status: 422 } };
        });
        const a = editor({ ...backend.transport, write });
        await a.client.start();
        a.edit(0, 0, 'Rejected ');
        expect(await a.client.flush()).toBe(false);
        a.client.queue(a.document());
        await vi.advanceTimersByTimeAsync(180000);
        expect(write).toHaveBeenCalledTimes(1);
        expect(a.client.state()).toMatchObject({
            status: 'error',
            dirty: true,
            canUndo: true,
        });
    });
    it('pauses a rejected read until an explicit retry without losing edit history', async () => {
        vi.useFakeTimers();
        const backend = server();
        let reject = false;
        const read = vi.fn(async (input: Parameters<SyncTransport['read']>[0]) => {
            if (reject) throw { response: { status: 422 } };
            return backend.transport.read(input);
        });
        const a = editor({ ...backend.transport, read });
        await a.client.start();
        a.edit(0, 0, 'Mine ');
        await a.client.flush();
        reject = true;
        expect(await a.client.flush()).toBe(false);
        expect(a.client.state()).toMatchObject({
            status: 'error',
            reason: 'invalid_request',
            dirty: false,
            canUndo: true,
        });
        await vi.advanceTimersByTimeAsync(180000);
        expect(read).toHaveBeenCalledTimes(2);
        reject = false;
        expect(await a.client.flush()).toBe(true);
        await a.client.undo();
        await a.client.flush();
        expect(a.text()).toBe('Original العربية');
    });
    it('retries applying a received peer edit after the editor fails once', async () => {
        const backend = server();
        const a = editor(backend.transport),
            b = editor(backend.transport);
        await a.client.start();
        await b.client.start();
        b.edit(0, 0, 'Theirs ');
        await b.client.flush();
        const apply = a.adapter.apply;
        let fail = true;
        a.adapter.apply = async (...input) => {
            if (fail) {
                fail = false;
                throw new Error('Paint failed');
            }
            return apply(...input);
        };
        expect(await a.client.flush()).toBe(false);
        expect(a.text()).toBe('Original العربية');
        expect(await a.client.flush()).toBe(true);
        expect(a.text()).toBe('Theirs Original العربية');
    });
    it('keeps a rejected local shared mutation editable and saves a later correction', async () => {
        const backend = server(),
            a = editor(backend.transport);
        await a.client.start();
        a.edit(0, 0, 'Saved ');
        expect(await a.client.flush()).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 550));
        const prepare = a.adapter.prepare;
        let reject = true;
        a.adapter.prepare = async (document) => {
            if (!reject) return prepare(document);
            let nested: import('@saad5400/midad/document').Json = true;
            for (let index = 0; index < 40; index++) nested = { nested };
            return {
                ...document,
                root: { ...document.root, attributes: { ...document.root.attributes, invalid: nested } },
            };
        };
        a.edit(0, 0, 'Rejected ');
        expect(await a.client.flush()).toBe(false);
        expect(a.client.state()).toMatchObject({
            status: 'error',
            reason: 'invalid_content',
            dirty: true,
            canUndo: true,
        });
        expect(a.text()).toBe('Rejected Saved Original العربية');
        expect(textBlocks(backend.shared.document().root).map(blockText).join('')).toBe('Saved Original العربية');
        reject = false;
        a.edit(0, 9, 'Corrected ');
        expect(await a.client.flush()).toBe(true);
        expect(a.text()).toBe('Corrected Saved Original العربية');
        await a.client.undo();
        await a.client.flush();
        expect(a.text()).toBe('Saved Original العربية');
    });
    it('persists an initial native revision immediately instead of waiting for the polling interval', async () => {
        vi.useFakeTimers();
        const backend = server();
        const a = editor({
            ...backend.transport,
            read: async (input) => ({
                ...(await backend.transport.read(input)),
                persisted: false,
            }),
        });
        await a.client.start();
        expect(a.client.state().status).toBe('pending');
        await vi.advanceTimersByTimeAsync(0);
        expect(backend.writes()).toBe(1);
        expect(a.client.state().status).toBe('saved');
        expect(a.client.state().dirty).toBe(false);
    });
    it('does not write an already persisted initial snapshot', async () => {
        vi.useFakeTimers();
        const backend = server(),
            a = editor(backend.transport);
        await a.client.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(backend.writes()).toBe(0);
        expect(a.client.state().status).toBe('saved');
    });
    it('does not persist an initial revision for a read-only client', async () => {
        vi.useFakeTimers();
        const backend = server();
        const a = editor(
            {
                ...backend.transport,
                read: async (input) => ({
                    ...(await backend.transport.read(input)),
                    persisted: false,
                }),
            },
            false,
        );
        await a.client.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(backend.writes()).toBe(0);
        expect(a.client.state().dirty).toBe(false);
    });
    it('reports an invalid local projection as an error instead of a network outage', async () => {
        const backend = server();
        const current = editor(backend.transport);
        await current.client.start();
        const failure = new Error('Invalid projection');
        current.adapter.preview = vi.fn().mockRejectedValue(failure);
        const report = (current.adapter.failure = vi.fn());
        backend.replace('Remote change');
        expect(await current.client.flush()).toBe(false);
        expect(current.client.state()).toMatchObject({
            status: 'error',
            reason: 'invalid_shared_state',
        });
        expect(report).toHaveBeenCalledWith(failure);
    });

    it('advances its own acknowledged structural base while typing continues during a save', async () => {
        const backend = server();
        let release!: () => void,
            entered!: () => void,
            barrier = 0;
        const waiting = new Promise<void>((resolve) => (release = resolve));
        const started = new Promise<void>((resolve) => (entered = resolve));
        const bases: number[] = [];
        let first = true;
        const a = editor({
            ...backend.transport,
            write: async (input) => {
                bases.push(input.base_number);
                if (input.base_number < barrier)
                    throw {
                        response: { status: 409, data: { reason: 'content_changed' } },
                    };
                const reply = await backend.transport.write(input);
                if (first) {
                    first = false;
                    barrier = reply.number;
                    entered();
                    await waiting;
                }
                return reply;
            },
        });
        await a.client.start();
        const before = a.document();
        const extra = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        attrs: { nativeId: 'new-paragraph' },
                        content: [{ type: 'text', text: 'Added paragraph' }],
                    },
                ],
            },
            'sync-test',
        ).root.children![0];
        const structural = {
            ...before,
            revision: before.revision + 1,
            root: { ...before.root, children: [...before.root.children!, extra] },
        };
        await a.adapter.apply(structural, null);
        a.client.queue(structural);
        const flight = a.client.flush();
        await started;
        a.edit(0, 0, 'Continued ');
        release();
        expect(await flight).toBe(true);
        expect(bases).toEqual([1, 2]);
        expect(a.client.state()).toMatchObject({ status: 'saved', dirty: false });
        expect(textBlocks(backend.shared.document().root).map(blockText)).toEqual([
            'Continued Original العربية',
            'Added paragraph',
        ]);
    });
    it('adopts a replacement snapshot for a clean viewer after a review decision', async () => {
        const backend = server(),
            viewer = editor(backend.transport, false);
        await viewer.client.start();
        backend.replace('Accepted review wording العربية');
        expect(await viewer.client.flush()).toBe(true);
        expect(viewer.text()).toBe('Accepted review wording العربية');
        expect(viewer.client.state().version).toBe(backend.version());
        expect(viewer.client.state().status).toBe('saved');
        expect(backend.writes()).toBe(0);
    });
    it('clears obsolete undo history when a clean writer adopts an external replacement', async () => {
        const backend = server(),
            writer = editor(backend.transport);
        await writer.client.start();
        writer.edit(0, 0, 'Mine ');
        await writer.client.flush();
        expect(writer.client.state().canUndo).toBe(true);
        backend.replace('External replacement');
        await writer.client.flush();
        expect(writer.text()).toBe('External replacement');
        expect(writer.client.state().canUndo).toBe(false);
    });
    it('preserves typing entered while a replacement reply is in flight and asks for conflict recovery', async () => {
        const backend = server();
        let release!: () => void, entered!: () => void;
        const waiting = new Promise<void>((resolve) => (release = resolve)),
            started = new Promise<void>((resolve) => (entered = resolve));
        let hold = false;
        const writer = editor({
            ...backend.transport,
            read: async (input) => {
                const reply = await backend.transport.read(input);
                if (hold) {
                    entered();
                    await waiting;
                }
                return reply;
            },
        });
        await writer.client.start();
        backend.replace('Accepted review wording');
        hold = true;
        const flight = writer.client.flush();
        await started;
        writer.edit(0, 0, 'Unsaved ');
        release();
        expect(await flight).toBe(false);
        expect(writer.text()).toBe('Unsaved Original العربية');
        expect(writer.client.state().status).toBe('conflict');
        expect(writer.client.state().dirty).toBe(true);
        expect(blockText(textBlocks(backend.shared.document().root)[0])).toBe('Accepted review wording');
    });
    it('waits for a pointer gesture before replacing the visible document', async () => {
        const backend = server(),
            viewer = editor(backend.transport, false);
        await viewer.client.start();
        backend.replace('New review content');
        viewer.busy(true);
        const flight = viewer.client.flush();
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(viewer.text()).toBe('Original العربية');
        viewer.busy(false);
        expect(await flight).toBe(true);
        expect(viewer.text()).toBe('New review content');
    });
    it('fetches a complete replacement when an older transport returns only its epoch', async () => {
        const backend = server(),
            viewer = editor(
                {
                    ...backend.transport,
                    read: async (input) => {
                        const reply = await backend.transport.read(input);
                        return input.epoch ? { epoch: reply.epoch, number: reply.number, changed: true } : reply;
                    },
                },
                false,
            );
        await viewer.client.start();
        backend.replace('Fresh content');
        expect(await viewer.client.flush()).toBe(true);
        expect(viewer.text()).toBe('Fresh content');
    });
    it('locks a stale authoring page when the contract becomes read only', async () => {
        const backend = server();
        let writable = true;
        const writer = editor({
            ...backend.transport,
            read: async (input) => ({
                ...(await backend.transport.read(input)),
                writable,
            }),
        });
        await writer.client.start();
        writable = false;
        expect(await writer.client.flush()).toBe(false);
        expect(writer.client.state().status).toBe('forbidden');
        writer.edit(0, 0, 'Blocked ');
        expect(writer.client.state().dirty).toBe(false);
    });
    it('persists initial editor normalization once and leaves readers unable to publish it', async () => {
        const backend = server(),
            writer = editor(backend.transport),
            reader = editor(backend.transport, false);
        for (const instance of [writer, reader]) {
            const initial = instance.adapter.initial;
            instance.adapter.initial = async (document) => {
                await initial(document);
                return {
                    ...document,
                    root: {
                        ...document.root,
                        attributes: { ...document.root.attributes, normalized: true },
                    },
                };
            };
        }
        await reader.client.start();
        expect(reader.client.state().dirty).toBe(false);
        expect(backend.writes()).toBe(0);
        await writer.client.start();
        expect(writer.client.state().dirty).toBe(true);
        expect(writer.client.state().canUndo).toBe(false);
        await writer.client.flush();
        expect(writer.client.state().canUndo).toBe(false);
        expect(backend.shared.document().root.attributes?.normalized).toBe(true);
        const again = editor(backend.transport);
        const initial = again.adapter.initial;
        again.adapter.initial = async (document) => {
            await initial(document);
            return {
                ...document,
                root: {
                    ...document.root,
                    attributes: { ...document.root.attributes, normalized: true },
                },
            };
        };
        await again.client.start();
        expect(again.client.state().dirty).toBe(false);
        expect(backend.writes()).toBe(1);
    });
    it('merges two editing sessions and advances their saved version', async () => {
        const backend = server(),
            a = editor(backend.transport),
            b = editor(backend.transport);
        await a.client.start();
        await b.client.start();
        a.edit(0, 0, 'First ');
        b.edit(b.text().length, b.text().length, ' Last');
        expect(await a.client.flush()).toBe(true);
        expect(await b.client.flush()).toBe(true);
        await a.client.flush();
        expect(a.text()).toBe('First Original العربية Last');
        expect(b.text()).toBe(a.text());
        expect(a.client.state().dirty).toBe(false);
        expect(b.client.state().version).toBe(backend.version());
    });
    it('retains new keystrokes entered while a save reply is in flight', async () => {
        const backend = server();
        let release!: () => void, entered!: () => void;
        const waiting = new Promise<void>((resolve) => (release = resolve)),
            started = new Promise<void>((resolve) => (entered = resolve));
        let first = true;
        const transport: SyncTransport = {
            ...backend.transport,
            write: async (input) => {
                const reply = await backend.transport.write(input);
                if (first) {
                    first = false;
                    entered();
                    await waiting;
                }
                return reply;
            },
        };
        const a = editor(transport),
            b = editor(backend.transport);
        await a.client.start();
        await b.client.start();
        a.edit(0, 0, 'A ');
        const flight = a.client.flush();
        await started;
        a.edit(a.text().length, a.text().length, ' continued');
        b.edit(0, 0, 'B ');
        await b.client.flush();
        release();
        await flight;
        await b.client.flush();
        expect(a.text()).toContain('A ');
        expect(a.text()).toContain('B ');
        expect(a.text()).toContain(' continued');
        expect(b.text()).toBe(a.text());
        expect(a.client.state().dirty).toBe(false);
    });
    it('retries an acknowledged write after a lost response without duplicating it', async () => {
        const backend = server();
        let lost = true;
        const transport: SyncTransport = {
            ...backend.transport,
            write: async (input) => {
                const reply = await backend.transport.write(input);
                if (lost) {
                    lost = false;
                    throw new Error('Connection lost after commit');
                }
                return reply;
            },
        };
        const a = editor(transport);
        await a.client.start();
        a.edit(0, 0, 'Once ');
        expect(await a.client.flush()).toBe(false);
        expect(a.client.state().status).toBe('offline');
        expect(await a.client.flush()).toBe(true);
        expect(a.text()).toBe('Once Original العربية');
        expect(backend.version()).toBe(2);
        expect(backend.writes()).toBe(2);
    });
    it('keeps offline edits and merges another authors saved changes after reconnecting', async () => {
        const backend = server();
        let online = true;
        const a = editor({
            ...backend.transport,
            write: async (input) => {
                if (!online) throw new Error('Offline');
                return backend.transport.write(input);
            },
        });
        const b = editor(backend.transport);
        await a.client.start();
        await b.client.start();
        online = false;
        a.edit(0, 0, 'Offline ');
        expect(await a.client.flush()).toBe(false);
        b.edit(b.text().length, b.text().length, ' Peer');
        await b.client.flush();
        online = true;
        await a.client.flush();
        await b.client.flush();
        expect(a.text()).toBe('Offline Original العربية Peer');
        expect(b.text()).toBe(a.text());
    });
    it('uses shared undo without reverting another authors work', async () => {
        const backend = server(),
            a = editor(backend.transport),
            b = editor(backend.transport);
        await a.client.start();
        await b.client.start();
        a.edit(0, 0, 'Mine ');
        await a.client.flush();
        b.edit(b.text().length, b.text().length, ' Theirs');
        await b.client.flush();
        await a.client.flush();
        await a.client.undo();
        await a.client.flush();
        await b.client.flush();
        expect(a.text()).toBe('Original العربية Theirs');
        expect(b.text()).toBe(a.text());
    });
    it('performs undo and redo from an active input queue without permitting remote locks', async () => {
        const backend = server(),
            a = editor(backend.transport);
        await a.client.start();
        a.edit(0, 0, 'Mine ');
        await a.client.flush();
        const lock = a.adapter.lock.bind(a.adapter);
        a.adapter.lock = (purpose) => (purpose === 'history' ? lock() : false);
        expect(a.adapter.lock()).toBe(false);
        await a.client.undo();
        expect(a.text()).toBe('Original العربية');
        await a.client.flush();
        await a.client.redo();
        expect(a.text()).toBe('Mine Original العربية');
        expect(a.adapter.lock()).toBe(false);
    });
    it('lets readers receive changes without publishing edits', async () => {
        const backend = server(),
            writer = editor(backend.transport),
            reader = editor(backend.transport, false);
        await writer.client.start();
        await reader.client.start();
        writer.edit(0, 0, 'Shared ');
        await writer.client.flush();
        await reader.client.flush();
        await reader.client.undo();
        expect(reader.text()).toBe(writer.text());
        expect(backend.writes()).toBe(1);
        expect(reader.client.state().canUndo).toBe(false);
    });
    it('keeps invalid local content recoverable through local undo', async () => {
        const backend = server(),
            a = editor(backend.transport);
        await a.client.start();
        a.edit(0, 0, 'Invalid ');
        a.invalid(true);
        expect(await a.client.flush()).toBe(false);
        expect(a.client.state().reason).toBe('invalid_content');
        expect(backend.writes()).toBe(0);
        await a.client.undo();
        expect(await a.client.flush()).toBe(true);
        expect(a.text()).toBe('Original العربية');
    });
    it('waits for a composition or pointer gesture before applying remote edits', async () => {
        const backend = server(),
            a = editor(backend.transport),
            b = editor(backend.transport);
        await a.client.start();
        await b.client.start();
        b.edit(0, 0, 'Peer ');
        await b.client.flush();
        a.busy(true);
        const flight = a.client.flush();
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(a.text()).toBe('Original العربية');
        a.busy(false);
        await flight;
        expect(a.text()).toBe('Peer Original العربية');
    });
    it('does not trust another users reused presence client id as its own permissions', async () => {
        const backend = server();
        const a = editor({
            ...backend.transport,
            presence: async (input) => ({
                self: 'own',
                peers: [
                    {
                        client_id: input.client_id,
                        user: 'other',
                        name: 'Other viewer',
                        writable: false,
                        color: '#2563eb',
                        anchor: null,
                        focus: null,
                    },
                    {
                        client_id: input.client_id,
                        user: 'own',
                        name: 'Me',
                        writable: true,
                        color: '#2563eb',
                        anchor: null,
                        focus: null,
                    },
                ],
            }),
        });
        await a.client.start();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(a.client.state().status).toBe('saved');
        expect(a.client.state().peers.map((peer) => peer.name)).toEqual(['Other viewer']);
    });
    it('publishes selection changes without exposing unacknowledged local anchors', async () => {
        vi.useFakeTimers();
        const backend = server();
        const presence = vi.fn(async (_input: Parameters<NonNullable<SyncTransport['presence']>>[0]) => ({
            peers: [],
        }));
        const a = editor({ ...backend.transport, presence });
        a.adapter.selection = () => {
            const block = textBlocks(a.document().root)[0];
            return {
                anchor: { blockId: block.id, offset: 0 },
                focus: { blockId: block.id, offset: 1 },
            };
        };
        await a.client.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(presence).toHaveBeenCalledTimes(1);
        expect(presence.mock.calls[0][0].anchor).not.toBeNull();
        await vi.advanceTimersByTimeAsync(250);
        expect(presence).toHaveBeenCalledTimes(1);
        a.edit(0, 0, 'Local ');
        await vi.advanceTimersByTimeAsync(250);
        expect(presence).toHaveBeenCalledTimes(2);
        expect(presence.mock.calls[1][0]).toMatchObject({
            anchor: null,
            focus: null,
        });
        await a.client.flush();
        await vi.advanceTimersByTimeAsync(250);
        expect(presence).toHaveBeenCalledTimes(3);
        expect(presence.mock.calls[2][0].anchor).not.toBeNull();
    });

    it('leaves presence and ignores a pending presence response after disposal', async () => {
        vi.useFakeTimers();
        const backend = server();
        let release!: (value: { peers: [] }) => void;
        const presence = vi.fn(
            (_input: Parameters<NonNullable<SyncTransport['presence']>>[0]) =>
                new Promise<{ peers: [] }>((resolve) => (release = resolve)),
        );
        const leave = vi.fn(async () => undefined);
        const a = editor({ ...backend.transport, presence, leave });
        await a.client.start();
        expect(presence).toHaveBeenCalledTimes(1);
        const before = a.client.state();
        a.client.destroy();
        expect(leave).toHaveBeenCalledWith(presence.mock.calls[0][0].client_id);
        release({ peers: [] });
        await vi.advanceTimersByTimeAsync(6000);
        expect(presence).toHaveBeenCalledTimes(1);
        expect(a.client.state()).toEqual(before);
    });

    it('undoes immediately while the save request is still in flight', async () => {
        const backend = server();
        let release!: () => void, entered!: () => void;
        const waiting = new Promise<void>((resolve) => (release = resolve)),
            started = new Promise<void>((resolve) => (entered = resolve));
        let first = true;
        const a = editor({
            ...backend.transport,
            write: async (input) => {
                const reply = await backend.transport.write(input);
                if (first) {
                    first = false;
                    entered();
                    await waiting;
                }
                return reply;
            },
        });
        await a.client.start();
        a.edit(0, 0, 'Mine ');
        const flight = a.client.flush();
        await started;
        const began = performance.now();
        await a.client.undo();
        expect(a.text()).toBe('Original العربية');
        expect(performance.now() - began).toBeLessThan(200);
        release();
        await flight;
        expect(a.client.state().dirty).toBe(false);
        expect(textBlocks(backend.shared.document().root).map(blockText).join('')).toBe('Original العربية');
    });
    it('returns within five seconds after a lost acknowledgement and retries without duplicating text', async () => {
        vi.useFakeTimers();
        const backend = server();
        let first = true;
        const a = editor({
            ...backend.transport,
            write: async (input) => {
                const reply = await backend.transport.write(input);
                if (first) {
                    first = false;
                    return new Promise(() => undefined);
                }
                return reply;
            },
        });
        await a.client.start();
        a.edit(0, 0, 'Once ');
        const flight = a.client.flush();
        await vi.advanceTimersByTimeAsync(4999);
        expect(a.client.state().status).toBe('saving');
        await vi.advanceTimersByTimeAsync(1);
        expect(await flight).toBe(false);
        expect(a.client.state().dirty).toBe(true);
        expect(a.text()).toBe('Once Original العربية');
        expect(await a.client.flush()).toBe(true);
        expect(backend.version()).toBe(2);
        expect(a.text()).toBe('Once Original العربية');
    });
    it('retains remote changes when asset preparation times out and applies them on retry', async () => {
        vi.useFakeTimers();
        const backend = server(),
            a = editor(backend.transport),
            b = editor(backend.transport);
        await a.client.start();
        await b.client.start();
        b.edit(0, 0, 'Remote ');
        await b.client.flush();
        a.adapter.preview = () => new Promise(() => undefined);
        const flight = a.client.flush();
        await vi.advanceTimersByTimeAsync(5000);
        expect(await flight).toBe(false);
        expect(a.text()).toBe('Original العربية');
        a.adapter.preview = async () => undefined;
        expect(await a.client.flush()).toBe(true);
        expect(a.text()).toBe('Remote Original العربية');
    });
});
