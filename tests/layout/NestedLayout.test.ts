// @vitest-environment node
import { importDocument, type Json } from '@saad5400/midad/document';
import { exportDocument } from '@saad5400/midad/document';
import { emptyWritingPosition } from '@saad5400/midad/browser';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import { layoutDocument } from '@saad5400/midad/layout';
import { NativeNavigation } from '@saad5400/midad/browser';
import { verifyScenePdf } from '../fixtures/pdfGeometry';
import { makeNestedRichFixture } from '../fixtures/nativeDocument';
import CanvasKitInit from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const paragraph = (id: string, text = id): Json => ({
    type: 'paragraph',
    attrs: { id },
    content: [{ type: 'text', text }],
});
const table = (id: string, children: Json[], header = false): Json => ({
    type: 'table',
    attrs: { id },
    content: [
        {
            type: 'tableRow',
            content: [{ type: header ? 'tableHeader' : 'tableCell', attrs: { id: `${id}-cell` }, content: children }],
        },
    ],
});
const columns = (id: string, children: Json[], other: Json[] = [paragraph(`${id}-en`, 'English text')]): Json => ({
    type: 'parallelRow',
    attrs: { id },
    content: [
        { type: 'parallelCell', attrs: { id: `${id}-ar-column`, lang: 'ar' }, content: children },
        { type: 'parallelCell', attrs: { id: `${id}-en-column`, lang: 'en' }, content: other },
    ],
});

