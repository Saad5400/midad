import CanvasKitInit from 'canvaskit-wasm';
import { createRequire } from 'node:module';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import { importDocument, exportDocument } from '@saad5400/midad/document';
import { persistNativeIdentities } from '@saad5400/midad/identities';
import { layoutDocument } from '@saad5400/midad/layout';
import { sceneManifest } from '@saad5400/midad/pdf';
import { makeNestedRichFixture } from '../fixtures/nativeDocument';
import { applyCollaboration } from '@saad5400/midad/node/collaboration';
import { importHtmlContent } from '@saad5400/midad/node/html';
import { readNativeInput } from '@saad5400/midad/node/input';
import { createRendererRuntime } from '@saad5400/midad/node/renderer';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

async function* chunks(bytes: Uint8Array, size = 1): AsyncIterable<Uint8Array> {
    for (let index = 0; index < bytes.length; index += size) yield bytes.subarray(index, index + size);
}
describe('native renderer input', () => {
    it.each([1, 2, 3, 7])('preserves Arabic and emoji across %s-byte input chunks', async (size) => {
        const input = { title: 'عقد الخدمات', text: 'يَلْتَزِمُ الطرف الأوّل 👨‍👩‍👧‍👦 ١٢٣ ABC' };
        expect(await readNativeInput(chunks(new TextEncoder().encode(JSON.stringify(input)), size))).toEqual(input);
    });
    it('limits encoded bytes rather than UTF-16 character count', async () => {
        const bytes = new TextEncoder().encode(JSON.stringify({ text: 'عربي' }));
        await expect(readNativeInput(chunks(bytes), bytes.length)).resolves.toEqual({ text: 'عربي' });
        await expect(readNativeInput(chunks(bytes), bytes.length - 1)).rejects.toThrow('size limit');
    });
    it.each([[0xd8], [0xd8, 0x20]])(
        'rejects incomplete or invalid UTF-8 instead of replacing characters: %s',
        async (...bytes) => {
            await expect(readNativeInput(chunks(new Uint8Array(bytes)))).rejects.toThrow();
        },
    );
});

it('renders a document using packaged assets without host project paths', async () => {
    const renderer = await createRendererRuntime();
    const directory = await mkdtemp(join(tmpdir(), 'midad-runtime-'));
    try {
        const metadata = (await renderer.render(
            {
                id: 'independent-document',
                content: {
                    type: 'doc',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Independent document العربية' }] }],
                },
            },
            directory,
        )) as { pages: unknown[]; fontHash: string };
        const bytes = await readFile(join(directory, 'document.pdf'));
        expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
        expect(metadata.pages).toHaveLength(1);
        expect(metadata.fontHash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
        renderer.dispose();
        await rm(directory, { recursive: true, force: true });
    }
});

it('owns shared-state tasks without application models', () => {
    const result = applyCollaboration(
        {
            id: 'independent-shared',
            content: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shared content' }] }],
            },
            includeContent: true,
        },
        'host-identity',
    ) as { renderer: string; state: string; content: { content: unknown[] } };
    expect(result.renderer).toBe('host-identity');
    expect(result.state.length).toBeGreaterThan(0);
    expect(result.content.content).toHaveLength(1);
});

it('imports rich HTML without leaving a global document installed', () => {
    const before = globalThis.document;
    const result = importHtmlContent({ html: '<p><strong>Independent</strong> text</p>' });
    expect(JSON.stringify(result.content)).toContain('Independent');
    expect(JSON.stringify(result.content)).toContain('bold');
    expect(globalThis.document).toBe(before);
});


it('keeps the Node PDF pipeline on the same rich-document scene as browser rendering', async () => {
    const require = createRequire(import.meta.url);
    const ck = await CanvasKitInit({ wasmBinary: await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')) });
    const kernel = await NativeTextKernel.withAssets(ck,
        async (font) => new Uint8Array(await readFile(`assets/fonts/${font}.ttf`)),
        async (source) => ({ bytes: new Uint8Array(Buffer.from(source.slice(source.indexOf(',') + 1), 'base64')) }),
    );
    const renderer = await createRendererRuntime();
    const directory = await mkdtemp(join(tmpdir(), 'midad-pipeline-'));
    try {
        const id = 'shared-pipeline';
        const content = exportDocument(persistNativeIdentities(importDocument(makeNestedRichFixture(), id)));
        const document = importDocument(content, id);
        await kernel.prepare(document);
        const expected = sceneManifest(layoutDocument(document, kernel)) as { fontHash: string; pages: unknown[] };
        await renderer.render({ id, content, includeManifest: true }, directory);
        const actual = JSON.parse(await readFile(join(directory, 'scene.json'), 'utf8'));
        expect({ fontHash: actual.fontHash, pages: actual.pages }).toEqual({ fontHash: expected.fontHash, pages: expected.pages });
    } finally {
        renderer.dispose();
        kernel.destroy();
        await rm(directory, { recursive: true, force: true });
    }
}, 10000);
