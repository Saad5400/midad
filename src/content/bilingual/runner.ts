import type { NativeDocument } from '../../document/model.js';
import {
    alignBilingualSources,
    applyBilingualTranslations,
    bilingualTranslationJobs,
    type BilingualApplied,
    type BilingualSourceSegment,
    type BilingualTranslationJob,
    type BilingualTranslator,
} from './translation.js';

export interface BilingualTranslationStatus {
    readonly pending: number;
    readonly translated: number;
    readonly failed: number;
    readonly stale: number;
    readonly tooLong: number;
}
export interface BilingualRunnerOptions {
    readonly document: () => NativeDocument;
    readonly apply: (
        change: (document: NativeDocument) => BilingualApplied,
        signal?: AbortSignal,
    ) => Promise<BilingualApplied | undefined>;
    readonly translator: BilingualTranslator;
    readonly status?: (status: BilingualTranslationStatus) => void;
}
export class BilingualTranslationRunner {
    private readonly controller = new AbortController();
    private readonly queued = new Set<string>();
    private readonly forced = new Set<string>();
    private readonly attempts = new Map<string, string>();
    private active?: Promise<void>;
    private disposed = false;
    private value: BilingualTranslationStatus = { pending: 0, translated: 0, failed: 0, stale: 0, tooLong: 0 };
    constructor(private readonly options: BilingualRunnerOptions) {}
    get status(): BilingualTranslationStatus {
        return this.value;
    }
    start(rows: readonly string[], retry = false): void {
        if (this.disposed) return;
        rows.forEach((row) => {
            this.queued.add(row);
            if (retry) this.forced.add(row);
        });
        if (!this.active)
            this.active = Promise.resolve()
                .then(() => this.drain())
                .catch(() => this.publish({ pending: 0, failed: Math.max(1, this.value.failed) }))
                .finally(() => {
                    this.active = undefined;
                    if (this.queued.size && !this.disposed) this.start([]);
                });
    }
    async idle(): Promise<void> {
        while (this.active) await this.active;
    }
    dispose(): void {
        this.disposed = true;
        this.queued.clear();
        this.controller.abort();
    }
    private publish(value: Partial<BilingualTranslationStatus>): void {
        if (this.disposed) return;
        this.value = Object.freeze({ ...this.value, ...value });
        this.options.status?.(this.value);
    }
    private abortable<T>(operation: () => Promise<T>): Promise<T> {
        const signal = this.controller.signal;
        return new Promise((resolve, reject) => {
            const abort = () => reject(new DOMException('Translation canceled', 'AbortError'));
            if (signal.aborted) {
                abort();
                return;
            }
            signal.addEventListener('abort', abort, { once: true });
            void Promise.resolve()
                .then(() => {
                    if (signal.aborted) throw new DOMException('Translation canceled', 'AbortError');
                    return operation();
                })
                .then(
                    (value) => {
                        signal.removeEventListener('abort', abort);
                        resolve(value);
                    },
                    (error) => {
                        signal.removeEventListener('abort', abort);
                        reject(error);
                    },
                );
        });
    }
    private async brief(
        jobs: readonly BilingualTranslationJob[],
    ): Promise<{ summary: string; glossary: readonly { source: string; target: string }[] } | undefined> {
        const text = jobs.flatMap((job) => job.segments.map((segment) => segment.plain)).join('\n');
        if (!this.options.translator.glossary || text.length < 4000) return;
        const signal = this.controller.signal;
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value?: {
                summary: string;
                glossary: readonly { source: string; target: string }[];
            }): void => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                signal.removeEventListener('abort', abort);
                resolve(value);
            };
            const abort = () => finish();
            const timer = setTimeout(() => finish(), 20000);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) {
                finish();
                return;
            }
            void this.options.translator.glossary!(
                { from: jobs[0].from, to: jobs[0].to, text: text.slice(0, 40000) },
                signal,
            ).then(
                (value) => finish(value),
                () => finish(),
            );
        });
    }
    private async drain(): Promise<void> {
        while (this.queued.size && !this.disposed) {
            const rows = new Set(this.queued);
            this.queued.clear();
            const aligned = await this.options.apply(
                (document) => ({ document: alignBilingualSources(document, rows), applied: [], stale: [], failed: [] }),
                this.controller.signal,
            );
            if (this.disposed || !aligned) return;
            const jobs = bilingualTranslationJobs(
                this.options.document(),
                rows,
                this.options.translator.languages?.(),
            ).filter((job) => {
                const stamp = `${job.sourceKey}>${job.targetKey}`;
                if (!this.forced.has(job.rowId) && this.attempts.get(job.key) === stamp) return false;
                this.attempts.set(job.key, stamp);
                return true;
            });
            rows.forEach((row) => this.forced.delete(row));
            if (!jobs.length) continue;
            const tooLong = jobs.filter((job) => job.segments.some((segment) => segment.text.length > 15000));
            const eligible = jobs.filter((job) => !tooLong.includes(job));
            this.publish({ pending: eligible.length, translated: 0, failed: 0, stale: 0, tooLong: tooLong.length });
            const results = new Map<string, string>();
            const settled = new Set<string>();
            const processed = new Set<string>();
            let applying: Promise<void> = Promise.resolve();
            const flush = (): Promise<void> => {
                applying = applying.then(async () => {
                    if (this.disposed) return;
                    const ready = eligible.filter(
                        (job) => !processed.has(job.key) && job.segments.every((segment) => settled.has(segment.id)),
                    );
                    if (!ready.length) return;
                    ready.forEach((job) => processed.add(job.key));
                    try {
                        const outcome = await this.options.apply(
                            (document) => applyBilingualTranslations(document, ready, results),
                            this.controller.signal,
                        );
                        if (this.disposed) return;
                        this.publish({
                            pending: eligible.length - processed.size,
                            translated: this.value.translated + (outcome?.applied.length ?? 0),
                            failed: this.value.failed + (outcome?.failed.length ?? 0),
                            stale: this.value.stale + (outcome?.stale.length ?? ready.length),
                        });
                    } catch {
                        this.publish({
                            pending: eligible.length - processed.size,
                            failed: this.value.failed + ready.length,
                        });
                    }
                });
                return applying;
            };
            const groups = new Map<string, BilingualTranslationJob[]>();
            eligible.forEach((job) => {
                if (job.segments.every((segment) => !/\p{Letter}/u.test(segment.plain))) {
                    job.segments.forEach((segment) => {
                        results.set(segment.id, segment.text);
                        settled.add(segment.id);
                    });
                    return;
                }
                const key = `${job.from}>${job.to}`;
                groups.set(key, [...(groups.get(key) ?? []), job]);
            });
            const requests: Array<() => Promise<void>> = [];
            await flush();
            await Promise.all(
                [...groups.values()].map(async (group) => {
                    const context = await this.brief(group);
                    if (this.disposed) return;
                    const segments = group.flatMap((job) => [...job.segments]);
                    const batches: BilingualSourceSegment[][] = [];
                    let current: BilingualSourceSegment[] = [],
                        size = 0;
                    segments.forEach((segment) => {
                        if (current.length && (current.length >= 40 || size + segment.text.length > 4000)) {
                            batches.push(current);
                            current = [];
                            size = 0;
                        }
                        current.push(segment);
                        size += segment.text.length;
                    });
                    if (current.length) batches.push(current);
                    batches.forEach((batch, index) =>
                        requests.push(async () => {
                            if (this.disposed) return;
                            try {
                                const response = await this.abortable(() =>
                                    this.options.translator.translate(
                                        {
                                            from: group[0].from,
                                            to: group[0].to,
                                            segments: batch.map(({ id, text }) => ({ id, text })),
                                            context: {
                                                title: this.options.translator.title?.() ?? null,
                                                ...context,
                                                before: batches[index - 1]
                                                    ?.slice(-2)
                                                    .map((segment) => segment.plain)
                                                    .join('\n')
                                                    .slice(-1200),
                                                after: batches[index + 1]
                                                    ?.slice(0, 2)
                                                    .map((segment) => segment.plain)
                                                    .join('\n')
                                                    .slice(0, 1200),
                                            },
                                        },
                                        this.controller.signal,
                                    ),
                                );
                                if (this.disposed) return;
                                const expected = new Set(batch.map((segment) => segment.id));
                                const failed = new Set(response.failed);
                                for (const segment of response.segments)
                                    if (
                                        expected.has(segment.id) &&
                                        !failed.has(segment.id) &&
                                        typeof segment.text === 'string'
                                    )
                                        results.set(segment.id, segment.text);
                            } catch {
                            } finally {
                                batch.forEach((segment) => settled.add(segment.id));
                                await flush();
                            }
                        }),
                    );
                }),
            );
            let index = 0;
            const work = async (): Promise<void> => {
                while (!this.disposed && index < requests.length) await requests[index++]();
            };
            await Promise.all(Array.from({ length: Math.min(3, requests.length) }, work));
            if (this.disposed) return;
            await flush();
            this.publish({ pending: 0 });
        }
    }
}
