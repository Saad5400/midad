// @vitest-environment node
import { emptyWritingPosition, NativeNavigation } from '@saad5400/midad/browser';
import { exportDocument, importDocument, isRecord, type Json } from '@saad5400/midad/document';
import { blockText, textBlocks } from '@saad5400/midad/editing';
import { layoutDocument } from '@saad5400/midad/layout';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import CanvasKitInit from 'canvaskit-wasm';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import interlocking from '../fixtures/layout-contract/interlocking.json';
import { LAB_IMAGE } from '../fixtures/migrationCorpus';
import { makeNestedRichFixture } from '../fixtures/nativeDocument';
import { verifyScenePdf, writeRasterCanaries } from '../fixtures/pdfGeometry';

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
    it.each(
        ['top', 'middle', 'bottom'].flatMap((alignment) =>
            [0, 12, 20].flatMap((before) =>
                ['portrait', 'landscape'].map((orientation) => ({ alignment, before, orientation })),
            ),
        ),
    )(
        'positions short text within an aligned multi-page merged cell ($alignment, $before, $orientation)',
        async ({ alignment, before, orientation }) => {
            const document = importDocument(
                {
                    type: 'doc',
                    attrs: { dir: 'ltr', pageLayout: { orientation } },
                    content: [
                        ...Array.from({ length: before }, (_, index) => paragraph(`align-before-${index}`, 'Spacer')),
                        {
                            type: 'table',
                            content: [
                                {
                                    type: 'tableRow',
                                    content: [
                                        {
                                            type: 'tableCell',
                                            content: [
                                                columns(
                                                    'align-columns',
                                                    Array.from({ length: 60 }, (_, index) =>
                                                        paragraph(`align-left-${index}`, 'Filling'),
                                                    ),
                                                    Array.from({ length: 40 }, (_, index) =>
                                                        paragraph(`align-right-${index}`, 'Filling'),
                                                    ),
                                                ),
                                            ],
                                        },
                                        {
                                            type: 'tableCell',
                                            attrs: { id: 'aligned-cell', rowspan: 2, verticalAlign: alignment },
                                            content: [paragraph('aligned-target', 'Aligned')],
                                        },
                                    ],
                                },
                                {
                                    type: 'tableRow',
                                    content: [{ type: 'tableCell', content: [paragraph('align-final', 'Last row')] }],
                                },
                            ],
                        },
                    ],
                },
                'aligned-flow',
            );
            await kernel.prepare(document);
            const scene = layoutDocument(document, kernel);
            const full = scene.pages[0].height - 144;
            const boxes = scene.pages.flatMap((page, index) =>
                (page.cells ?? [])
                    .filter((cell) => cell.cellId === 'aligned-cell')
                    .map((cell) => ({
                        start: index * full + cell.y - 72,
                        end: index * full + cell.y + cell.height - 72,
                    })),
            );
            const line = scene.pages.flatMap((page, index) =>
                page.lines
                    .filter((line) => line.paragraphId === 'aligned-target')
                    .map((line) => ({ top: index * full + line.top - 72, height: line.height })),
            );
            expect(line).toHaveLength(1);
            const start = Math.min(...boxes.map((box) => box.start)) + 6;
            const end = Math.max(...boxes.map((box) => box.end)) - 12 - line[0].height;
            const target = alignment === 'top' ? start : alignment === 'bottom' ? end : (start + end) / 2;
            const fits = (target % full) + line[0].height <= full;
            if (fits) expect(line[0].top).toBeCloseTo(target, 2);
            else expect(Math.abs(line[0].top - target)).toBeLessThanOrEqual(line[0].height);
        },
    );
    it.each(
        ['ltr', 'rtl'].flatMap((dir) =>
            ['top', 'middle', 'bottom'].flatMap((alignment) =>
                ['portrait', 'landscape'].flatMap((orientation) =>
                    [false, true].map((nested) => ({ dir, alignment, orientation, nested })),
                ),
            ),
        ),
    )(
        'contains aligned mixed content in continued merged cells ($dir, $alignment, $orientation, nested $nested)',
        async ({ dir, alignment, orientation, nested }) => {
            const source = structuredClone(interlocking) as Json;
            const visit = (node: Json): void => {
                if (!isRecord(node)) return;
                const attrs = isRecord(node.attrs) ? node.attrs : {};
                if (node.type === 'tableCell') attrs.verticalAlign = alignment;
                if (attrs.id === 'd-ar-0')
                    node.content = [
                        ...(node.content as Json[]),
                        { type: 'image', attrs: { id: 'flow-image', src: LAB_IMAGE, width: 24, height: 8 } },
                        {
                            type: 'variable',
                            attrs: {
                                id: 'flow-field',
                                type: 'text',
                                name: 'Flow field',
                                value: 'X',
                                display: 'inline',
                                width: 18,
                                height: 16,
                                settings: { fontFamily: 'Arial', fontSize: 8 },
                            },
                        },
                    ];
                if (attrs.id === 'd' && nested) node.content = [table('flow-wrapper', node.content as Json[])];
                node.attrs = attrs;
                if (Array.isArray(node.content)) node.content.forEach(visit);
            };
            visit(source);
            if (!isRecord(source) || !isRecord(source.attrs)) throw new Error('Invalid fixture');
            source.attrs.dir = dir;
            source.attrs.pageLayout = { orientation };
            const document = importDocument(source, 'mixed-flow');
            await kernel.prepare(document);
            const scene = layoutDocument(document, kernel);
            for (const page of scene.pages)
                for (const line of page.lines) {
                    expect(line.top, line.paragraphId).toBeGreaterThanOrEqual(72 - 0.002);
                    expect(line.top + line.height, line.paragraphId).toBeLessThanOrEqual(page.height - 72 + 0.002);
                    const row = line.shaped.lines.find((entry) => Math.abs(entry.top - line.originalTop) < 0.002)!;
                    if (line.cellId)
                        expect(
                            page.cells?.some(
                                (cell) =>
                                    cell.cellId === line.cellId &&
                                    line.top >= cell.y - 0.002 &&
                                    line.top + line.height <= cell.y + cell.height + 0.002 &&
                                    (line.left ?? 0) + row.left >= cell.x - 0.002 &&
                                    (line.left ?? 0) + row.left + row.width <= cell.x + cell.width + 0.002,
                            ),
                            line.paragraphId,
                        ).toBe(true);
                }
            for (const block of textBlocks(document.root)) {
                const visible = scene.pages
                    .flatMap((page) => page.lines)
                    .filter((line) => line.paragraphId === block.id)
                    .map((line) => {
                        const row = line.shaped.lines.find((entry) => Math.abs(entry.top - line.originalTop) < 0.002)!;
                        return line.shaped.text.slice(row.start, row.endWithBreak);
                    })
                    .join('');
                expect(visible, block.id).toBe(blockText(block));
            }
            expect(
                scene.pages.flatMap((page) => page.commands).filter((command) => command.kind === 'image'),
            ).toHaveLength(1);
            expect(
                scene.pages.flatMap((page) => page.commands).filter((command) => command.kind === 'field'),
            ).toHaveLength(1);
            const fixture = dir === 'rtl' && alignment === 'bottom' && orientation === 'landscape' && nested;
            if (fixture && process.env.NATIVE_FIDELITY_ARTIFACTS) {
                await mkdir(process.env.NATIVE_FIDELITY_ARTIFACTS, { recursive: true });
                await writeFile(
                    `${process.env.NATIVE_FIDELITY_ARTIFACTS}/mixed-flow.fixture.json`,
                    JSON.stringify(exportDocument(document)),
                );
            }
            await verifyScenePdf(document, scene, kernel, fixture ? 'mixed-flow' : 'mixed-flow-case');
        },
    );
    it.each(['ltr', 'rtl'].flatMap((dir) => [0, 10, 20, 30].map((before) => ({ dir, before }))))(
        'uses available page space before continuing nested merged-cell columns ($dir, $before)',
        async ({ dir, before }) => {
            const source = structuredClone(interlocking);
            const leading = source.content.filter((node) => node.attrs?.id?.startsWith('before-'));
            source.attrs.dir = dir;
            source.content = [
                ...Array.from({ length: before }, (_, index) => ({
                    ...structuredClone(leading[index % leading.length]),
                    attrs: { ...leading[index % leading.length].attrs, id: `before-${index}`, dir },
                })),
                ...source.content.filter((node) => !node.attrs?.id?.startsWith('before-')),
            ];
            const document = importDocument(source as Json, 'nested-flow-space');
            await kernel.prepare(document);
            const scene = layoutDocument(document, kernel);
            const first = scene.pages.findIndex((page) => page.lines.some((line) => line.paragraphId === 'd-ar-0'));
            expect(first).toBeGreaterThanOrEqual(0);
            if (!first) return;
            const previous = scene.pages[first - 1];
            const bottom = Math.max(...previous.lines.map((line) => line.top + line.height));
            expect(previous.height - 72 - bottom).toBeLessThan(80);
        },
    );
    it.each(['Arial', 'Amiri'])('exports marked Arabic with every font treatment (%s)', async (family) => {
        const text = 'السَّلَامُ عَلَيْكُمْ بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ á ë ffi';
        const doc = importDocument(
            {
                type: 'doc',
                content: [[], ['bold'], ['italic'], ['bold', 'italic']].map((styles) => ({
                    type: 'paragraph',
                    attrs: { dir: 'rtl' },
                    content: [
                        {
                            type: 'text',
                            text,
                            marks: [
                                { type: 'textStyle', attrs: { fontFamily: family, fontSize: '32px' } },
                                ...styles.map((type) => ({ type })),
                            ],
                        },
                    ],
                })),
            },
            `marked-${family}`,
        );
        await kernel.prepare(doc);
        const result = layoutDocument(doc, kernel);
        expect(
            result.pages
                .flatMap((page) => page.commands)
                .filter((command) => 'glyphs' in command)
                .some((command) => 'glyphs' in command && command.text.some((text) => !text)),
        ).toBe(true);
        await verifyScenePdf(doc, result, kernel, `marked-${family.toLowerCase()}`);
        await writeRasterCanaries(doc, result, kernel, `marked-${family.toLowerCase()}`);
    });
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
                            command.x <= cell.x + 0.002 &&
                            command.toX >= cell.x + cell.width - 0.002 &&
                            near(command.y, bottom) &&
                            near(command.toY, bottom),
                    ),
                    cell.cellId,
                ).toBe(true);
            }
    });
    it.each(
        ['ltr', 'rtl'].flatMap((dir) =>
            ['plain', 'columns', 'nested'].flatMap((context) =>
                [0, 20, 30].flatMap((before) => [1, 2].map((span) => ({ dir, context, before, span }))),
            ),
        ),
    )(
        'keeps interlocking merged rich cells complete at tight page boundaries ($dir, $context, $before, $span)',
        async ({ dir, context, before, span }) => {
            const lines = (prefix: string, count: number): Json[] =>
                Array.from({ length: count }, (_, index) => ({
                    type: 'paragraph',
                    attrs: { id: `${prefix}-${index}`, dir },
                    content: [
                        {
                            type: 'text',
                            text: `${prefix} ${index} النص العربي Mixed text`,
                            marks: [
                                { type: 'textStyle', attrs: { fontSize: index % 3 ? '14px' : '22px' } },
                                ...(index % 2 ? [{ type: 'bold' }] : []),
                            ],
                        },
                    ],
                }));
            const cell = (id: string, content: Json[], rowspan = 1, colspan = 1): Json => ({
                type: 'tableCell',
                attrs: { id, rowspan, colspan, verticalAlign: 'middle', backgroundColor: '#e7eef9' },
                content,
            });
            const merged: Json = {
                type: 'table',
                attrs: { id: 'interlocking', borderColor: span === 1 ? '#cccccc' : 'rgba(34,68,102,0.5)' },
                content: [
                    {
                        type: 'tableRow',
                        content: [
                            cell('a', lines('a-text', 28), 3, span),
                            cell('b', lines('b-text', 2)),
                            cell('c', lines('c-text', 4), 2),
                        ],
                    },
                    {
                        type: 'tableRow',
                        content: [cell('d', [columns('inside-d', lines('d-ar', 20), lines('d-en', 9))], 3)],
                    },
                    { type: 'tableRow', content: [cell('e', lines('e-text', 8), 2)] },
                    { type: 'tableRow', content: [cell('f', lines('f-text', 6), 1, span)] },
                ],
            };
            const wrapped =
                context === 'plain'
                    ? merged
                    : columns(
                          'outside',
                          [context === 'nested' ? table('wrapper', [merged]) : merged],
                          lines('outside-other', 5),
                      );
            const doc = importDocument(
                { type: 'doc', attrs: { dir }, content: [...lines('before', before), wrapped, ...lines('after', 2)] },
                'tight-interlocking',
            );
            await kernel.prepare(doc);
            const result = layoutDocument(doc, kernel);
            if (
                process.env.NATIVE_FIDELITY_ARTIFACTS &&
                dir === 'rtl' &&
                context === 'columns' &&
                before === 20 &&
                span === 1
            ) {
                await mkdir(process.env.NATIVE_FIDELITY_ARTIFACTS, { recursive: true });
                await writeFile(
                    `${process.env.NATIVE_FIDELITY_ARTIFACTS}/interlocking.fixture.json`,
                    JSON.stringify(exportDocument(doc)),
                );
                await verifyScenePdf(doc, result, kernel, 'interlocking-boundary');
            }
            if (
                process.env.NATIVE_FIDELITY_ARTIFACTS &&
                dir === 'ltr' &&
                context === 'columns' &&
                before === 0 &&
                span === 2
            )
                await verifyScenePdf(doc, result, kernel, 'interlocking-translucent');
            for (const page of result.pages) {
                for (const cell of page.cells ?? [])
                    for (const y of [cell.y, cell.y + cell.height]) {
                        const strokes = page.commands
                            .filter(
                                (command) =>
                                    command.kind === 'line' &&
                                    Math.abs(command.y - y) < 0.002 &&
                                    Math.abs(command.toY - y) < 0.002 &&
                                    (!cell.borderColor ||
                                        command.color.every((value, index) => value === cell.borderColor![index])),
                            )
                            .map((command) =>
                                'toX' in command
                                    ? [Math.min(command.x, command.toX), Math.max(command.x, command.toX)]
                                    : [0, 0],
                            )
                            .sort((a, b) => a[0] - b[0]);
                        let edge = cell.x;
                        for (const [start, end] of strokes) if (start <= edge + 0.002 && end > edge) edge = end;
                        expect(
                            edge,
                            `${cell.cellId} at page ${result.pages.indexOf(page) + 1}, y=${y}`,
                        ).toBeGreaterThanOrEqual(cell.x + cell.width - 0.002);
                    }
                for (const line of page.lines) {
                    expect(line.top, line.paragraphId).toBeGreaterThanOrEqual(72 - 0.002);
                    expect(line.top + line.height, line.paragraphId).toBeLessThanOrEqual(page.height - 72 + 0.002);
                    const shapedLine = line.shaped.lines.find(
                        (entry) => Math.abs(entry.top - line.originalTop) < 0.002,
                    )!;
                    if (line.cellId) {
                        const boxes = page.cells?.filter((cell) => cell.cellId === line.cellId) ?? [];
                        const left = (line.left ?? 0) + shapedLine.left,
                            right = left + shapedLine.width;
                        expect(
                            boxes.some((cell) => left >= cell.x - 0.002 && right <= cell.x + cell.width + 0.002),
                            `Horizontal overflow: ${line.paragraphId}`,
                        ).toBe(true);
                    }
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
            }
            const { textBlocks, blockText } = await import('@saad5400/midad/editing');
            for (const block of textBlocks(doc.root)) {
                const visible = result.pages
                    .flatMap((page) => page.lines)
                    .filter((line) => line.paragraphId === block.id)
                    .map((line) => {
                        const shaped = line.shaped.lines.find(
                            (candidate) => Math.abs(candidate.top - line.originalTop) < 0.002,
                        )!;
                        return line.shaped.text.slice(shaped.start, shaped.endWithBreak);
                    })
                    .join('');
                expect(visible, block.id).toBe(blockText(block));
            }
        },
    );
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
                paragraph(`tight-${index}`, 'Full page العَرَبِيَّةُ'),
            );
            const content =
                context === 'columns'
                    ? [
                          columns(
                              'tight-columns',
                              paragraphs,
                              Array.from({ length: 28 }, (_, index) =>
                                  paragraph(`tight-peer-${index}`, 'Full page العَرَبِيَّةُ'),
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
