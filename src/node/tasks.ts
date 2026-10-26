import { Worker, type ResourceLimits } from 'node:worker_threads';

export type TaskErrorCode =
    | 'timeout'
    | 'cancelled'
    | 'overloaded'
    | 'closed'
    | 'worker_error'
    | 'failed'
    | 'runtime_changed'
    | 'invalid_request';
export class TaskError extends Error {
    constructor(
        readonly code: TaskErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'TaskError';
    }
}
export interface TaskPoolOptions {
    readonly worker: URL;
    readonly workers?: number;
    readonly maxQueue?: number;
    readonly maxQueueBytes?: number;
    readonly timeoutMs?: number;
    readonly startupTimeoutMs?: number;
    readonly maxJobsPerWorker?: number;
    readonly resourceLimits?: ResourceLimits;
    readonly workerData?: unknown;
}
interface Task {
    readonly id: number;
    readonly payload: unknown;
    readonly bytes: number;
    readonly affinity?: string;
    readonly resolve: (value: unknown) => void;
    readonly reject: (error: unknown) => void;
    timer?: ReturnType<typeof setTimeout>;
    signal?: AbortSignal;
    abort?: () => void;
    slot?: Slot;
    settled: boolean;
}
interface Slot {
    readonly worker: Worker;
    readonly failures: number;
    ready: boolean;
    retired: boolean;
    completed: number;
    affinity?: string;
    task?: Task;
    timer?: ReturnType<typeof setTimeout>;
}

export class TaskPool {
    private readonly slots = new Set<Slot>();
    private readonly queue: Task[] = [];
    private readonly waiting: { resolve(): void; reject(error: unknown): void }[] = [];
    private readonly terminating = new Set<Promise<number>>();
    private readonly count: number;
    private readonly maxQueue: number;
    private readonly maxQueueBytes: number;
    private readonly timeout: number;
    private readonly startupTimeout: number;
    private readonly maxJobs: number;
    private sequence = 0;
    private queuedBytes = 0;
    private closed = false;

    constructor(private readonly options: TaskPoolOptions) {
        this.count = this.positive(options.workers ?? 2);
        this.maxQueue = this.positive(options.maxQueue ?? 16);
        this.maxQueueBytes = this.positive(options.maxQueueBytes ?? 64 * 1024 * 1024);
        this.timeout = this.positive(options.timeoutMs ?? 5000);
        this.startupTimeout = this.positive(options.startupTimeoutMs ?? 5000);
        this.maxJobs = this.positive(options.maxJobsPerWorker ?? 100);
        if (this.count > 32) throw new Error('Too many task workers');
        for (let index = 0; index < this.count; index++) this.spawn(0);
    }

    ready(): Promise<void> {
        if (this.closed) return Promise.reject(new TaskError('closed', 'The task pool is closed'));
        if (this.slots.size === this.count && [...this.slots].every((slot) => slot.ready)) return Promise.resolve();
        return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
    }

