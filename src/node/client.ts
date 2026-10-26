import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { TaskError, type TaskErrorCode } from './tasks.js';

export interface TaskClientOptions {
    readonly path: string;
    readonly identity: string;
    readonly payload: unknown;
    readonly affinity?: string;
    readonly budgetMs?: number;
    readonly signal?: AbortSignal;
    readonly maxInputBytes?: number;
    readonly maxOutputBytes?: number;
}
export function callTaskService(options: TaskClientOptions): Promise<unknown> {
    const started = performance.now(),
        id = randomUUID();
    const budget = options.budgetMs ?? 5000;
    if (!Number.isSafeInteger(budget) || budget <= 0)
        return Promise.reject(new TaskError('invalid_request', 'Invalid task deadline'));
    if (options.signal?.aborted) return Promise.reject(new TaskError('cancelled', 'The task was cancelled'));
    let body: Buffer;
    try {
        body = Buffer.from(
            JSON.stringify({
                protocol: 1,
                id,
                identity: options.identity,
                budgetMs: budget,
                payload: options.payload,
                ...(options.affinity ? { affinity: options.affinity } : {}),
            }),
        );
        if (body.length > (options.maxInputBytes ?? 32 * 1024 * 1024)) throw new Error();
    } catch {
        return Promise.reject(new TaskError('invalid_request', 'The task input cannot be transferred'));
    }
    const remaining = Math.floor(budget - (performance.now() - started));
    if (remaining <= 0) return Promise.reject(new TaskError('timeout', 'The task exceeded its deadline'));
    return new Promise((resolve, reject) => {
        const socket = createConnection(options.path);
        let header = Buffer.alloc(0),
            size: number | undefined,
            received = 0,
            settled = false;
        const chunks: Buffer[] = [];
        const finish = (error?: unknown, result?: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', abort);
            socket.destroy();
            if (error) reject(error);
            else resolve(result);
        };
        const abort = () => finish(new TaskError('cancelled', 'The task was cancelled'));
        const timer = setTimeout(() => finish(new TaskError('timeout', 'The task exceeded its deadline')), remaining);
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
        socket.once('connect', () => {
            if (settled) return;
            const prefix = Buffer.alloc(4);
            prefix.writeUInt32BE(body.length);
            socket.write(Buffer.concat([prefix, body]));
        });
        socket.once('error', () => finish(new TaskError('worker_error', 'The task service is unavailable')));
        socket.once('close', () => finish(new TaskError('worker_error', 'The task service connection closed')));
        socket.on('data', (chunk: Buffer) => {
            if (size === undefined) {
                const remaining = 4 - header.length;
                header = Buffer.concat([header, chunk.subarray(0, remaining)]);
                chunk = chunk.subarray(remaining);
                if (header.length < 4) return;
                size = header.readUInt32BE(0);
                if (!size || size > (options.maxOutputBytes ?? 64 * 1024 * 1024))
                    return finish(new TaskError('worker_error', 'Invalid task result size'));
            }
            received += chunk.length;
            if (received > size) return finish(new TaskError('worker_error', 'Invalid task result frame'));
            chunks.push(chunk);
            if (received !== size) return;
            try {
                const reply = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
                if (!reply || reply.protocol !== 1 || reply.id !== id || typeof reply.ok !== 'boolean')
                    throw new Error('Invalid task response');
                if (!reply.ok && reply.error?.code === 'runtime_changed')
                    return finish(new TaskError('runtime_changed', 'The task runtime changed'));
                if (reply.identity !== options.identity) throw new Error('Invalid task runtime');
                if (!reply.ok)
                    return finish(
                        new TaskError(
                            (reply.error?.code ?? 'failed') as TaskErrorCode,
                            String(reply.error?.message ?? 'The task failed'),
                        ),
                    );
                finish(undefined, reply.result);
            } catch {
                finish(new TaskError('worker_error', 'Invalid task response'));
            }
        });
    });
}
