// @vitest-environment node
import { callTaskService, TaskPool, TaskService, type TaskServiceOptions } from '@saad5400/midad/node';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function open(options: Partial<Omit<TaskServiceOptions, 'pool' | 'path' | 'identity'>> = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'midad-service-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const pool = new TaskPool({ worker: pathToFileURL(resolve('tests/node/worker.mjs')), workers: 1 });
    cleanups.push(() => pool.close());
    const path = join(directory, 'worker.sock');
    const service = await TaskService.open({ path, identity: 'build-a', pool, ...options });
    cleanups.push(() => service.close());
    return { directory, path, pool, service };
}
function frame(value: unknown): Buffer {
    const body = Buffer.from(JSON.stringify(value));
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(body.length);
    return Buffer.concat([prefix, body]);
}
const request = (payload: unknown, extra = {}) => ({
    protocol: 1,
    id: 'request',
    identity: 'build-a',
    budgetMs: 4000,
    payload,
    ...extra,
});
function exchange(path: string, bytes: Buffer | Buffer[]): Promise<any> {
    return new Promise((resolve, reject) => {
        const socket = createConnection(path);
        const chunks: Buffer[] = [];
        const timeout = setTimeout(() => socket.destroy(new Error('Client deadline')), 5000);
        let settled = false;
        const finish = (error?: Error, value?: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            socket.destroy();
            if (error) reject(error);
            else resolve(value);
        };
        socket.on('error', (error) => finish(error));
        socket.on('close', () => finish(new Error('Connection closed')));
        socket.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
            const body = Buffer.concat(chunks);
            if (body.length >= 4 && body.length === body.readUInt32BE(0) + 4)
                finish(undefined, JSON.parse(body.subarray(4).toString()));
        });
        socket.once('connect', async () => {
            for (const part of Array.isArray(bytes) ? bytes : [bytes]) {
                socket.write(part);
                await new Promise((resolve) => setTimeout(resolve, 2));
            }
        });
    });
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function connected(path: string): Promise<Socket> {
    const socket = createConnection(path);
    cleanups.push(async () => {
        socket.destroy();
    });
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
    });
    return socket;
}

it('serves framed JSON requests over a private Unix socket with a reused worker', async () => {
    const { path } = await open();
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const first = await exchange(path, frame(request({ value: 'العربية' })));
    const second = await exchange(path, frame(request({ value: 'next' }, { id: 'second' })));
    expect(first).toMatchObject({
        protocol: 1,
        id: 'request',
        identity: 'build-a',
        ok: true,
        result: { value: 'العربية' },
    });
    expect(second.result.threadId).toBe(first.result.threadId);
    expect(second.result.count).toBe(2);
});

it('accepts fragmented length headers and UTF-8 bodies', async () => {
    const { path } = await open();
    const bytes = frame(request({ value: 'العربية' }));
    const result = await exchange(path, [
        bytes.subarray(0, 1),
        bytes.subarray(1, 3),
        bytes.subarray(3, 55),
        bytes.subarray(55),
    ]);
    expect(result.result.value).toBe('العربية');
});

it('rejects stale build identities before executing work', async () => {
    const { path } = await open();
    const result = await exchange(path, frame(request({ crash: true }, { identity: 'build-old' })));
    expect(result).toMatchObject({ ok: false, error: { code: 'runtime_changed' } });
    expect((await exchange(path, frame(request({})))).result.count).toBe(1);
});

it.each([{ protocol: 2 }, { id: '' }, { budgetMs: 0 }, { budgetMs: 1.5 }, { identity: null }])(
    'rejects malformed request metadata %s',
    async (extra) => {
        const { path } = await open();
        const result = await exchange(path, frame(request({}, extra)));
        expect(result).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    },
);

it('rejects malformed JSON and invalid UTF-8 without losing the service', async () => {
    const { path } = await open();
    for (const body of [Buffer.from('{broken'), Buffer.from([0xff])]) {
        const header = Buffer.alloc(4);
        header.writeUInt32BE(body.length);
        expect(await exchange(path, Buffer.concat([header, body]))).toMatchObject({
            ok: false,
            error: { code: 'invalid_request' },
        });
    }
    expect((await exchange(path, frame(request({ value: 'healthy' })))).result.value).toBe('healthy');
});

it('rejects oversized frames and extra request bytes', async () => {
    const { path } = await open({ maxInputBytes: 256 });
    await expect(exchange(path, frame(request({ value: 'x'.repeat(300) })))).rejects.toThrow();
    await expect(exchange(path, Buffer.concat([frame(request({})), Buffer.from('extra')]))).rejects.toThrow();
    expect((await exchange(path, frame(request({})))).ok).toBe(true);
});

