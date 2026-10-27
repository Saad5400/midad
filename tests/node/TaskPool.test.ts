// @vitest-environment node
import { TaskPool, type TaskPoolOptions } from '@saad5400/midad/node';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const pools: TaskPool[] = [];
afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.close()));
});
async function open(options: Partial<TaskPoolOptions> = {}) {
    const pool = new TaskPool({ worker: pathToFileURL(resolve('tests/node/worker.mjs')), workers: 1, ...options });
    pools.push(pool);
    await pool.ready();
    return pool;
}
type Result = { threadId: number; count: number; value: unknown; started: number; ended: number };
const run = (pool: TaskPool, input: unknown, options?: Parameters<TaskPool['run']>[1]) =>
    pool.run(input, options) as Promise<Result>;

it('reuses a ready worker across serial tasks', async () => {
    const pool = await open();
    const first = await run(pool, { value: 'first' });
    const second = await run(pool, { value: 'second' });
    expect(first.threadId).toBe(second.threadId);
    expect([first.count, second.count]).toEqual([1, 2]);
    expect(second.value).toBe('second');
});

it('executes two tasks concurrently without a single serial event-loop bottleneck', async () => {
    const pool = await open({ workers: 2 });
    const results = await Promise.all([run(pool, { delay: 150 }), run(pool, { delay: 150 })]);
    expect(results[0].threadId).not.toBe(results[1].threadId);
    expect(Math.max(...results.map((result) => result.started))).toBeLessThan(
        Math.min(...results.map((result) => result.ended)),
    );
});

it('snapshots queued input and retains FIFO order', async () => {
    const pool = await open();
    const first = run(pool, { delay: 80 });
    const input = { value: { text: 'original' } };
    const second = run(pool, input);
    const third = run(pool, { value: 'third' });
    input.value.text = 'mutated';
    const results = await Promise.all([first, second, third]);
    expect(results.map((result) => result.count)).toEqual([1, 2, 3]);
    expect(results[1].value).toEqual({ text: 'original' });
});

it('bounds queued tasks and recovers capacity after completion', async () => {
    const pool = await open({ maxQueue: 1 });
    const first = run(pool, { delay: 80 });
    const second = run(pool, { value: 'queued' });
    await expect(pool.run({ value: 'overflow' })).rejects.toMatchObject({ code: 'overloaded' });
    await Promise.all([first, second]);
    expect((await run(pool, { value: 'recovered' })).value).toBe('recovered');
});

