import { NativeNavigation, searchRectangles } from '@saad5400/midad/browser';
import type { NativeDocument } from '@saad5400/midad/document';
import { blockText, findText, textBlocks } from '@saad5400/midad/editing';
import type { DocumentScene } from '@saad5400/midad/layout';
import { sceneReviewMap } from '@saad5400/midad/pdf';
import interlocking from '../fixtures/layout-contract/interlocking.json';
import rowHeights from '../fixtures/layout-contract/row-heights.json';
import { makeNestedRichFixture } from '../fixtures/nativeDocument.js';
import { verifyScenePdf } from '../fixtures/pdfGeometry.js';
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

function verifyCoverage(document: NativeDocument, scene: DocumentScene): void {
    for (const block of textBlocks(document.root)) {
        const length = blockText(block).length;
        const ranges = scene.pages.flatMap((page) =>
            page.lines
                .filter((line) => line.paragraphId === block.id)
                .map((line) => {
                    const row = line.shaped.lines.find((row) => row.top === line.originalTop)!;
                    const first = line.shaped.sources[0];
                    const prefix = first?.nodeId === block.id && !first.editable ? first.to : 0;
                    return {
                        from: Math.max(0, row.start - prefix + (line.fragmentFrom ?? 0)),
                        to: Math.min(length, row.endWithBreak - prefix + (line.fragmentFrom ?? 0)),
                    };
                }),
        );
        expect(ranges.length, block.id).toBeGreaterThan(0);
        ranges.sort((a, b) => a.from - b.from);
        let offset = 0;
        for (const range of ranges) {
            expect(range.from, `${block.id}: missing or repeated text`).toBe(offset);
            offset = range.to;
        }
        expect(offset, block.id).toBe(length);
    }
}

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
    expect(start.offset).toBe(start.blockOffset);
    verifyCoverage(document, scene);
    await verifyScenePdf(document, scene, kernel, 'mixed-page-paragraph');
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
    verifyCoverage(document, scene);
    await verifyScenePdf(document, scene, kernel, 'mixed-page-columns-table');
    for (const page of scene.pages)
        for (const cell of page.cells ?? []) {
            expect(cell.x).toBeGreaterThanOrEqual(-0.01);
            expect(cell.y).toBeGreaterThanOrEqual(-0.01);
            expect(cell.x + cell.width).toBeLessThanOrEqual(page.width + 0.01);
            expect(cell.y + cell.height).toBeLessThanOrEqual(page.height + 0.01);
        }
});

