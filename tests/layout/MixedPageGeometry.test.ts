// @vitest-environment node
import { pageSize, setPageLayout } from '@saad5400/midad/content/page-layout';
import { importDocument } from '@saad5400/midad/document';
import { hitTest, layoutDocument } from '@saad5400/midad/layout';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import CanvasKitInit from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { makeOversizedRichFixture } from '../fixtures/nativeDocument.js';

let kernel: NativeTextKernel;
beforeAll(async () => {
    const require = createRequire(import.meta.url);
    kernel = await NativeTextKernel.withAssets(
        await CanvasKitInit({ wasmBinary: await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')) }),
        async (font) => new Uint8Array(await readFile(`assets/fonts/${font}.ttf`)),
        async (source) => ({ bytes: new Uint8Array(Buffer.from(source.slice(source.indexOf(',') + 1), 'base64')) }),
    );
});
afterAll(() => kernel?.destroy());

it('reflows a continuing paragraph into a different physical page width without resetting caret offsets', async () => {
    const source = importDocument(
        {
            type: 'doc',
            attrs: { dir: 'ltr' },
            content: [
                {
                    type: 'paragraph',
                    content: [
                        {
                            type: 'text',
                            text: 'A continuing paragraph must reflow at the next physical page boundary. '.repeat(350),
                        },
                    ],
                },
            ],
        },
        'mixed-pages',
    );
    const document = setPageLayout(source, 2, {
        orientation: 'landscape',
        size: 'letter',
        margins: { left: 48, right: 48 },
    });
    await kernel.prepare(document);
    const scene = layoutDocument(document, kernel);
    expect(scene.pages.length).toBeGreaterThan(2);
    expect(scene.pages[0].width).toBeCloseTo(pageSize('portrait').width, 2);
    expect(scene.pages[1]).toMatchObject({ width: 792, height: 612 });
    expect(scene.pages[2].width).toBeCloseTo(pageSize('portrait').width, 2);
    const previous = scene.pages[0].lines.at(-1)!,
        next = scene.pages[1].lines[0];
    expect(next.shaped.width).toBeCloseTo(720, 2);
    const end = hitTest(scene, 0, (previous.left ?? 0) + previous.shaped.width, previous.top + previous.height / 2)!;
    const start = hitTest(scene, 1, next.left ?? 0, next.top + next.height / 2)!;
    expect(start.blockId).toBe(end.blockId);
    expect(start.blockOffset).toBeGreaterThanOrEqual(end.blockOffset - 1);
});
it('reflows oversized bilingual tables through mixed page geometry while keeping cell bounds inside the page', async () => {
    const source = importDocument(makeOversizedRichFixture(), 'mixed-table-pages');
    const document = setPageLayout(source, 2, {
        orientation: 'landscape',
        size: 'letter',
        margins: { left: 48, right: 48 },
    });
    await kernel.prepare(document);
    const scene = layoutDocument(document, kernel);
    expect(scene.pages.length).toBeGreaterThan(1);
    expect(scene.pages[1]).toMatchObject({ width: 792, height: 612 });
    expect(scene.pages.some((page) => page.cells?.length)).toBe(true);
    for (const page of scene.pages)
        for (const cell of page.cells ?? []) {
            expect(cell.x).toBeGreaterThanOrEqual(-0.01);
            expect(cell.y).toBeGreaterThanOrEqual(-0.01);
            expect(cell.x + cell.width).toBeLessThanOrEqual(page.width + 0.01);
            expect(cell.y + cell.height).toBeLessThanOrEqual(page.height + 0.01);
        }
});
