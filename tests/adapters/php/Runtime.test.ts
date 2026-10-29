// @vitest-environment node
import { TaskPool, TaskService } from '@saad5400/midad/node';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function php(code: string, request: Record<string, unknown> = {}): Promise<any> {
    return new Promise((resolveResult, reject) => {
        const child = execFile(
            'php',
            [
                '-r',
                `require getcwd().'/php.php'; $r = json_decode(stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR); ${code}`,
            ],
            { cwd: resolve('.'), timeout: 6500, maxBuffer: 16 * 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) reject(new Error(`${error.message}: ${stderr}`));
                else {
                    try {
                        resolveResult(JSON.parse(stdout));
                    } catch {
                        reject(new Error(stdout || stderr));
                    }
                }
            },
        );
        child.stdin!.end(JSON.stringify(request));
    });
}

async function directory() {
    const path = await mkdtemp(join(tmpdir(), 'midad-php-runtime-'));
    cleanups.push(() => rm(path, { recursive: true, force: true }));
    return path;
}
async function open() {
    const root = await directory();
    const pool = new TaskPool({ worker: pathToFileURL(resolve('tests/adapters/php/worker.mjs')), workers: 1 });
    cleanups.push(() => pool.close());
    const path = join(root, 'service.sock');
    const service = await TaskService.open({ path, identity: 'a'.repeat(64), pool });
    cleanups.push(() => service.close());
    const manifest = join(root, 'build.json');
    await writeFile(manifest, JSON.stringify({ version: 'a'.repeat(64), protocol: 3 }));
    return { root, path, manifest };
}
const runtime = String.raw`
$archive = new Midad\Php\FontArchive($r['root'], []);
$runtime = new Midad\Php\Runtime($r['manifest'], $r['path'], $archive);
`;