    run(
        payload: unknown,
        options: { timeoutMs?: number; signal?: AbortSignal; affinity?: string } = {},
    ): Promise<unknown> {
        if (this.closed) return Promise.reject(new TaskError('closed', 'The task pool is closed'));
        if (options.signal?.aborted) return Promise.reject(new TaskError('cancelled', 'The task was cancelled'));
        let bytes: number;
        let timeout: number;
        try {
            if (
                options.affinity !== undefined &&
                (typeof options.affinity !== 'string' || options.affinity.length > 255)
            )
                throw new Error('Invalid task affinity');
            const json = JSON.stringify(payload, (_key, value: unknown) => {
                if (
                    typeof value === 'function' ||
                    typeof value === 'symbol' ||
                    typeof value === 'bigint' ||
                    value === undefined ||
                    (typeof value === 'number' && !Number.isFinite(value)) ||
                    (value &&
                        typeof value === 'object' &&
                        !Array.isArray(value) &&
                        ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
                )
                    throw new Error('Tasks require JSON values');
                return value;
            });
            bytes = Buffer.byteLength(json);
            payload = JSON.parse(json);
            timeout = Math.min(this.timeout, this.positive(options.timeoutMs ?? this.timeout));
        } catch {
            return Promise.reject(new TaskError('invalid_request', 'Invalid task input'));
        }
        const available = [...this.slots].some((slot) => slot.ready && !slot.task);
        if (
            bytes > this.maxQueueBytes ||
            this.queuedBytes + bytes > this.maxQueueBytes ||
            (!available && this.queue.length >= this.maxQueue)
        )
            return Promise.reject(new TaskError('overloaded', 'The task queue is full'));
        return new Promise((resolve, reject) => {
            const task: Task = {
                id: ++this.sequence,
                payload,
                bytes,
                affinity: options.affinity,
                resolve,
                reject,
                settled: false,
                signal: options.signal,
            };
            task.timer = setTimeout(
                () => this.cancel(task, new TaskError('timeout', 'The task exceeded its deadline')),
                timeout,
            );
            task.abort = () => this.cancel(task, new TaskError('cancelled', 'The task was cancelled'));
            task.signal?.addEventListener('abort', task.abort, { once: true });
            this.queue.push(task);
            this.queuedBytes += bytes;
            this.dispatch();
        });
    }

    stats(): Readonly<{ workers: number; active: number; queued: number; queuedBytes: number; closed: boolean }> {
        return Object.freeze({
            workers: this.slots.size,
            active: [...this.slots].filter((slot) => !!slot.task).length,
            queued: this.queue.length,
            queuedBytes: this.queuedBytes,
            closed: this.closed,
        });
    }

    async close(error = new TaskError('closed', 'The task pool is closed')): Promise<void> {
        if (!this.closed) {
            this.closed = true;
            for (const task of [...this.queue]) this.finish(task, error);
            for (const slot of [...this.slots]) {
                if (slot.task) this.finish(slot.task, error);
                this.retire(slot);
            }
            for (const waiter of this.waiting.splice(0)) waiter.reject(error);
        }
        await Promise.allSettled([...this.terminating]);
    }

    private positive(value: number): number {
        if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid task pool limit');
        return value;
    }

    private spawn(failures: number): void {
        if (this.closed) return;
        let worker: Worker;
        try {
            worker = new Worker(this.options.worker, {
                workerData: this.options.workerData,
                resourceLimits: this.options.resourceLimits ?? { maxOldGenerationSizeMb: 256 },
            });
        } catch (error) {
            void this.close(
                new TaskError('worker_error', error instanceof Error ? error.message : 'Worker startup failed'),
            );
            return;
        }
        const slot: Slot = { worker, ready: false, retired: false, completed: 0, failures };
        this.slots.add(slot);
        slot.timer = setTimeout(() => this.failed(slot, 'Worker startup exceeded its deadline'), this.startupTimeout);
        worker.on('message', (message: unknown) => this.receive(slot, message));
        worker.on('error', (error) => this.failed(slot, error.message));
        worker.on('exit', () => this.failed(slot, 'The worker exited before completing its task'));
    }

    private receive(slot: Slot, message: unknown): void {
        if (slot.retired || this.closed) return;
        if (!message || typeof message !== 'object') return this.failed(slot, 'Invalid worker response');
        const reply = message as { type?: string; id?: number; ok?: boolean; value?: unknown; error?: string };
        if (reply.type === 'ready' && !slot.ready && !slot.task) {
            clearTimeout(slot.timer);
            slot.ready = true;
            if (this.slots.size === this.count && [...this.slots].every((entry) => entry.ready))
                for (const waiter of this.waiting.splice(0)) waiter.resolve();
            this.dispatch();
            return;
        }
        const task = slot.task;
        if (reply.type !== 'result' || !slot.ready || !task || reply.id !== task.id || typeof reply.ok !== 'boolean')
            return this.failed(slot, 'Invalid worker response');
        slot.task = undefined;
        slot.completed++;
        this.finish(
            task,
            reply.ok ? undefined : new TaskError('failed', reply.error ?? 'The task failed'),
            reply.value,
        );
        if (slot.completed >= this.maxJobs) {
            this.retire(slot);
            this.spawn(0);
        }
        this.dispatch();
    }

    private dispatch(): void {
        if (this.closed) return;
        while (this.queue.length) {
            const available = [...this.slots].filter((slot) => slot.ready && !slot.retired && !slot.task);
            if (!available.length) break;
            const task = this.queue.shift()!;
            const slot = available.find((slot) => !!task.affinity && slot.affinity === task.affinity) ?? available[0];
            this.queuedBytes -= task.bytes;
            task.slot = slot;
            slot.task = task;
            slot.affinity = task.affinity;
            try {
                slot.worker.postMessage({ type: 'task', id: task.id, payload: task.payload });
            } catch {
                slot.task = undefined;
                this.finish(task, new TaskError('invalid_request', 'The task input cannot be transferred'));
                this.dispatch();
            }
        }
    }

    private cancel(task: Task, error: TaskError): void {
        if (task.settled) return;
        const slot = task.slot;
        this.finish(task, error);
        if (slot && !slot.retired) {
            slot.task = undefined;
            this.retire(slot);
            this.spawn(0);
        }
        this.dispatch();
    }

    private finish(task: Task, error?: unknown, result?: unknown): void {
        if (task.settled) return;
        task.settled = true;
        clearTimeout(task.timer);
        if (task.abort) task.signal?.removeEventListener('abort', task.abort);
        const index = this.queue.indexOf(task);
        if (index >= 0) {
            this.queue.splice(index, 1);
            this.queuedBytes -= task.bytes;
        }
        if (error) task.reject(error);
        else task.resolve(result);
    }

    private failed(slot: Slot, message: string): void {
        if (slot.retired || this.closed) return;
        const failures = slot.ready ? 0 : slot.failures + 1;
        if (slot.task) this.finish(slot.task, new TaskError('worker_error', message));
        this.retire(slot);
        if (failures >= 3) void this.close(new TaskError('worker_error', message));
        else this.spawn(failures);
    }

    private retire(slot: Slot): void {
        if (slot.retired) return;
        slot.retired = true;
        clearTimeout(slot.timer);
        this.slots.delete(slot);
        const termination = slot.worker.terminate();
        this.terminating.add(termination);
        void termination.finally(() => this.terminating.delete(termination)).catch(() => {});
    }
}
