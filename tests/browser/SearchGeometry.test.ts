// @vitest-environment node
import { searchRectangles } from '@saad5400/midad/browser/view';
import { importDocument } from '@saad5400/midad/document';
import { findText } from '@saad5400/midad/editing';
import { layoutDocument } from '@saad5400/midad/layout';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import CanvasKitInit from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
let kernel: NativeTextKernel;
beforeAll(async () => {
    const options = { wasmBinary: await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')) } as Parameters<
        typeof CanvasKitInit
    >[0];
    kernel = await NativeTextKernel.withAssets(
        await CanvasKitInit(options),
        async (font) => new Uint8Array(await readFile(`assets/fonts/${font}.ttf`)),
    );
});
afterAll(() => kernel.destroy());
it('maps mixed-script search hits onto real wrapped/paginated text without changing scene geometry', async () => {
    const doc = importDocument(
        {
            type: 'doc',
            attrs: { dir: 'ltr' },
            content: Array.from({ length: 90 }, (_, index) => ({
                type: 'orderedList',
                content: [
                    {
                        type: 'listItem',
                        content: [
                            {
                                type: 'paragraph',
                                attrs: { id: `p${index}`, dir: index % 2 ? 'rtl' : 'ltr' },
                                content: [
                                    { type: 'text', text: 'Prefix Needle قيمة ' },
                                    {
                                        type: 'text',
                                        text: 'rich text '.repeat(20) + 'Needle قيمة',
                                        marks: [{ type: 'bold' }],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })),
        },
        'find-geometry',
    );
    await kernel.prepare(doc);
    const scene = layoutDocument(doc, kernel),
        before = JSON.stringify(scene.pages.map((page) => page.commands));
    const matches = findText(doc, 'Needle قيمة');
    const boxes = searchRectangles(scene, matches, kernel.ck);
    expect(scene.pages.length).toBeGreaterThan(3);
    expect(new Set(boxes.map((box) => box.matchIndex)).size).toBe(180);
    const reversed = searchRectangles(scene, [...matches].reverse(), kernel.ck);
    expect(new Set(reversed.map((box) => box.matchIndex)).size).toBe(180);
    for (const box of boxes) {
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(scene.pages[box.pageIndex].width);
        expect(box.y + box.height).toBeLessThanOrEqual(scene.pages[box.pageIndex].height);
    }
    expect(searchRectangles(scene, matches, kernel.ck, new Set([2]))).toEqual(
        boxes.filter((box) => box.pageIndex === 2),
    );
    expect(searchRectangles(scene, matches, kernel.ck, new Set())).toEqual([]);
    expect(JSON.stringify(scene.pages.map((page) => page.commands))).toBe(before);
});