describe.skipIf(process.env.RUN_PHP_ADAPTER !== '1')('PHP editor runtime and storage boundary', () => {
    it('renders Arabic rich content through the actual packaged renderer', async () => {
        const options = await open();
        const result = await php(
            runtime +
                String.raw`
$result = $runtime->render(['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'عقد مستقل Independent']]]]], 'independent', 'Example');
echo json_encode(['pdf' => base64_encode(file_get_contents($result['path'])), 'mode' => fileperms($result['path']) & 0777, 'metadata' => $result['metadata']], JSON_THROW_ON_ERROR);
unlink($result['path']);`,
            options,
        );
        const pdf = await PDFDocument.load(Buffer.from(result.pdf, 'base64'));
        expect(pdf.getPageCount()).toBe(1);
        expect(result.mode).toBe(0o600);
        expect(result.metadata.version).toBe('a'.repeat(64));
        expect(result.metadata.pages).toHaveLength(1);
    }, 10000);
    it('uses the same identity for shared edits and rich HTML conversion', async () => {
        const options = await open();
        const result = await php(
            runtime +
                String.raw`
$imported = (new Midad\Php\AgentContentConverter($runtime))->toTipTapArray('<p><strong>عقد</strong> Independent</p>');
$shared = $runtime->collaborate(['id' => 'shared', 'content' => $imported, 'includeContent' => true]);
echo json_encode($shared, JSON_THROW_ON_ERROR);`,
            options,
        );
        expect(result.renderer).toBe('a'.repeat(64));
        expect(JSON.stringify(result.content)).toContain('عقد');
        expect(JSON.stringify(result.content)).toContain('bold');
    }, 10000);
    it('keeps shared epochs stable across reloads and rejects replaced documents before saving', async () => {
        const options = await open();
        const result = await php(
            runtime +
                String.raw`
$sync = new Midad\Php\Synchronizer($runtime);
$snapshot = ['content' => ['type' => 'doc', 'content' => [['type' => 'paragraph']]], 'shared' => null, 'number' => 1];
$stored = 0;
$store = function ($content, $shared, $restore, $version) use (&$snapshot, &$stored): int {
    $stored++;
    $snapshot = ['content' => $content, 'shared' => $shared, 'number' => $snapshot['number'] + (int) $version];
    return $snapshot['number'];
};
$input = ['renderer_version' => str_repeat('a', 64), 'protocol_version' => 3];
$context = ['id' => 'stable', 'presentation' => [], 'pdfSource' => null];
$initialize = fn ($content) => $content;
$accept = fn () => [];
$one = $sync->synchronize($snapshot, $context, $input, false, $initialize, $accept, $store);
$two = $sync->synchronize($snapshot, ['pdfSource' => null, 'presentation' => [], 'id' => 'stable'], $input, false, $initialize, $accept, $store);
try {
    $sync->synchronize($snapshot, $context, [...$input, 'epoch' => 'replaced', 'update' => $one['state']], true, $initialize, $accept, $store);
} catch (Midad\Php\TaskException $error) { $reason = $error->reason; }
echo json_encode(['same' => $one['epoch'] === $two['epoch'], 'stored' => $stored, 'reason' => $reason]);`,
            options,
        );
        expect(result).toEqual({ same: true, stored: 1, reason: 'content_changed' });
    }, 10000);
    it('persists an edit once, replays its receipt and rejects a reused request id', async () => {
        const options = await open();
        const result = await php(
            runtime +
                String.raw`
$sync = new Midad\Php\Synchronizer($runtime);
$snapshot = ['content' => ['type' => 'doc', 'content' => [['type' => 'paragraph']]], 'shared' => null, 'number' => 1];
$versions = 0;
$accepted = 0;
$store = function ($content, $shared, $restore, $version) use (&$snapshot, &$versions): int {
    $versions += (int) $version;
    $snapshot = ['content' => $content, 'shared' => $shared, 'number' => $snapshot['number'] + (int) $version];
    return $snapshot['number'];
};
$accept = function () use (&$accepted): array { $accepted++; return []; };
$initialize = fn ($content) => $content;
$input = ['renderer_version' => str_repeat('a', 64), 'protocol_version' => 3];
$context = ['id' => 'idempotent'];
$seed = $sync->synchronize($snapshot, $context, $input, false, $initialize, $accept, $store);
$edited = $runtime->collaborate(['id' => 'idempotent', 'state' => $seed['state'], 'content' => ['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'Changed']]]]]]);
$write = [...$input, 'epoch' => $seed['epoch'], 'update' => $edited['state'], 'request_id' => 'request-one'];
$one = $sync->synchronize($snapshot, $context, $write, true, $initialize, $accept, $store);
$two = $sync->synchronize($snapshot, $context, $write, true, $initialize, $accept, $store);
try {
    $sync->synchronize($snapshot, $context, [...$write, 'update' => $seed['state']], true, $initialize, $accept, $store);
} catch (Midad\Php\TaskException $error) { $reason = $error->reason; }
echo json_encode(['versions' => $versions, 'accepted' => $accepted, 'number' => [$one['number'], $two['number']], 'reason' => $reason, 'content' => $snapshot['content']]);`,
            options,
        );
        expect(result).toMatchObject({ versions: 1, accepted: 1, number: [2, 2], reason: 'request_reused' });
        expect(JSON.stringify(result.content)).toContain('Changed');
    }, 10000);
    it('converts grouped table rows and keeps agent block identities stable', async () => {
        const result = await php(String.raw`
$convert = new Midad\Php\AgentBlocks;
$cell = fn (string $text): array => ['type' => 'tableCell', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => $text]]]]];
$doc = ['type' => 'doc', 'content' => [['type' => 'table', 'content' => [['type' => 'tableRowGroup', 'content' => [
['type' => 'tableRow', 'content' => [$cell('عنوان')]], ['type' => 'tableRow', 'content' => [$cell('قيمة')]]]]]]]];
echo json_encode(['one' => $convert->convert($doc), 'two' => $convert->convert($doc)], JSON_THROW_ON_ERROR);`);
        expect(result.one).toEqual(result.two);
        expect(result.one.blocks[0].records).toEqual([{ عنوان: 'قيمة' }]);
    });
    it('retains owned image content when a review edit changes surrounding text', async () => {
        const result = await php(String.raw`
$image = ['type' => 'image', 'attrs' => ['nativeId' => 'image-1', 'src' => 'owned-image', 'width' => 120]];
$current = [['type' => 'text', 'text' => 'Before'], $image];
$before = Midad\Php\InlineReview::snapshot($current);
$after = [['type' => 'text', 'text' => 'After'], ['type' => 'image', 'attrs' => ['id' => 'image-1', 'src' => 'untrusted-image']]];
$merged = Midad\Php\InlineReview::replace($current, $before, $after, []);
$replaced = Midad\Php\InlineReview::replace($current, $before, [['type' => 'image', 'attrs' => ['id' => 'image-2']]], []);
echo json_encode(['merged' => $merged, 'replaced' => $replaced], JSON_THROW_ON_ERROR);`);
        expect(result.merged[0].text).toBe('After');
        expect(result.merged[1].attrs).toEqual({ nativeId: 'image-1', src: 'owned-image', width: 120 });
        expect(result.replaced).toBeNull();
    });
    it('restores fonts using host callbacks and rejects modified archived bytes', async () => {
        const root = await directory();
        const bytes = 'independent archived font';
        const hash = createHash('sha256').update(bytes).digest('hex');
        const code = String.raw`
$archive = new Midad\Php\FontArchive($r['root'], ['example' => $r['hash']], fn (string $key, float $budget): ?string => $r['bytes']);
$path = $archive->asset($r['hash']);
file_put_contents($path, 'changed');
try { $archive->asset($r['hash']); } catch (RuntimeException $e) { echo json_encode(['rejected' => $e->getMessage(), 'bytes' => filesize($path)]); }
`;
        expect(await php(code, { root, bytes, hash })).toMatchObject({
            rejected: 'An archived native font was modified.',
        });
        expect(await readdir(join(root, 'files'))).toEqual([`${hash}.ttf`]);
    });
    it('rejects mismatched historical font manifest identities', async () => {
        const root = await directory();
        const result = await php(
            String.raw`
$archive = new Midad\Php\FontArchive($r['root'], [], fn () => json_encode(['version' => str_repeat('b', 64), 'fonts' => ['example' => str_repeat('c', 64)]]));
try { $archive->forSource(str_repeat('a', 64)); } catch (RuntimeException $e) { echo json_encode(['error' => $e->getMessage()]); }`,
            { root },
        );
        expect(result.error).toBe('Invalid native font manifest identity.');
    });
    it('retains binary legacy collaboration bytes across native updates and clearing', async () => {
        const result = await php(String.raw`
$old = "\0legacy\xff\x80";
$one = Midad\Php\StateEnvelope::write($old, ['epoch' => 'one']);
$two = Midad\Php\StateEnvelope::write($one, ['epoch' => 'two']);
$cleared = Midad\Php\StateEnvelope::write($two, null);
echo json_encode(['read' => Midad\Php\StateEnvelope::read($two), 'legacy' => json_decode(substr($cleared, 8), true)['legacy'], 'state' => Midad\Php\StateEnvelope::read($cleared)], JSON_THROW_ON_ERROR);`);
        expect(result).toEqual({
            read: { epoch: 'two' },
            legacy: Buffer.from([0, ...Buffer.from('legacy'), 255, 128]).toString('base64'),
            state: null,
        });
    });
    it('hashes property order consistently without reordering document children', async () => {
        const result = await php(String.raw`
echo json_encode([
Midad\Php\StateEnvelope::hash(['b' => 2, 'a' => ['y' => 2, 'x' => 1]]) === Midad\Php\StateEnvelope::hash(['a' => ['x' => 1, 'y' => 2], 'b' => 2]),
Midad\Php\StateEnvelope::hash(['content' => [1, 2]]) !== Midad\Php\StateEnvelope::hash(['content' => [2, 1]])]);`);
        expect(result).toEqual([true, true]);
    });
});