it('expires queued work without killing the worker serving another task', async () => {
    const pool = await open();
    const first = run(pool, { delay: 100 });
    await expect(pool.run({ value: 'expired' }, { timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
    const accepted = await first;
    expect((await run(pool, { value: 'next' })).threadId).toBe(accepted.threadId);
});

it('includes queue time in the deadline', async () => {
    const pool = await open();
    const first = run(pool, { delay: 100 });
    const second = pool.run({ delay: 100 }, { timeoutMs: 140 });
    const rejected = expect(second).rejects.toMatchObject({ code: 'timeout' });
    await first;
    await rejected;
    expect((await run(pool, { value: 'next' })).value).toBe('next');
});

it('terminates timed-out CPU work before it can write a late result', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'midad-task-'));
    try {
        const pool = await open();
        const first = await run(pool, {});
        const file = join(directory, 'late');
        await expect(pool.run({ block: 250, file }, { timeoutMs: 30 })).rejects.toMatchObject({ code: 'timeout' });
        const next = await run(pool, { value: 'next' });
        expect(next.threadId).not.toBe(first.threadId);
        await new Promise((resolve) => setTimeout(resolve, 260));
        expect(existsSync(file)).toBe(false);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

it('cancels queued work without interrupting the active task', async () => {
    const pool = await open();
    const first = run(pool, { delay: 70 });
    const controller = new AbortController();
    const task = pool.run({ value: 'cancelled' }, { signal: controller.signal });
    const rejected = expect(task).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort();
    await rejected;
    const accepted = await first;
    expect((await run(pool, {})).threadId).toBe(accepted.threadId);
});

it('cancels active work and serves the next task in a fresh worker', async () => {
    const pool = await open();
    const first = await run(pool, {});
    const controller = new AbortController();
    const task = pool.run({ block: 300 }, { signal: controller.signal });
    const rejected = expect(task).rejects.toMatchObject({ code: 'cancelled' });
    const next = run(pool, { value: 'next' });
    controller.abort();
    await rejected;
    expect((await next).threadId).not.toBe(first.threadId);
});

it('rejects an already cancelled request without executing it', async () => {
    const pool = await open();
    await expect(pool.run({}, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'cancelled' });
    expect((await run(pool, {})).count).toBe(1);
});

it('recovers from a crashed worker while preserving queued tasks', async () => {
    const pool = await open();
    const rejected = expect(pool.run({ crash: true })).rejects.toMatchObject({ code: 'worker_error' });
    const next = run(pool, { value: 'survived' });
    await rejected;
    expect((await next).value).toBe('survived');
});

it('keeps the worker after a handled application failure', async () => {
    const pool = await open();
    const first = await run(pool, {});
    await expect(pool.run({ fail: true })).rejects.toMatchObject({ code: 'failed', message: 'Fixture task failed' });
    expect((await run(pool, {})).threadId).toBe(first.threadId);
});

it('handles a nontransferable result without hanging subsequent requests', async () => {
    const pool = await open();
    await expect(pool.run({ uncloneable: true })).rejects.toMatchObject({ code: 'failed' });
    expect((await run(pool, { value: 'next' })).value).toBe('next');
});

it('rejects an invalid worker reply and replaces only that worker', async () => {
    const pool = await open();
    await expect(pool.run({ wrongId: true })).rejects.toMatchObject({ code: 'worker_error' });
    expect((await run(pool, { value: 'next' })).value).toBe('next');
});

it('recycles workers after a bounded number of completed jobs', async () => {
    const pool = await open({ maxJobsPerWorker: 2 });
    const first = await run(pool, {});
    expect((await run(pool, {})).threadId).toBe(first.threadId);
    expect((await run(pool, {})).threadId).not.toBe(first.threadId);
});

it('bounds aggregate queued input bytes', async () => {
    const pool = await open({ maxQueueBytes: 100 });
    const first = run(pool, { delay: 70 });
    const second = run(pool, { value: 'x'.repeat(60) });
    await expect(pool.run({ value: 'x'.repeat(60) })).rejects.toMatchObject({ code: 'overloaded' });
    await expect(pool.run({ value: 'x'.repeat(101) })).rejects.toMatchObject({ code: 'overloaded' });
    await Promise.all([first, second]);
});

it.each([undefined, NaN, Infinity, { callback() {} }, new Map([['key', 'value']]), 1n])(
    'rejects non-JSON task input (%s)',
    async (payload) => {
        const pool = await open();
        await expect(pool.run(payload)).rejects.toMatchObject({ code: 'invalid_request' });
    },
);

it('closes active and queued requests, rejects future calls and releases all workers', async () => {
    const pool = await open();
    const first = expect(pool.run({ delay: 5000 })).rejects.toMatchObject({ code: 'closed' });
    const second = expect(pool.run({})).rejects.toMatchObject({ code: 'closed' });
    await pool.close();
    await Promise.all([first, second]);
    await pool.close();
    await expect(pool.run({})).rejects.toMatchObject({ code: 'closed' });
    await expect(pool.ready()).rejects.toMatchObject({ code: 'closed' });
    expect(pool.stats()).toEqual({ workers: 0, active: 0, queued: 0, queuedBytes: 0, closed: true });
});

it('bounds startup failures and rejects readiness instead of restarting forever', async () => {
    const pool = new TaskPool({
        worker: pathToFileURL(resolve('tests/node/worker.mjs')),
        workerData: { failStartup: true },
        workers: 1,
    });
    pools.push(pool);
    await expect(pool.ready()).rejects.toMatchObject({ code: 'worker_error' });
    expect(pool.stats().closed).toBe(true);
});

it('bounds stalled worker startup', async () => {
    const pool = new TaskPool({
        worker: pathToFileURL(resolve('tests/node/worker.mjs')),
        workerData: { bootMs: 200 },
        startupTimeoutMs: 30,
        workers: 1,
    });
    pools.push(pool);
    await expect(pool.ready()).rejects.toMatchObject({ code: 'worker_error' });
});

it('prefers an available worker holding the same document without serializing other work', async () => {
    const pool = await open({ workers: 2 });
    const a = run(pool, { delay: 80 }, { affinity: 'a' });
    const b = run(pool, {}, { affinity: 'b' });
    const [first, second] = await Promise.all([a, b]);
    expect(first.threadId).not.toBe(second.threadId);
    expect((await run(pool, {}, { affinity: 'b' })).threadId).toBe(second.threadId);
    expect((await run(pool, {}, { affinity: 'a' })).threadId).toBe(first.threadId);
});
