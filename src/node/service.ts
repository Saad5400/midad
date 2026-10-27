import { chmod, lstat, stat } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';
import { TaskError, type TaskPool } from './tasks.js';

export interface TaskServiceOptions {
    readonly path: string;
    readonly identity: string;
    readonly pool: TaskPool;
    readonly timeoutMs?: number;
    readonly maxClients?: number;
    readonly maxInputBytes?: number;
    readonly maxOutputBytes?: number;
    readonly maxPendingBytes?: number;
}
interface Request {
    protocol: 1;
    id: string;
    identity: string;
    budgetMs: number;
    payload: unknown;
    affinity?: string;
}
export class TaskService {
    private readonly server: Server;
    private readonly clients = new Set<Socket>();
    private pendingBytes = 0;
    private closed = false;
    private closing?: Promise<void>;
    private readonly timeout: number;
    private readonly maxClients: number;
    private readonly maxInput: number;
    private readonly maxOutput: number;
    private readonly maxPending: number;

    private constructor(private readonly options: TaskServiceOptions) {
        const positive = (value: number): number => {
            if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid task service limit');
            return value;
        };
        this.timeout = positive(options.timeoutMs ?? 5000);
        this.maxClients = positive(options.maxClients ?? 16);
        this.maxInput = positive(options.maxInputBytes ?? 32 * 1024 * 1024);
        this.maxOutput = positive(options.maxOutputBytes ?? 64 * 1024 * 1024);
        this.maxPending = positive(options.maxPendingBytes ?? 64 * 1024 * 1024);
        if (!options.identity || options.identity.length > 255) throw new Error('A runtime identity is required');
        this.server = createServer((socket) => this.accept(socket));
    }

    static async open(options: TaskServiceOptions): Promise<TaskService> {
        await options.pool.ready();
        const directory = await stat(dirname(options.path));
        if (
            !directory.isDirectory() ||
            (directory.mode & 0o077) !== 0 ||
            (process.getuid && directory.uid !== process.getuid())
        )
            throw new Error('Task services require a private directory owned by the current user');
        try {
            await lstat(options.path);
            throw new Error('The task socket path already exists');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        const service = new TaskService(options);
        try {
            await new Promise<void>((resolve, reject) => {
                service.server.once('error', reject);
                service.server.listen(options.path, () => {
                    service.server.removeListener('error', reject);
                    resolve();
                });
            });
            await chmod(options.path, 0o600);
            return service;
        } catch (error) {
            await service.close();
            throw error;
        }
    }

    close(): Promise<void> {
        if (this.closing) return this.closing;
        this.closed = true;
        for (const socket of this.clients) socket.destroy();
        this.closing = new Promise((resolve) => this.server.close(() => resolve()));
        return this.closing;
    }

    private accept(socket: Socket): void {
        if (this.closed || this.clients.size >= this.maxClients) {
            socket.destroy();
            return;
        }
        this.clients.add(socket);
        const controller = new AbortController();
        const started = performance.now();
        let header = Buffer.alloc(0),
            size: number | undefined,
            received = 0;
        let reservation = 0,
            accepted = false,
            replied = false;
        const chunks: Buffer[] = [];
        const release = () => {
            this.pendingBytes -= reservation;
            reservation = 0;
            chunks.length = 0;
        };
        const timer = setTimeout(() => {
            controller.abort();
            socket.destroy();
        }, this.timeout);
        socket.once('close', () => {
            clearTimeout(timer);
            release();
            controller.abort();
            this.clients.delete(socket);
        });
        socket.on('error', () => {});
        const respond = (id: string, result?: unknown, error?: { code: string; message: string }) => {
            if (replied || socket.destroyed) return;
            replied = true;
            let body: Buffer;
            try {
                body = Buffer.from(
                    JSON.stringify({
                        protocol: 1,
                        id,
                        identity: this.options.identity,
                        ok: !error,
                        ...(error ? { error } : { result: result ?? null }),
                    }),
                );
                if (body.length > this.maxOutput) throw new Error('The task result is too large');
            } catch {
                body = Buffer.from(
                    JSON.stringify({
                        protocol: 1,
                        id,
                        identity: this.options.identity,
                        ok: false,
                        error: { code: 'failed', message: 'The task result cannot be transferred' },
                    }),
                );
            }
            if (body.length > this.maxOutput) {
                socket.destroy();
                return;
            }
            const prefix = Buffer.alloc(4);
            prefix.writeUInt32BE(body.length);
            socket.end(Buffer.concat([prefix, body]));
        };
        const apply = async (bytes: Buffer): Promise<void> => {
            let input: Request | undefined;
            try {
                input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Request;
                if (
                    !input ||
                    typeof input !== 'object' ||
                    input.protocol !== 1 ||
                    typeof input.id !== 'string' ||
                    !input.id ||
                    input.id.length > 128 ||
                    typeof input.identity !== 'string' ||
                    !Number.isSafeInteger(input.budgetMs) ||
                    input.budgetMs <= 0 ||
                    !Object.hasOwn(input, 'payload')
                )
                    throw new TaskError('invalid_request', 'Invalid task request');
                if (input.affinity !== undefined && (typeof input.affinity !== 'string' || input.affinity.length > 255))
                    throw new TaskError('invalid_request', 'Invalid task affinity');
                if (input.identity !== this.options.identity) {
                    respond(input.id, undefined, { code: 'runtime_changed', message: 'The task runtime changed' });
                    return;
                }
                const timeoutMs = Math.floor(Math.min(this.timeout, input.budgetMs) - (performance.now() - started));
                if (timeoutMs <= 0) throw new TaskError('timeout', 'The task exceeded its deadline');
                const result = await this.options.pool.run(input.payload, {
                    timeoutMs,
                    signal: controller.signal,
                    affinity: input.affinity,
                });
                respond(input.id, result);
            } catch (error) {
                respond(
                    typeof input?.id === 'string' ? input.id : '',
                    undefined,
                    error instanceof TaskError
                        ? { code: error.code, message: error.message }
                        : { code: 'invalid_request', message: 'Invalid task request' },
                );
            }
        };
        socket.on('data', (chunk: Buffer) => {
            if (accepted) {
                controller.abort();
                socket.destroy();
                return;
            }
            if (size === undefined) {
                const remaining = 4 - header.length;
                header = Buffer.concat([header, chunk.subarray(0, remaining)]);
                chunk = chunk.subarray(remaining);
                if (header.length < 4) return;
                size = header.readUInt32BE(0);
                if (!size || size > this.maxInput || this.pendingBytes + size > this.maxPending) {
                    socket.destroy();
                    return;
                }
                reservation = size;
                this.pendingBytes += size;
            }
            received += chunk.length;
            if (received > size) {
                socket.destroy();
                return;
            }
            chunks.push(chunk);
            if (received === size) {
                accepted = true;
                const bytes = Buffer.concat(chunks, size);
                release();
                void apply(bytes);
            }
        });
    }
}
