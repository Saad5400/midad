import { parentPort, threadId, workerData } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { serveTaskWorker } from '../../dist/node/index.js';

if (workerData?.failStartup) throw new Error('Fixture startup failed');
if (workerData?.bootMs) await new Promise((resolve) => setTimeout(resolve, workerData.bootMs));
let count = 0;
serveTaskWorker(async (input) => {
    const started = Date.now();
    if (input.crash) process.exit(23);
    if (input.fail) throw new Error('Fixture task failed');
    if (input.wrongId) parentPort.postMessage({ type: 'result', id: -1, ok: true });
    if (input.delay) await new Promise((resolve) => setTimeout(resolve, input.delay));
    if (input.block) while (Date.now() - started < input.block) {}
    if (input.file) writeFileSync(input.file, 'written');
    if (input.uncloneable) return () => {};
    return { threadId, count: ++count, value: input.value, started, ended: Date.now() };
});
