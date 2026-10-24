// @vitest-environment node
import { importDocument } from '@saad5400/midad/document';
import { layoutDocument } from '@saad5400/midad/layout';
import { sceneManifest } from '@saad5400/midad/pdf';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import { LAYOUT_VERSION } from '@saad5400/midad/version';
import CanvasKitInit from 'canvaskit-wasm';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

it('guards the declared layout contract with complete deterministic scene goldens', async () => {
    const wasm = { wasmBinary: await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')) } as Parameters<
        typeof CanvasKitInit
    >[0];
    const kernel = await NativeTextKernel.withAssets(
        await CanvasKitInit(wasm),
        async (font) => new Uint8Array(await readFile(`assets/fonts/${font}.ttf`)),
        async (source) => ({ bytes: new Uint8Array(Buffer.from(source.slice(source.indexOf(',') + 1), 'base64')) }),
    );
    const reference = JSON.parse(await readFile('tests/fixtures/layout-golden.json', 'utf8'));
    if (!reference.documents) throw new Error('Frozen reference inputs are missing');
    const inputs: Array<[string, unknown]> = Object.entries(reference.documents);
    try {
        const scenes: Record<string, string> = {};
        for (const [name, file] of inputs) {
            const content = JSON.parse(await readFile(join('tests/fixtures', String(file)), 'utf8'));
            const document = importDocument(content, `layout-golden-${name}`);
            await kernel.prepare(document);
            const scene = layoutDocument(document, kernel);
            const manifest = sceneManifest(scene) as { fontHash: string; pages: unknown[] };
            scenes[name] = digest({ fontHash: manifest.fontHash, pages: manifest.pages });
        }
        const actual = { version: LAYOUT_VERSION, scenes };
        const path = 'tests/fixtures/layout-golden.json';
        const pkg = JSON.parse(await readFile('package.json', 'utf8'));
        if (process.env.UPDATE_LAYOUT_GOLDEN === '1') {
            if (process.env.CI) throw new Error('Layout goldens must be reviewed outside CI');
            await writeFile(path, JSON.stringify({ ...actual, documents: Object.fromEntries(inputs) }, null, 4) + '\n');
            pkg.midad.layoutGolden = digest(actual);
            await writeFile('package.json', JSON.stringify(pkg, null, 4) + '\n');
        } else {
            const expected = JSON.parse(await readFile(path, 'utf8'));
            expect(actual).toEqual({ version: expected.version, scenes: expected.scenes });
            expect(digest({ version: expected.version, scenes: expected.scenes })).toBe(pkg.midad.layoutGolden);
        }
    } finally {
        kernel.destroy();
    }
}, 30000);