it('keeps keyboard movement, search and review anchors in document offsets after a page-width change', async () => {
    const text = Array.from({ length: 1500 }, (_, index) => `word${String(index).padStart(6, '0')}`).join(' ');
    const source = importDocument(
        { type: 'doc', attrs: { dir: 'ltr' }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
        'mixed-page-interactions',
    );
    const document = setPageLayout(source, 2, { size: 'letter', orientation: 'landscape' });
    await kernel.prepare(document);
    const scene = layoutDocument(document, kernel);
    const line = scene.pages[1].lines[0],
        from = line.fragmentFrom!;
    expect(from).toBeGreaterThan(0);
    const nav = new NativeNavigation(document, scene, kernel.ck);
    expect(nav.horizontal({ blockId: line.paragraphId, offset: from }, -1, 'downstream').offset).toBe(from - 1);
    expect(nav.horizontal({ blockId: line.paragraphId, offset: from - 1 }, 1, 'upstream').offset).toBe(from);
    expect(nav.row({ blockId: line.paragraphId, offset: from }, 'downstream')?.pageIndex).toBe(1);
    const at = text.indexOf('word', from + 12),
        phrase = text.slice(at, at + 10);
    const matches = findText(document, phrase, { wholeWord: true });
    expect(matches).toHaveLength(1);
    expect(
        searchRectangles(scene, matches, kernel.ck).some(
            (rectangle) => rectangle.pageIndex === 1 && rectangle.width > 0,
        ),
    ).toBe(true);
    const review = sceneReviewMap(document, scene);
    expect(
        review.rows.some(
            (row) => row.page === 2 && row.parts.some((part) => part.from <= at && part.to >= at + phrase.length),
        ),
    ).toBe(true);
    verifyCoverage(document, scene);
});

it.each([
    ['nested', makeNestedRichFixture()],
    ['interlocking', interlocking],
    ['row-heights', rowHeights],
] as const)(
    'retains complete %s content while three consecutive pages use different paper and margins',
    async (name, fixture) => {
        const source = importDocument(fixture, `mixed-${name}`);
        let document = setPageLayout(source, 2, {
            orientation: 'landscape',
            size: 'letter',
            margins: { top: 48, bottom: 48, left: 48, right: 48 },
        });
        document = setPageLayout(document, 3, { size: 'a5', margins: { top: 48, bottom: 48, left: 48, right: 48 } });
        document = setPageLayout(document, 4, { size: { width: 620, height: 900 }, margins: { left: 72 } });
        const started = performance.now();
        await kernel.prepare(document);
        const scene = layoutDocument(document, kernel);
        expect(performance.now() - started).toBeLessThan(5000);
        verifyCoverage(document, scene);
        await verifyScenePdf(document, scene, kernel, `mixed-page-${name}`);
        sceneReviewMap(document, scene);
    },
);
it('continues rich RTL lists, clause numbering and explicit line breaks across differently sized pages', async () => {
    const paragraph = (id: string) => ({
        type: 'paragraph',
        attrs: { id, dir: 'rtl' },
        content: [
            {
                type: 'text',
                text: 'نص عربي طويل English mixed text '.repeat(80),
                marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#123456', fontSize: '18px' } }],
            },
            { type: 'hardBreak' },
            { type: 'text', text: 'نهاية الفقرة' },
            { type: 'hardBreak' },
        ],
    });
    const source = importDocument(
        {
            type: 'doc',
            content: [
                {
                    type: 'orderedList',
                    attrs: { start: 9 },
                    content: Array.from({ length: 3 }, (_, index) => ({
                        type: 'listItem',
                        content: [paragraph(`list-${index}`), paragraph(`continued-${index}`)],
                    })),
                },
            ],
        },
        'mixed-rtl-lists',
    );
    let document = setPageLayout(source, 2, { size: 'letter', orientation: 'landscape' });
    document = setPageLayout(document, 3, { size: 'a5', margins: { left: 48, right: 48 } });
    await kernel.prepare(document);
    const scene = layoutDocument(document, kernel);
    verifyCoverage(document, scene);
    await verifyScenePdf(document, scene, kernel, 'mixed-page-rtl-lists');
    sceneReviewMap(document, scene);
});

it('keeps rowspan origins and the original grid after earlier ragged rows have completed', async () => {
    const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const table = {
        type: 'table',
        attrs: { id: 'ragged-spans', columnSize: '2,1,1' },
        content: [
            {
                type: 'tableRow',
                content: [{ type: 'tableHeader', attrs: { colspan: 3 }, content: [paragraph('A full width header')] }],
            },
            {
                type: 'tableRow',
                content: [
                    {
                        type: 'tableCell',
                        attrs: { rowspan: 2 },
                        content: [paragraph('A long spanning cell continues across page sizes. '.repeat(130))],
                    },
                    { type: 'tableCell', content: [paragraph('Second column')] },
                ],
            },
            { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('A short trailing row')] }] },
        ],
    };
    const document = setPageLayout(importDocument({ type: 'doc', content: [table] }, 'ragged-spans'), 2, {
        size: 'letter',
        orientation: 'landscape',
    });
    await kernel.prepare(document);
    const scene = layoutDocument(document, kernel);
    expect(scene.pages.length).toBeGreaterThan(1);
    for (const page of scene.pages) for (const cell of page.cells ?? []) expect(cell.columnEdges).toHaveLength(4);
    verifyCoverage(document, scene);
    await verifyScenePdf(document, scene, kernel, 'mixed-page-ragged-rowspans');
});
it('positions normalized floating fields using the dimensions of their own page', async () => {
    const source = importDocument(
        {
            type: 'doc',
            attrs: {
                blockVariables: [
                    {
                        id: 'page-two-field',
                        type: 'text',
                        value: 'Field on page two',
                        settings: { page: 2, relativeXPct: 0.1, relativeYPct: 0.2, widthPct: 0.3, heightPct: 0.1 },
                    },
                ],
            },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First page' }] }],
        },
        'mixed-floating',
    );
    const document = setPageLayout(source, 2, { size: 'letter', orientation: 'landscape' });
    await kernel.prepare(document);
    const scene = layoutDocument(document, kernel);
    const field = scene.pages[1].commands.find(
        (command) => command.kind === 'field' && command.nodeId === 'page-two-field',
    );
    expect(field?.kind).toBe('field');
    if (field?.kind !== 'field') throw new Error('Missing floating field');
    for (const [key, value] of Object.entries({ x: 79.2, y: 122.4, width: 237.6, height: 61.2 }))
        expect(field[key as 'x' | 'y' | 'width' | 'height']).toBeCloseTo(value, 3);
    await verifyScenePdf(document, scene, kernel, 'mixed-page-floating');
});
it('keeps a 600-paragraph mixed-size layout and PDF export within five seconds each', async () => {
    const source = importDocument(
        {
            type: 'doc',
            content: Array.from({ length: 600 }, (_, index) => ({
                type: 'paragraph',
                content: [
                    {
                        type: 'text',
                        text: `${index} ` + 'يلتزم الطرف الأول بأحكام العقد والسداد خلال ثلاثين يوماً. '.repeat(10),
                    },
                ],
            })),
        },
        'mixed-large',
    );
    let document = setPageLayout(source, 2, { orientation: 'landscape', size: 'letter' });
    document = setPageLayout(document, 3, { size: 'a5', margins: { top: 48, bottom: 48, left: 48, right: 48 } });
    const started = performance.now();
    await kernel.prepare(document);
    const scene = layoutDocument(document, kernel);
    const layoutMs = performance.now() - started;
    expect(layoutMs).toBeLessThan(5000);
    console.log(JSON.stringify({ workload: '600 mixed-size paragraphs before verification', layoutMs, pages: scene.pages.length }));
    const coverageStarted = performance.now();
    verifyCoverage(document, scene);
    console.log(JSON.stringify({ coverageMs: performance.now() - coverageStarted }));
    await verifyScenePdf(document, scene, kernel, 'mixed-page-large');
    console.log(JSON.stringify({ workload: '600 mixed-size paragraphs', layoutMs, pages: scene.pages.length }));
}, 15000);
