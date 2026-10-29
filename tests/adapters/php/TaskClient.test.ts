// @vitest-environment node
import { TaskPool, TaskService } from '@saad5400/midad/node';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const code = String.raw`
require getcwd().'/php.php';
$request = json_decode(stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR);
$client = new Midad\Php\TaskClient($request['path'], $request['identity'] ?? 'php-test', 5, $request['maxInput'] ?? 33554432, $request['maxOutput'] ?? 67108864);
try {
    echo json_encode(['result' => $client->request($request['payload'], $request['budget'] ?? 5)], JSON_THROW_ON_ERROR);
} catch (Midad\Php\TaskException $error) {
    echo json_encode(['error' => $error->reason, 'message' => $error->getMessage()], JSON_THROW_ON_ERROR);
}
`;

function php(request: Record<string, unknown>): Promise<any> {
    return new Promise((resolveResult, reject) => {
        const child = execFile('php', ['-r', code], { cwd: resolve('.'), timeout: 6500 }, (error, stdout, stderr) => {
            if (error) reject(new Error(`${error.message}: ${stderr}`));
            else {
                try {
                    resolveResult(JSON.parse(stdout));
                } catch {
                    reject(new Error(stdout || stderr));
                }
            }
        });
        child.stdin!.end(JSON.stringify(request));
    });
}

async function open() {
    const directory = await mkdtemp(join(tmpdir(), 'midad-php-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const pool = new TaskPool({ worker: pathToFileURL(resolve('tests/node/worker.mjs')), workers: 1 });
    cleanups.push(() => pool.close());
    const path = join(directory, 'worker.sock');
    const service = await TaskService.open({ path, identity: 'php-test', pool });
    cleanups.push(() => service.close());
    return path;
}

describe.skipIf(process.env.RUN_PHP_ADAPTER !== '1')('framework-independent PHP task client', () => {
    it('exchanges Unicode data with the real Node task service', async () => {
        const path = await open();
        expect(await php({ path, payload: { value: { text: 'عقد ABC', count: 3 } } })).toMatchObject({
            result: { value: { text: 'عقد ABC', count: 3 }, count: 1 },
        });
    });
    it('distinguishes task failures from a changed runtime identity', async () => {
        const path = await open();
        expect(await php({ path, payload: { fail: true } })).toMatchObject({ error: 'failed' });
        expect(await php({ path, identity: 'old', payload: {} })).toMatchObject({ error: 'runtime_changed' });
    });
    it('bounds input and output before allocating oversized frames', async () => {
        const path = await open();
        expect(await php({ path, payload: { value: 'x'.repeat(1000) }, maxInput: 100 })).toMatchObject({
            error: 'input_limit',
        });
        expect(await php({ path, payload: { value: 'x'.repeat(1000) }, maxOutput: 100 })).toMatchObject({
            error: 'output_limit',
        });
    });
    it('applies one deadline to the task and transport', async () => {
        const path = await open();
        const started = performance.now();
        expect(await php({ path, payload: { block: 300 }, budget: 0.03 })).toMatchObject({ error: 'deadline' });
        expect(performance.now() - started).toBeLessThan(1000);
    });
    it('reports an absent service without importing Laravel', async () => {
        expect(await php({ path: join(tmpdir(), 'missing-midad-service.sock'), payload: {} })).toMatchObject({
            error: 'unavailable',
        });
    });
});
