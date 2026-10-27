import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TaskService } from '../service.js';
import { TaskPool } from '../tasks.js';

export async function createDocumentTaskService(options: {
    path: string;
    identity: string;
    worker: URL;
    workers?: number;
}) {
    await mkdir(dirname(options.path), { recursive: true, mode: 0o700 });
    const pool = new TaskPool({
        worker: options.worker,
        workers: options.workers ?? 2,
        maxQueue: 16,
        timeoutMs: 5000,
        maxJobsPerWorker: 100,
        resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32 },
    });
    try {
        const service = await TaskService.open({ path: options.path, identity: options.identity, pool });
        return {
            service,
            pool,
            close: async () => {
                await service.close();
                await pool.close();
            },
        };
    } catch (error) {
        await pool.close();
        throw error;
    }
}