it('returns a bounded failure for an oversized result', async () => {
    const { path } = await open({ maxOutputBytes: 300 });
    expect(await exchange(path, frame(request({ value: 'x'.repeat(1000) })))).toMatchObject({
        ok: false,
        error: { code: 'failed' },
    });
});

it('enforces the submitted deadline and recovers the worker for the next request', async () => {
    const { path } = await open();
    expect(await exchange(path, frame(request({ block: 300 }, { budgetMs: 30 })))).toMatchObject({
        ok: false,
        error: { code: 'timeout' },
    });
    expect((await exchange(path, frame(request({ value: 'next' })))).result.value).toBe('next');
});

it('aborts active work when its client disconnects', async () => {
    const { path, pool } = await open();
    const first = await exchange(path, frame(request({})));
    const socket = await connected(path);
    socket.write(frame(request({ block: 300 })));
    for (let attempt = 0; !pool.stats().active && attempt < 100; attempt++) await pause(5);
    expect(pool.stats().active).toBe(1);
    socket.destroy();
    for (let attempt = 0; pool.stats().active && attempt < 100; attempt++) await pause(5);
    const next = await exchange(path, frame(request({})));
    expect(next.result.threadId).not.toBe(first.result.threadId);
});

it('releases reserved input bytes when an incomplete client disconnects', async () => {
    const { path } = await open({ maxPendingBytes: 256 });
    const socket = await connected(path);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(220);
    socket.write(header);
    await pause(10);
    await expect(exchange(path, frame(request({})))).rejects.toThrow();
    socket.destroy();
    await pause(10);
    expect((await exchange(path, frame(request({})))).ok).toBe(true);
});

it('caps simultaneous clients and expires stalled connections', async () => {
    const { path } = await open({ maxClients: 1, timeoutMs: 100 });
    await connected(path);
    await expect(exchange(path, frame(request({})))).rejects.toThrow();
    await pause(120);
    expect((await exchange(path, frame(request({})))).ok).toBe(true);
});

it('preserves an existing socket-path file instead of unlinking it', async () => {
    const { directory, pool } = await open();
    const path = join(directory, 'unrelated');
    await writeFile(path, 'keep');
    await expect(TaskService.open({ path, pool, identity: 'build-a' })).rejects.toThrow('already exists');
    expect(await readFile(path, 'utf8')).toBe('keep');
});

it('refuses a publicly accessible parent directory', async () => {
    const { directory, pool } = await open();
    await chmod(directory, 0o755);
    await expect(TaskService.open({ path: join(directory, 'other.sock'), pool, identity: 'build-a' })).rejects.toThrow(
        'private directory',
    );
    await chmod(directory, 0o700);
});

it('closes active connections and permits an explicit restart at the same path', async () => {
    const { path, pool, service } = await open();
    const socket = await connected(path);
    const closed = new Promise((resolve) => socket.once('close', resolve));
    await service.close();
    await closed;
    await service.close();
    const restarted = await TaskService.open({ path, pool, identity: 'build-b' });
    cleanups.push(() => restarted.close());
    expect(await exchange(path, frame(request({}, { identity: 'build-b' })))).toMatchObject({ ok: true });
});

it('exposes a deadline-bound client and preserves runtime and application errors', async () => {
    const { path } = await open();
    expect(await callTaskService({ path, identity: 'build-a', payload: { value: 'client' } })).toMatchObject({
        value: 'client',
    });
    await expect(callTaskService({ path, identity: 'old', payload: {} })).rejects.toMatchObject({
        code: 'runtime_changed',
    });
    await expect(callTaskService({ path, identity: 'build-a', payload: { fail: true } })).rejects.toMatchObject({
        code: 'failed',
    });
    await expect(
        callTaskService({ path, identity: 'build-a', payload: { block: 300 }, budgetMs: 20 }),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(await callTaskService({ path, identity: 'build-a', payload: { value: 'recovered' } })).toMatchObject({
        value: 'recovered',
    });
});

it('cancels client work and bounds unavailable endpoints and input/output sizes', async () => {
    const { path, directory } = await open();
    await expect(
        callTaskService({ path, identity: 'build-a', payload: {}, signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    await expect(
        callTaskService({ path: join(directory, 'missing'), identity: 'build-a', payload: {} }),
    ).rejects.toMatchObject({ code: 'worker_error' });
    await expect(
        callTaskService({ path, identity: 'build-a', payload: { value: 'large' }, maxInputBytes: 10 }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
        callTaskService({ path, identity: 'build-a', payload: { value: 'large' }, maxOutputBytes: 10 }),
    ).rejects.toMatchObject({ code: 'worker_error' });
});
