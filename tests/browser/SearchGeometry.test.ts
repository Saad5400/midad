// @vitest-environment node
import { searchRectangles, selectionViewportRectangles, textRangeRectangles } from '@saad5400/midad/browser/view';
import { importDocument } from '@saad5400/midad/document';
import { findText } from '@saad5400/midad/editing';
import { layoutDocument } from '@saad5400/midad/layout';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import CanvasKitInit from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

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

it('projects reversed selections across wrapped numbered paragraphs and skips unmounted pages', async () => {
    const doc = importDocument(
        {
            type: 'doc',
            content: Array.from({ length: 80 }, (_, index) => ({
                type: 'orderedList',
                content: [
                    {
                        type: 'listItem',
                        content: [
                            {
                                type: 'paragraph',
                                attrs: { id: `selection-${index}`, dir: index % 2 ? 'rtl' : 'ltr' },
                                content: [{ type: 'text', text: 'Selected text العربية '.repeat(12) }],
                            },
                        ],
                    },
                ],
            })),
        },
        'selection',
    );
    await kernel.prepare(doc);
    const scene = layoutDocument(doc, kernel);
    expect(scene.pages.length).toBeGreaterThan(2);
    const selected = {
        anchor: { blockId: 'selection-0', offset: 9 },
        focus: { blockId: 'selection-79', offset: 25 },
    };
    const pageOrigin = vi.fn((index: number) => (index === 1 ? { left: 37, top: -90 } : undefined));
    const options = { canvasKit: kernel.ck, scale: 1.5, pageOrigin, pages: new Set([1]) };
    const rectangles = selectionViewportRectangles(doc, scene, selected, options);
    expect(rectangles.length).toBeGreaterThan(0);
    expect(pageOrigin).toHaveBeenCalledExactlyOnceWith(1);
    expect(
        selectionViewportRectangles(doc, scene, { anchor: selected.focus, focus: selected.anchor }, options),
    ).toEqual(rectangles);
    for (const rectangle of rectangles) {
        expect(rectangle.left).toBeGreaterThanOrEqual(37);
        expect(rectangle.top).toBeGreaterThanOrEqual(-90);
        expect(rectangle.left + rectangle.width).toBeLessThanOrEqual(37 + scene.pages[1].width * 1.5);
        expect(rectangle.top + rectangle.height).toBeLessThanOrEqual(-90 + scene.pages[1].height * 1.5);
    }
    expect(selectionViewportRectangles(doc, scene, selected, { ...options, pageOrigin: () => undefined })).toEqual([]);
    expect(selectionViewportRectangles(doc, scene, selected, { ...options, scale: 0 })).toEqual([]);
});

it('reuses shaped-range measurements across search and selection views', async () => {
    const doc = importDocument(
        {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    attrs: { id: 'cached' },
                    content: [{ type: 'text', text: 'Reusable selected text' }],
                },
            ],
        },
        'cached',
    );
    await kernel.prepare(doc);
    const scene = layoutDocument(doc, kernel),
        shaped = scene.pages[0].lines[0].shaped;
    const measure = vi.spyOn(shaped.paragraph, 'getRectsForRange');
    try {
        const matches = [{ blockId: 'cached', from: 0, to: 8 }];
        const searched = searchRectangles(scene, matches, kernel.ck);
        expect(textRangeRectangles(shaped, 0, 8, kernel.ck)).toHaveLength(searched.length);
        expect(measure).toHaveBeenCalledOnce();
        const expanded = textRangeRectangles(shaped, 0, 12, kernel.ck);
        expect(expanded[0][2] - expanded[0][0]).toBeGreaterThan(searched[0].width);
        expect(measure).toHaveBeenCalledTimes(2);
    } finally {
        measure.mockRestore();
    }
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
