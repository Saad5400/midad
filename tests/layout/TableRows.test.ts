// @vitest-environment node
import { importDocument } from '@saad5400/midad/document';
import { layoutDocument } from '@saad5400/midad/layout';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import CanvasKitInit from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { verifyScenePdf } from '../fixtures/pdfGeometry';

let kernel: NativeTextKernel;
beforeAll(async () => {
    const require = createRequire(import.meta.url);
    kernel = await NativeTextKernel.withAssets(
        await CanvasKitInit({ wasmBinary: await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')) }),
        async (font) => new Uint8Array(await readFile(`assets/fonts/${font}.ttf`)),
    );
});
afterAll(() => kernel.destroy());

const paragraph = (id: string, text = id) => ({
    type: 'paragraph',
    attrs: { id, dir: 'ltr' },
    content: [{ type: 'text', text }],
});
function table(height: number, merged = false) {
    const cell = (id: string, rowspan = 1) => ({
        type: 'tableCell',
        attrs: { id, rowspan },
        content: [paragraph(`${id}-text`)],
    });
    return {
        type: 'table',
        attrs: { id: 'table' },
        content: [
            {
                type: 'tableRow',
                attrs: { id: 'first', rowHeight: height },
                content: [cell('a', merged ? 2 : 1), cell('b')],
            },
            {
                type: 'tableRow',
                attrs: { id: 'second', rowHeight: 96 },
                content: merged ? [cell('c')] : [cell('c'), cell('d')],
            },
        ],
    };
}

it.each(['ltr', 'rtl'])('honors row heights inside nested language columns (%s)', async (dir) => {
    const document = importDocument(
        {
            type: 'doc',
            attrs: { dir },
            content: [
                {
                    type: 'parallelRow',
                    content: [
                        { type: 'parallelCell', attrs: { lang: 'ar' }, content: [table(192)] },
                        { type: 'parallelCell', attrs: { lang: 'en' }, content: [paragraph('other')] },
                    ],
                },
            ],
        },
        'row-height',
    );
    await kernel.prepare(document);
    const scene = layoutDocument(document, kernel);
    expect(scene.pages[0].cells!.find((cell) => cell.cellId === 'a')!.height).toBe(144);
    expect(scene.pages[0].cells!.find((cell) => cell.cellId === 'c')!.height).toBe(72);
    expect(scene.pages[0].tableRows!.map((row) => [row.rowId, row.height, row.ends])).toEqual([
        ['first', 144, true],
        ['second', 72, true],
    ]);
    expect(scene.pages[0].tableRows![0].x).toBe(scene.pages[0].cells!.find((cell) => cell.cellId === 'a')!.tableX);
    await verifyScenePdf(document, scene, kernel, `row-height-${dir}`);
});

it('sums logical row heights for merged cells', async () => {
    const document = importDocument({ type: 'doc', content: [table(192, true)] }, 'row-span-height');
    await kernel.prepare(document);
    const scene = layoutDocument(document, kernel);
    expect(scene.pages[0].cells!.find((cell) => cell.cellId === 'a')!.height).toBe(216);
    await verifyScenePdf(document, scene, kernel, 'row-span-height');
});

it.each(['ltr', 'rtl'])('retains merged logical row heights through multi-page flow (%s)', async (dir) => {
    const content = table(1800, true);
    const first = content.content[0];
    const nested = {
        type: 'parallelRow',
        content: ['ar', 'en'].map((lang) => ({
            type: 'parallelCell',
            attrs: { lang },
            content: Array.from({ length: 35 }, (_, index) => paragraph(`${lang}-${index}`, 'Rich content')),
        })),
    };
    const document = importDocument(
        {
            type: 'doc',
            attrs: { dir },
            content: [
                {
                    ...content,
                    content: [
                        {
                            ...first,
                            content: first.content.map((cell) =>
                                cell.attrs.id === 'b' ? { ...cell, content: [nested] } : cell,
                            ),
                        },
                        ...content.content.slice(1),
                    ],
                },
            ],
        },
        'merged-row-pages',
    );
    await kernel.prepare(document);
    const scene = layoutDocument(document, kernel);
    expect(scene.pages.length).toBeGreaterThan(1);
    const rows = scene.pages.flatMap((page) => page.tableRows ?? []);
    expect(
        rows.filter((row) => row.rowId === 'first').reduce((sum, row) => sum + row.height, 0),
    ).toBeGreaterThanOrEqual(1350);
    for (const id of ['first', 'second']) expect(rows.filter((row) => row.rowId === id && row.ends)).toHaveLength(1);
    expect(rows.every((row) => Object.isFrozen(row))).toBe(true);
    await verifyScenePdf(document, scene, kernel, `merged-row-pages-${dir}`);
});

it('keeps a requested tall row across page boundaries without clipping text or losing its height', async () => {
    const document = importDocument({ type: 'doc', content: [table(1800)] }, 'row-pages');
    await kernel.prepare(document);
    const scene = layoutDocument(document, kernel);
    const fragments = scene.pages.flatMap((page) => page.cells?.filter((cell) => cell.cellId === 'a') ?? []);
    expect(scene.pages.length).toBeGreaterThan(1);
    expect(fragments.reduce((sum, cell) => sum + cell.height, 0)).toBe(1350);
    const rows = scene.pages.flatMap((page) => page.tableRows?.filter((row) => row.rowId === 'first') ?? []);
    expect(rows.reduce((sum, row) => sum + row.height, 0)).toBe(1350);
    expect(rows.filter((row) => row.ends)).toEqual([rows.at(-1)]);
    expect(scene.pages.flatMap((page) => page.lines).filter((line) => line.paragraphId === 'a-text')).toHaveLength(1);
    await verifyScenePdf(document, scene, kernel, 'row-pages');
});

it('treats row height as a minimum and preserves overflowing rich text', async () => {
    const content = table(1);
    content.content[0].content[0].content = [paragraph('long', 'A long line\n'.repeat(12))];
    const document = importDocument({ type: 'doc', content: [content] }, 'row-minimum');
    await kernel.prepare(document);
    const scene = layoutDocument(document, kernel);
    expect(scene.pages[0].cells!.find((cell) => cell.cellId === 'a')!.height).toBeGreaterThan(100);
    await verifyScenePdf(document, scene, kernel, 'row-minimum');
});