describe('native nested rich content layout', () => {
    let kernel: NativeTextKernel;
    beforeAll(async () => {
        const options: NonNullable<Parameters<typeof CanvasKitInit>[0]> & { wasmBinary: Uint8Array } = {
            wasmBinary: await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')),
        };
        kernel = await NativeTextKernel.withAssets(
            await CanvasKitInit(options),
            async (font) => new Uint8Array(await readFile(`assets/fonts/${font}.ttf`)),
            async (source) => ({ bytes: new Uint8Array(Buffer.from(source.slice(source.indexOf(',') + 1), 'base64')) }),
        );
    });
    afterAll(() => kernel.destroy());
    it('reserves the same writable space for a missing table paragraph as an explicit empty paragraph', async () => {
        const content = {
            type: 'doc',
            content: [
                {
                    type: 'parallelRow',
                    content: [
                        {
                            type: 'parallelCell',
                            attrs: { id: 'ar', lang: 'ar' },
                            content: [
                                {
                                    type: 'table',
                                    content: [
                                        {
                                            type: 'tableRow',
                                            content: [{ type: 'tableCell', attrs: { id: 'empty-cell' }, content: [] }],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            type: 'parallelCell',
                            attrs: { id: 'en', lang: 'en' },
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep this column' }] }],
                        },
                    ],
                },
            ],
        };
        const document = importDocument(content, 'empty-nested');
        await kernel.prepare(document);
        const scene = layoutDocument(document, kernel);
        const cell = scene.pages[0].cells!.find((cell) => cell.cellId === 'empty-cell')!;
        expect(cell.height).toBeGreaterThan(25);
        const position = emptyWritingPosition(document, scene, 0, {
            x: cell.x + cell.width / 2,
            y: cell.y + cell.height / 2,
        });
        expect(position?.target.containerId).toBe('empty-cell');
        expect(position!.x).toBeGreaterThan(cell.x);
        expect(position!.x).toBeLessThan(cell.x + cell.width);
        expect(position!.y + position!.height).toBeLessThanOrEqual(cell.y + cell.height);
        expect(exportDocument(document)).toEqual(content);
        const explicit = JSON.parse(JSON.stringify(content));
        explicit.content[0].content[0].content[0].content[0].content[0].content.push({
            type: 'paragraph',
            content: [],
        });
        const visible = importDocument(explicit, 'empty-nested');
        await kernel.prepare(visible);
        const rendered = layoutDocument(visible, kernel);
        expect(rendered.pages[0].cells!.find((cell) => cell.cellId === 'empty-cell')).toEqual(cell);
        expect(rendered.pages.length).toBe(scene.pages.length);
    });
    it('does not reserve another writing line after populated list items', async () => {
        const document = importDocument(
            {
                type: 'doc',
                attrs: { dir: 'ltr' },
                content: [
                    {
                        type: 'bulletList',
                        content: [
                            {
                                type: 'listItem',
                                content: [
                                    {
                                        type: 'paragraph',
                                        attrs: { id: 'item' },
                                        content: [{ type: 'text', text: 'Item' }],
                                    },
                                ],
                            },
                        ],
                    },
                    { type: 'paragraph', attrs: { id: 'after-list' }, content: [{ type: 'text', text: 'After list' }] },
                ],
            },
            'list-spacing',
        );
        await kernel.prepare(document);
        const scene = layoutDocument(document, kernel);
        const item = scene.pages[0].lines.find((line) => line.paragraphId === 'item')!;
        const after = scene.pages[0].lines.find((line) => line.paragraphId === 'after-list')!;
        expect(after.top - item.top - item.height).toBeCloseTo(6, 2);
    });

    it('preserves closed nested table cells after repeated stretching by outer tables and language columns', async () => {
        const doc = importDocument(makeNestedRichFixture(), 'nested-layout');
        await kernel.prepare(doc);
        const result = layoutDocument(doc, kernel);
        const near = (a: number, b: number) => Math.abs(a - b) < 0.002;
        for (const page of result.pages)
            for (const cell of page.cells ?? []) {
                if (!cell.tableId.endsWith('-nested-table')) continue;
                const bottom = cell.y + cell.height;
                expect(
                    page.commands.some(
                        (command) =>
                            command.kind === 'line' &&
                            near(command.x, cell.x) &&
                            near(command.toX, cell.x + cell.width) &&
                            near(command.y, bottom) &&
                            near(command.toY, bottom),
                    ),
                    cell.cellId,
                ).toBe(true);
            }
    });
    async function scene(children: Json[]) {
        const doc = importDocument({ type: 'doc', content: children }, 'nested-layout');
        await kernel.prepare(doc);
        return layoutDocument(doc, kernel);
    }
    it.each(
        ['clause', 'orderedList', 'bulletList', 'heading', 'paragraph'].flatMap((kind) =>
            ['ltr', 'rtl'].flatMap((dir) => ['plain', 'table', 'columns'].map((context) => ({ kind, dir, context }))),
        ),
    )('places the caret on a blank line after a $kind label ($dir, $context)', async ({ kind, dir, context }) => {
        const body: Json = {
            type: kind === 'clause' ? 'clauseTitle' : kind === 'heading' ? 'heading' : 'paragraph',
            attrs: { id: 'target', dir },
            content: [{ type: 'text', text: 'Hello' }, { type: 'hardBreak' }],
        };
        const root: Json =
            kind === 'clause'
                ? {
                      type: 'clause',
                      attrs: { id: 'clause', groupId: 'group', activeVariantId: 'variant' },
                      content: [body, { type: 'clauseBody', content: [paragraph('body', 'Body')] }],
                  }
                : ['orderedList', 'bulletList'].includes(kind)
                  ? { type: kind, content: [{ type: 'listItem', content: [body] }] }
                  : body;
        const container =
            context === 'table' ? table('outer', [root]) : context === 'columns' ? columns('outer', [root]) : root;
        const doc = importDocument({ type: 'doc', content: [container] }, 'blank-caret');
        await kernel.prepare(doc);
        const layout = layoutDocument(doc, kernel);
        const nav = new NativeNavigation(doc, layout, kernel.ck);
        const caret = nav.caret({ blockId: 'target', offset: 6 })!;
        expect(caret.row.line.start).toBeGreaterThan(0);
        expect(caret.top).toBeCloseTo(caret.row.line.top, 2);
        expect(caret.bottom).toBeCloseTo(caret.row.line.bottom, 2);
    });
    it.each(['top', 'middle', 'bottom'])(
        'positions %s aligned cell content by physical height with mixed font sizes',
        async (alignment) => {
            const result = await scene([
                {
                    type: 'table',
                    attrs: { id: 'aligned' },
                    content: [
                        {
                            type: 'tableRow',
                            content: [
                                {
                                    type: 'tableCell',
                                    attrs: { id: 'small-cell', verticalAlign: alignment },
                                    content: [paragraph('small', 'Small text')],
                                },
                                {
                                    type: 'tableCell',
                                    attrs: { id: 'large-cell' },
                                    content: [
                                        {
                                            type: 'paragraph',
                                            attrs: { id: 'large' },
                                            content: [
                                                {
                                                    type: 'text',
                                                    text: 'Large',
                                                    marks: [{ type: 'textStyle', attrs: { fontSize: '64px' } }],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ]);
            const page = result.pages[0];
            const cell = page.cells!.find((cell) => cell.cellId === 'small-cell')!;
            const line = page.lines.find((line) => line.paragraphId === 'small')!;
            const spare = cell.height - 12 - line.height - 6;
            const offset = alignment === 'middle' ? spare / 2 : alignment === 'bottom' ? spare : 0;
            expect(line.top).toBeCloseTo(cell.y + 6 + offset, 2);
        },
    );
    it('allows different font sizes in language columns without inserting gaps between the smaller paragraphs', async () => {
        const result = await scene([
            columns(
                'natural',
                [paragraph('one', 'First'), paragraph('two', 'Second')],
                [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Large',
                                marks: [{ type: 'textStyle', attrs: { fontSize: '64px' } }],
                            },
                        ],
                    },
                ],
            ),
        ]);
        const lines = result.pages[0].lines;
        const one = lines.find((line) => line.paragraphId === 'one')!;
        const two = lines.find((line) => line.paragraphId === 'two')!;
        expect(two.top - one.top).toBeCloseTo(one.height + 6, 2);
    });
    it.each(['plain', 'table', 'columns', 'quote', 'list'])(
        'flows oversized language columns independently inside %s',
        async (context) => {
            const small = Array.from({ length: 35 }, (_, index) => paragraph(`small-${index}`, `Small ${index}`));
            const large: Json[] = Array.from({ length: 35 }, (_, index) => ({
                type: 'paragraph',
                attrs: { id: `large-${index}` },
                content: [{ type: 'text', text: 'Big', marks: [{ type: 'textStyle', attrs: { fontSize: '48px' } }] }],
            }));
            const row = columns('target', small, large);
            const root: Json =
                context === 'table'
                    ? table('outer', [row])
                    : context === 'columns'
                      ? columns('outer', [row])
                      : context === 'quote'
                        ? { type: 'blockquote', content: [row] }
                        : context === 'list'
                          ? { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('label'), row] }] }
                          : row;
            const result = await scene([paragraph('before'), root, paragraph('after')]);
            expect(result.pages.length).toBeGreaterThan(1);
            const lines = result.pages.flatMap((page) => page.lines);
            for (const prefix of ['small', 'large'])
                expect(lines.filter((line) => line.paragraphId.startsWith(`${prefix}-`))).toHaveLength(35);
            for (const page of result.pages) {
                const smallLines = page.lines.filter((line) => line.paragraphId.startsWith('small-'));
                for (let index = 1; index < smallLines.length; index++)
                    expect(smallLines[index].top - smallLines[index - 1].top).toBeCloseTo(
                        smallLines[index - 1].height + 6,
                        2,
                    );
                for (const line of page.lines) expect(line.top + line.height).toBeLessThanOrEqual(page.height - 35);
            }
            expect(result.pages[0].lines.some((line) => line.paragraphId === 'small-0')).toBe(true);
        },
    );
    it.each(['normal', '0.5', '1', '1.5', '2'])(
        'keeps every rich text character in the paint commands at line spacing %s',
        async (lineHeight) => {
            const text = 'Alpha العربية ABCDEFG English 123 آخر النص';
            const result = await scene([
                columns('coverage', [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text,
                                marks: [{ type: 'textStyle', attrs: { fontSize: '48px', lineHeight } }],
                            },
                        ],
                    },
                ]),
            ]);
            const ink = result.pages
                .flatMap((page) =>
                    page.commands.flatMap((command) =>
                        command.kind === 'glyphs' && command.size === 36 ? command.text : [],
                    ),
                )
                .join('');
            const characters = (value: string) => Array.from(value.replace(/\s/g, '')).sort().join('');
            expect(characters(ink)).toBe(characters(text));
        },
    );
    it.each(['top', 'middle', 'bottom'])(
        'preserves all text and cell hit regions in oversized %s aligned table rows',
        async (verticalAlign) => {
            const result = await scene([
                columns('outer', [
                    {
                        type: 'table',
                        attrs: { id: 'target' },
                        content: [
                            {
                                type: 'tableRow',
                                content: ['small', 'large'].map((id) => ({
                                    type: 'tableCell',
                                    attrs: { id, verticalAlign, backgroundColor: '#ffffcc' },
                                    content: Array.from({ length: 40 }, (_, index) => ({
                                        type: 'paragraph',
                                        attrs: { id: `${id}-${index}` },
                                        content: [
                                            {
                                                type: 'text',
                                                text: id === 'small' ? 'One' : 'Big',
                                                marks: [
                                                    {
                                                        type: 'textStyle',
                                                        attrs: { fontSize: id === 'small' ? '12px' : '32px' },
                                                    },
                                                ],
                                            },
                                        ],
                                    })),
                                })),
                            },
                        ],
                    },
                ]),
            ]);
            const lines = result.pages.flatMap((page) => page.lines);
            for (const id of ['small', 'large'])
                expect(lines.filter((line) => line.paragraphId.startsWith(`${id}-`))).toHaveLength(40);
            for (const page of result.pages)
                for (const id of ['small', 'large']) {
                    const cells = page.cells!.filter((cell) => cell.cellId === id);
                    expect(cells.length).toBeGreaterThan(0);
                    for (const line of page.lines.filter((line) => line.paragraphId.startsWith(`${id}-`)))
                        expect(
                            cells.some(
                                (cell) => line.top >= cell.y && line.top + line.height <= cell.y + cell.height + 0.002,
                            ),
                        ).toBe(true);
                }
        },
    );
    it('retains nested column text inside a multi-page group of merged table rows', async () => {
        const result = await scene([
            {
                type: 'table',
                attrs: { id: 'merged' },
                content: [
                    {
                        type: 'tableRow',
                        content: [
                            {
                                type: 'tableCell',
                                attrs: { id: 'spanning', rowspan: 2 },
                                content: [
                                    columns(
                                        'nested',
                                        Array.from({ length: 80 }, (_, index) =>
                                            paragraph(`nested-${index}`, 'Nested text'),
                                        ),
                                    ),
                                ],
                            },
                            { type: 'tableCell', attrs: { id: 'first-cell' }, content: [paragraph('first-row')] },
                        ],
                    },
                    {
                        type: 'tableRow',
                        content: [
                            { type: 'tableCell', attrs: { id: 'second-cell' }, content: [paragraph('second-row')] },
                        ],
                    },
                ],
            },
        ]);
        expect(result.pages.length).toBeGreaterThan(1);
        const lines = result.pages.flatMap((page) => page.lines);
        expect(lines.filter((line) => /^nested-\d+$/.test(line.paragraphId))).toHaveLength(80);
        expect(lines.filter((line) => line.paragraphId === 'first-row')).toHaveLength(1);
        expect(lines.filter((line) => line.paragraphId === 'second-row')).toHaveLength(1);
        for (const page of result.pages)
            for (const line of page.lines) expect(line.top + line.height).toBeLessThanOrEqual(page.height - 35);
    });
    it.each(
        ['plain', 'columns', 'table', 'nested'].flatMap((context) =>
            ['top', 'middle', 'bottom'].map((verticalAlign) => ({ context, verticalAlign })),
        ),
    )(
        'preserves natural paragraph spacing across merged rows ($context, $verticalAlign)',
        async ({ context, verticalAlign }) => {
            const content = (prefix: string, count: number, size: number): Json[] =>
                Array.from({ length: count }, (_, index) => ({
                    type: 'paragraph',
                    attrs: { id: `${prefix}-${index}` },
                    content: [
                        { type: 'text', text: 'One', marks: [{ type: 'textStyle', attrs: { fontSize: `${size}px` } }] },
                    ],
                }));
            const merged: Json = {
                type: 'table',
                attrs: { id: 'physical-merged' },
                content: [
                    {
                        type: 'tableRow',
                        content: [
                            {
                                type: 'tableCell',
                                attrs: { id: 'tall-span', rowspan: 2 },
                                content: content('tall-span-text', 80, 32),
                            },
                            {
                                type: 'tableCell',
                                attrs: { id: 'short-first-cell', verticalAlign },
                                content: content('short-first', 10, 12),
                            },
                        ],
                    },
                    {
                        type: 'tableRow',
                        content: [
                            {
                                type: 'tableCell',
                                attrs: { id: 'short-second-cell', verticalAlign },
                                content: content('short-second', 10, 12),
                            },
                        ],
                    },
                ],
            };
            const root =
                context === 'columns'
                    ? columns('outer', [merged])
                    : context === 'table'
                      ? table('outer', [merged])
                      : context === 'nested'
                        ? table('outer-table', [columns('outer-columns', [merged])])
                        : merged;
            const result = await scene([root]);
            expect(result.pages.length).toBeGreaterThan(1);
            expect(
                result.pages
                    .flatMap((page) => page.lines)
                    .filter((line) => line.paragraphId.startsWith('tall-span-text-')),
            ).toHaveLength(80);
            for (const page of result.pages) {
                for (const line of page.lines) {
                    expect(line.top + line.height).toBeLessThanOrEqual(page.height - 72 + 0.002);
                    if (line.cellId)
                        expect(
                            page.cells?.some(
                                (cell) =>
                                    cell.cellId === line.cellId &&
                                    line.top >= cell.y - 0.002 &&
                                    line.top + line.height <= cell.y + cell.height + 0.002,
                            ),
                        ).toBe(true);
                }
                for (const cell of page.cells ?? [])
                    expect(cell.y + cell.height).toBeLessThanOrEqual(page.height - 72 + 0.002);
            }
            for (const prefix of ['short-first', 'short-second']) {
                expect(
                    result.pages
                        .flatMap((page) => page.lines)
                        .filter((line) => line.paragraphId.startsWith(`${prefix}-`)),
                ).toHaveLength(10);
                for (const [pageIndex, page] of result.pages.entries()) {
                    const lines = page.lines.filter((line) => line.paragraphId.startsWith(`${prefix}-`));
                    for (let index = 1; index < lines.length; index++)
                        expect(
                            lines[index].top - lines[index - 1].top,
                            `${prefix} on page ${pageIndex + 1}`,
                        ).toBeCloseTo(lines[index - 1].height + 6, 2);
                }
            }
        },
    );
    it.each(['plain', 'columns', 'table', 'nested'] as const)(
        'keeps a table row together when it fits on the next page inside %s',
        async (context) => {
            const row = table(
                'target',
                Array.from({ length: 5 }, (_, index) => paragraph(`target-${index}`, 'البند العربية English')),
                true,
            );
            const nested =
                context === 'plain'
                    ? row
                    : context === 'columns'
                      ? columns('outer', [row])
                      : context === 'table'
                        ? table('outer', [row])
                        : table('outer-table', [columns('outer-columns', [row])]);
            const result = await scene([
                ...Array.from({ length: 26 }, (_, index) => paragraph(`filler-${index}`, 'السطر السابق')),
                nested,
            ]);
            const pages = result.pages.flatMap((page, index) =>
                page.cells?.some((cell) => cell.tableId === 'target') ? [index] : [],
            );
            expect(pages).toHaveLength(1);
            expect(pages[0]).toBeGreaterThan(0);
            expect(result.pages[pages[0]].lines.filter((line) => line.paragraphId.startsWith('target-'))).toHaveLength(
                5,
            );
        },
    );
    it.each(['columns', 'table'])(
        'keeps nested table backgrounds and borders continuous beside larger text inside %s',
        async (context) => {
            const large = {
                type: 'paragraph',
                attrs: { id: 'large' },
                content: [{ type: 'text', text: 'Large', marks: [{ type: 'textStyle', attrs: { fontSize: '48px' } }] }],
            };
            const target = table('target', [paragraph('small', 'العربية')], true);
            const result = await scene([
                context === 'columns'
                    ? columns('outer', [target], [large])
                    : {
                          type: 'table',
                          attrs: { id: 'outer' },
                          content: [
                              {
                                  type: 'tableRow',
                                  content: [
                                      { type: 'tableCell', content: [target] },
                                      { type: 'tableCell', content: [large] },
                                  ],
                              },
                          ],
                      },
            ]);
            const cells = result.pages[0].cells!.filter((cell) => cell.tableId === 'target');
            expect(cells).toHaveLength(1);
        },
    );
    it.each(['ltr', 'rtl'])('keeps interlocking merged rich cells inside page bounds (%s)', async (dir) => {
        const rich = (id: string, size: number): Json[] => [
            {
                type: 'paragraph',
                attrs: { id: `${id}-wrapped` },
                content: [
                    {
                        type: 'text',
                        text: 'النص المتداخل Mixed text 123 '.repeat(80),
                        marks: [{ type: 'textStyle', attrs: { fontSize: `${size}px` } }],
                    },
                ],
            },
            {
                type: 'paragraph',
                attrs: { id: `${id}-image` },
                content: [
                    {
                        type: 'image',
                        attrs: {
                            id: `${id}-inline-image`,
                            src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a52kAAAAASUVORK5CYII=',
                            width: 70,
                            height: 90,
                        },
                    },
                ],
            },
            {
                type: 'paragraph',
                attrs: { id: `${id}-field` },
                content: [
                    {
                        type: 'variable',
                        attrs: { id: `${id}-inline-field`, type: 'text', value: 'قيمة Value', width: 80, height: 35 },
                    },
                ],
            },
        ];
        const merged: Json = {
            type: 'table',
            attrs: { id: 'interlocking', dir },
            content: [
                {
                    type: 'tableRow',
                    content: [
                        {
                            type: 'tableCell',
                            attrs: { id: 'left-span', rowspan: 2, backgroundColor: '#ffeecc' },
                            content: rich('left', 28),
                        },
                        {
                            type: 'tableCell',
                            attrs: { id: 'top-right', backgroundColor: '#ccffee' },
                            content: [paragraph('top-right-text')],
                        },
                    ],
                },
                {
                    type: 'tableRow',
                    content: [
                        {
                            type: 'tableCell',
                            attrs: {
                                id: 'right-span',
                                rowspan: 2,
                                backgroundColor: '#cceeff',
                                verticalAlign: 'middle',
                            },
                            content: [
                                columns('nested-rich-columns', rich('right', 12), [
                                    table('colored-child', [paragraph('deep-text')], true),
                                ]),
                            ],
                        },
                    ],
                },
                {
                    type: 'tableRow',
                    content: [
                        { type: 'tableCell', attrs: { id: 'bottom-left' }, content: [paragraph('bottom-left-text')] },
                    ],
                },
            ],
        };
        const doc = importDocument(
            { type: 'doc', attrs: { dir }, content: [columns('outer-rich', [merged])] },
            'interlocking',
        );
        await kernel.prepare(doc);
        const started = performance.now();
        const result = layoutDocument(doc, kernel);
        expect(performance.now() - started).toBeLessThan(5000);
        await verifyScenePdf(doc, result, kernel, `interlocking-${dir}`);
        for (const prefix of ['left', 'right']) {
            expect(
                result.pages
                    .flatMap((page) => page.lines)
                    .filter((line) => line.paragraphId === `${prefix}-wrapped`)
                    .map((line) =>
                        line.shaped.text.slice(
                            line.shaped.lines.find((entry) => entry.top === line.originalTop)!.start,
                            line.shaped.lines.find((entry) => entry.top === line.originalTop)!.endWithBreak,
                        ),
                    )
                    .join(''),
            ).toBe('النص المتداخل Mixed text 123 '.repeat(80));
            expect(
                result.pages
                    .flatMap((page) => page.commands)
                    .filter((command) => command.kind === 'image' && command.nodeId === `${prefix}-inline-image`),
            ).toHaveLength(1);
            expect(
                result.pages
                    .flatMap((page) => page.commands)
                    .filter((command) => command.kind === 'field' && command.nodeId === `${prefix}-inline-field`),
            ).toHaveLength(1);
        }
        for (const page of result.pages) {
            for (const line of page.lines) {
                expect(line.top + line.height, line.paragraphId).toBeLessThanOrEqual(page.height - 72 + 0.002);
                if (line.cellId)
                    expect(
                        page.cells?.some(
                            (cell) =>
                                cell.cellId === line.cellId &&
                                line.top >= cell.y - 0.002 &&
                                line.top + line.height <= cell.y + cell.height + 0.002,
                        ),
                        line.paragraphId,
                    ).toBe(true);
            }
            const firstGlyph = page.commands.findIndex((command) => 'glyphs' in command);
            for (const [index, command] of page.commands.entries())
                if (command.kind === 'rect' && command.tableBackground !== undefined)
                    expect(index).toBeLessThan(firstGlyph);
        }
    });
    it.each(['plain', 'columns'].flatMap((context) => [-0.02, 0, 0.02].map((extra) => ({ context, extra }))))(
        'paginates the final text line at a tightly filled page boundary ($context, $extra pt)',
        async ({ context, extra }) => {
            const paragraphs = Array.from({ length: 28 }, (_, index) =>
                paragraph(`tight-${index}`, 'Full page العربية'),
            );
            const content =
                context === 'columns'
                    ? [
                          columns(
                              'tight-columns',
                              paragraphs,
                              Array.from({ length: 28 }, (_, index) =>
                                  paragraph(`tight-peer-${index}`, 'Full page العربية'),
                              ),
                          ),
                      ]
                    : paragraphs;
            const probe = await scene(content);
            const bottom = Math.max(...probe.pages[0].lines.map((line) => line.top + line.height));
            const fixture: Json = {
                type: 'doc',
                attrs: {
                    pageLayout: {
                        orientation: 'portrait',
                        margins: {
                            top: 96,
                            left: 96,
                            right: 96,
                            bottom: (probe.pages[0].height - bottom - extra) / 0.75,
                        },
                    },
                },
                content,
            };
            const doc = importDocument(fixture, 'tight-boundary');
            const margins = (fixture as { attrs: { pageLayout: { margins: { bottom: number } } } }).attrs.pageLayout
                .margins;
            expect(margins.bottom).toBeGreaterThanOrEqual(38);
            expect(margins.bottom).toBeLessThanOrEqual(200);
            await kernel.prepare(doc);
            const result = layoutDocument(doc, kernel);
            expect(probe.pages).toHaveLength(1);
            expect(result.pages.length).toBe(extra < 0 ? 2 : 1);
            expect(result.pages.flatMap((page) => page.lines)).toHaveLength(context === 'columns' ? 56 : 28);
            expect(result.pages.at(-1)!.lines.length).toBeGreaterThan(0);
            await verifyScenePdf(doc, result, kernel, `tight-${context}-${extra}`);
            if (extra === 0) {
                const intentionalBlank = importDocument(
                    {
                        ...(fixture as object),
                        content: [...content, { type: 'paragraph', attrs: { id: 'intentional-empty' } }],
                    },
                    'intentional-empty',
                );
                await kernel.prepare(intentionalBlank);
                const withBlank = layoutDocument(intentionalBlank, kernel);
                expect(withBlank.pages).toHaveLength(2);
                expect(withBlank.pages.at(-1)!.lines.at(-1)!.paragraphId).toBe('intentional-empty');
            }
        },
    );
});
