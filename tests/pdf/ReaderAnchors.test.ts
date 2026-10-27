// @vitest-environment node
import { importClmDocument } from '@saad5400/midad/document';
import { NativeTextKernel } from '@saad5400/midad/kernel';
import { layoutDocument } from '@saad5400/midad/layout';
import { writeScenePdf } from '@saad5400/midad/pdf';
import { sceneReviewMap } from '@saad5400/midad/pdf-review';
import {
    PdfSource,
    decodeReviewMap,
    mappedReviewLocations,
    pdfAnnotations,
    pdfPageText,
    readPdfResponse,
    reviewLocationValid,
    textReviewLocations,
    type EncodedPdfReviewMap,
    type PdfReviewData,
    type PdfReviewLocation,
} from '@saad5400/midad/pdf/reading';
import CanvasKitInit from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFString, StandardFonts, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LAB_IMAGE, createMigrationFixture } from '../fixtures/migrationCorpus';
import { makeNativeFixture, makeNestedRichFixture, makeOversizedRichFixture } from '../fixtures/nativeDocument';

const require = createRequire(import.meta.url);
describe('frozen PDF review anchors', () => {
    let kernel: NativeTextKernel;
    beforeAll(async () => {
        const wasmBinary = new Uint8Array(await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')));
        kernel = await NativeTextKernel.withAssets(
            await CanvasKitInit({ wasmBinary } as NonNullable<Parameters<typeof CanvasKitInit>[0]>),
            async (font) => new Uint8Array(await readFile(`assets/fonts/${font}.ttf`)),
            async (source) => {
                if (!source.startsWith('data:image/png;base64,')) throw new Error('Unexpected image');
                return { bytes: new Uint8Array(Buffer.from(source.split(',')[1], 'base64')), mimeType: 'image/png' };
            },
        );
    });
    afterAll(() => kernel?.destroy());
    it.each([
        'English words and العربية 123',
        'يَلْتَزِمُ الطرفُ الأوّل بتقديم الخدمات',
        '\tFee ten\u00a0 and  spaces\nSecond line',
    ])('binds exact source offsets and frozen PDF text spans for %s', async (text) => {
        const doc = importClmDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        attrs: { id: 'legacy', nativeId: 'canonical', dir: 'rtl' },
                        content: [{ type: 'text', text }],
                    },
                ],
            },
            'review',
        );
        await kernel.prepare(doc);
        const scene = layoutDocument(doc, kernel);
        const map = sceneReviewMap(doc, scene);
        expect(map.blocks[0].aliases).toEqual(['canonical', 'legacy']);
        const pdf = await getDocument({ data: await writeScenePdf(scene, kernel, () => doc), useSystemFonts: false })
            .promise;
        try {
            for (const row of map.rows) {
                const data = await pdfPageText(await pdf.getPage(row.page), true);
                expect(data.rows[row.row]).toHaveLength(row.parts.length);
                row.parts.forEach((part, index) =>
                    expect(map.blocks[0].text.slice(part.from, part.to)).toBe(data.rows[row.row][index].text),
                );
            }
        } finally {
            await pdf.destroy();
        }
    });
    const paragraph = (id: string, text: string, attrs = {}) => ({
        type: 'paragraph',
        attrs: { id, ...attrs },
        content: text ? [{ type: 'text', text }] : [],
    });
    async function frozen(content: unknown) {
        const doc = importClmDocument(content, 'review-cases');
        const layoutStarted = performance.now();
        await kernel.prepare(doc);
        const scene = layoutDocument(doc, kernel);
        expect(performance.now() - layoutStarted).toBeLessThan(5000);
        const started = performance.now();
        const map = sceneReviewMap(doc, scene);
        expect(performance.now() - started).toBeLessThan(1000);
        const exportStarted = performance.now();
        const pdf = await getDocument({ data: await writeScenePdf(scene, kernel, () => doc), useSystemFonts: false })
            .promise;
        expect(performance.now() - exportStarted).toBeLessThan(5000);
        try {
            const readingStarted = performance.now();
            const pages = new Array<Awaited<ReturnType<typeof pdfPageText>>>(pdf.numPages);
            let next = 1;
            await Promise.all(
                Array.from({ length: Math.min(4, pdf.numPages) }, async () => {
                    while (next <= pdf.numPages) {
                        const page = next++;
                        pages[page - 1] = await pdfPageText(await pdf.getPage(page), true);
                    }
                }),
            );
            expect(performance.now() - readingStarted).toBeLessThan(5000);
            return { map, pages };
        } finally {
            await pdf.destroy();
        }
    }
    function picked(location: PdfReviewLocation, pages: Awaited<ReturnType<typeof frozen>>['pages']): string {
        return location.pieces
            .map((piece) => pages[piece.page - 1].rows[piece.row!][piece.span].text.slice(piece.from, piece.to))
            .join('');
    }
    it('uses paragraph identity to distinguish identical passages and exposes ambiguity without a map', async () => {
        const { map, pages } = await frozen({
            type: 'doc',
            content: [paragraph('first', 'Fees are due.'), paragraph('second', 'Fees are due.')],
        });
        const locations = mappedReviewLocations(map, { blockIds: ['second'], quote: 'Fees' });
        expect(locations).toHaveLength(1);
        expect(
            locations[0].pieces.every((piece) => piece.row === map.rows.find((row) => row.block === 'second')!.row),
        ).toBe(true);
        expect(picked(locations[0], pages)).toBe('Fees');
        expect(textReviewLocations(pages, { quote: 'Fees' })).toHaveLength(2);
    });
    it('resolves stable containing-block anchors without guessing positional identities', async () => {
        const { map, pages } = await frozen({
            type: 'doc',
            content: [
                paragraph('outside', 'Shared words'),
                {
                    type: 'blockquote',
                    attrs: { id: 'legacy-container' },
                    content: [paragraph('inside', 'Shared words')],
                },
            ],
        });
        const locations = mappedReviewLocations(map, { blockIds: ['legacy-container'], quote: 'Shared words' });
        expect(locations).toHaveLength(1);
        expect(locations[0].pieces[0].row).toBe(map.rows.find((row) => row.block === 'inside')!.row);
        expect(picked(locations[0], pages)).toBe('Shared words');
        expect(mappedReviewLocations(map, { blockIds: ['paragraph:0'], quote: 'Shared words' })).toEqual([]);
    });
    it('honors a captured offset after trimming selected whitespace', async () => {
        const text = 'fee first;  fee second';
        const { map, pages } = await frozen({ type: 'doc', content: [paragraph('repeat', text)] });
        const locations = mappedReviewLocations(map, {
            blockIds: ['repeat'],
            quote: 'fee',
            offset: text.indexOf('  fee'),
            text,
        });
        expect(locations).toHaveLength(1);
        expect(picked(locations[0], pages)).toBe('fee');
        expect(locations[0].pieces[0].from).toBe(text.lastIndexOf('fee'));
    });
    it('uses surviving context when earlier text in the paragraph changed', async () => {
        const old = 'alpha fee omega; beta fee gamma',
            text = 'alpha amended fee omega; beta fee gamma';
        const { map, pages } = await frozen({ type: 'doc', content: [paragraph('changed', text)] });
        const locations = mappedReviewLocations(map, {
            blockIds: ['changed'],
            quote: 'fee',
            offset: old.lastIndexOf('fee'),
            text: old,
            prefix: 'beta',
            suffix: 'gamma',
        });
        expect(locations).toHaveLength(1);
        expect(picked(locations[0], pages)).toBe('fee');
        expect(locations[0].pieces[0].from).toBe(text.lastIndexOf('fee'));
    });
    it('retains exact word ranges across style fragments, combining marks and canonical Unicode', async () => {
        const { map, pages } = await frozen({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    attrs: { id: 'styled' },
                    content: [
                        { type: 'text', text: 'ال' },
                        { type: 'text', text: 'طَرَف', marks: [{ type: 'bold' }] },
                        { type: 'text', text: ' الأوّل café' },
                    ],
                },
            ],
        });
        const locations = mappedReviewLocations(map, { blockIds: ['styled'], quote: 'الطَرَف الأوّل cafe\u0301' });
        expect(locations).toHaveLength(1);
        expect(picked(locations[0], pages)).toBe('الطَرَف الأوّل café');
        expect(reviewLocationValid(locations[0], new Map(pages.map((page, index) => [index + 1, page])))).toBe(true);
    });
    it('rejects anchor metadata whose text or physical bounds no longer match the frozen PDF', async () => {
        const { map, pages } = await frozen({ type: 'doc', content: [paragraph('checked', 'Exact visible passage')] });
        const locations = mappedReviewLocations(map, { blockIds: ['checked'], quote: 'Exact' });
        const data = new Map(pages.map((page, index) => [index + 1, page]));
        expect(reviewLocationValid(locations[0], data)).toBe(true);
        const wrong = {
            ...locations[0],
            pieces: locations[0].pieces.map((piece) => ({ ...piece, pdfBox: piece.pdfBox!.map((value) => value + 2) })),
        };
        expect(reviewLocationValid(wrong, data)).toBe(false);
        expect(
            reviewLocationValid(
                { ...locations[0], pieces: [{ ...locations[0].pieces[0], source: 'Different text' }] },
                data,
            ),
        ).toBe(false);
    });
    it('supports notes spanning paragraphs and does not invent a target for removed blocks', async () => {
        const { map, pages } = await frozen({
            type: 'doc',
            content: [paragraph('a', 'First passage'), paragraph('b', 'Second passage')],
        });
        const locations = mappedReviewLocations(map, { blockIds: ['a'], quote: 'passage\nSecond' });
        expect(locations).toHaveLength(1);
        expect(picked(locations[0], pages).replace(/\s/g, '')).toBe('passageSecond');
        expect(mappedReviewLocations(map, { blockIds: ['removed'], quote: 'Not present' })).toEqual([]);
        const changed = mappedReviewLocations(map, { blockIds: ['a'], quote: 'Old wording' });
        expect(changed[0].exact).toBe(false);
    });
    it('preserves a physical target when an edit leaves a paragraph empty', async () => {
        const { map } = await frozen({ type: 'doc', content: [paragraph('empty', '')] });
        const locations = mappedReviewLocations(map, { blockIds: ['empty'], quote: 'Deleted words', wholeBlock: true });
        expect(locations).toHaveLength(1);
        expect(locations[0].boxes![0].height).toBeGreaterThan(0);
        expect(locations[0].pieces).toEqual([]);
    });
    it('keeps a physical target for a paragraph containing only an inline object', async () => {
        const { map } = await frozen({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    attrs: { id: 'image-only' },
                    content: [{ type: 'image', attrs: { src: LAB_IMAGE, width: 100, height: 50 } }],
                },
            ],
        });
        const locations = mappedReviewLocations(map, { blockIds: ['image-only'], wholeBlock: true });
        expect(locations).toHaveLength(1);
        expect(locations[0].boxes![0].height).toBeGreaterThanOrEqual(37.5);
        expect(locations[0].pieces).toEqual([]);
    });
    it.each([
        ['mixed', () => createMigrationFixture('mixed', 1)],
        ['nested', makeNestedRichFixture],
        ['oversized', makeOversizedRichFixture],
        ['large', () => makeNativeFixture(600)],
    ])(
        'binds every frozen source span in the %s rich corpus',
        async (_, fixture) => {
            const { map, pages } = await frozen(fixture());
            expect(map.rows.length).toBeGreaterThan(5);
            for (const block of map.blocks) {
                const location = mappedReviewLocations(map, { blockIds: [block.id], wholeBlock: true });
                expect(location.length).toBeGreaterThan(0);
                expect(reviewLocationValid(location[0], new Map(pages.map((page, index) => [index + 1, page])))).toBe(
                    true,
                );
            }
        },
        20000,
    );
    it('decodes the review index once, losslessly, and accepts earlier plain metadata', async () => {
        const { map } = await frozen({ type: 'doc', content: [paragraph('encoded', 'مقطع محفوظ ABC 123')] });
        const encoded: EncodedPdfReviewMap = {
            encoding: 'deflate-base64',
            data: deflateSync(JSON.stringify(map)).toString('base64'),
        };
        const first = decodeReviewMap(encoded);
        expect(decodeReviewMap(encoded)).toBe(first);
        expect(await first).toEqual(map);
        expect(await decodeReviewMap(map)).toBe(map);
    });
    it('permits a fresh decode after a failed encoded response', async () => {
        const { map } = await frozen({ type: 'doc', content: [paragraph('retry', 'Recover encoded metadata')] });
        const encoded: EncodedPdfReviewMap = { encoding: 'deflate-base64', data: 'AA==' };
        await expect(decodeReviewMap(encoded)).rejects.toThrow();
        encoded.data = deflateSync(JSON.stringify(map)).toString('base64');
        expect(await decodeReviewMap(encoded)).toEqual(map);
    });
    it('rejects malformed or unsupported review metadata', async () => {
        for (const value of [
            null,
            {},
            { version: 99, blocks: [], rows: [], pages: [] },
            { encoding: 'unknown', data: '' },
        ])
            await expect(decodeReviewMap(value as unknown as PdfReviewData)).rejects.toThrow();
    });
    it('bounds decompressed review metadata before JSON parsing', async () => {
        const encoded: EncodedPdfReviewMap = {
            encoding: 'deflate-base64',
            data: deflateSync('x'.repeat(33 * 1024 * 1024)).toString('base64'),
        };
        await expect(decodeReviewMap(encoded)).rejects.toThrow('size limit');
    });
});

class TestPdfAssets {
    async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
        const folder = kind === 'standardFontDataUrl' ? 'standard_fonts' : kind === 'cMapUrl' ? 'cmaps' : 'wasm';
        return new Uint8Array(
            await readFile(join(dirname(require.resolve('pdfjs-dist/package.json')), folder, filename)),
        );
    }
}
const openSource = (bytes: Uint8Array, signal: AbortSignal) => PdfSource.open(bytes, signal, { assets: TestPdfAssets });

async function sourceFixture(rotation = 0, pages = 1, cropped = false, unit = 1) {
    const pdf = await PDFDocument.create();
    for (let index = 0; index < pages; index++) pdf.addPage([400, 600]);
    const page = pdf.getPage(0);
    page.setRotation(degrees(rotation));
    page.node.set(PDFName.of('UserUnit'), PDFNumber.of(unit));
    if (cropped) page.setCropBox(10, 20, 300, 400);
    const field = pdf.getForm().createTextField('field-name');
    field.addToPage(page, { x: 60, y: 80, width: 100, height: 20, borderWidth: 0 });
    const locked = pdf.getForm().createTextField('locked');
    locked.addToPage(page, { x: 60, y: 120, width: 100, height: 20, borderWidth: 0 });
    locked.enableReadOnly();
    const hidden = pdf.getForm().createTextField('hidden');
    hidden.addToPage(page, { x: 60, y: 160, width: 100, height: 20, borderWidth: 0 });
    hidden.acroField.getWidgets()[0].setFlags(2);
    const annotations = page.node.lookup(PDFName.of('Annots'), PDFArray);
    for (const href of ['https://example.test/path', 'javascript:alert(1)'])
        annotations.push(
            pdf.context.register(
                pdf.context.obj({
                    Type: 'Annot',
                    Subtype: 'Link',
                    Rect: [10, 20, 50, 40],
                    A: { S: 'URI', URI: PDFString.of(href) },
                }),
            ),
        );
    return pdf.save();
}

describe('immutable native PDF source', () => {
    it('extracts document text in page order without requiring mounted page layers', async () => {
        const source = await openSource(await createFrozenSourcePdf(40), new AbortController().signal);
        try {
            const text = await source.plainText();
            expect(text).toContain('Frozen document page 40');
            expect(text.indexOf('Frozen document page 1')).toBeLessThan(text.indexOf('Frozen document page 40'));
        } finally {
            await source.destroy();
        }
    });
    it('reads PDF response chunks exactly and cancels an oversized body before allocating the complete file', async () => {
        const expected = new Uint8Array([1, 2, 3, 4]);
        expect(
            await readPdfResponse(
                new Response(expected, { headers: { 'Content-Type': 'application/pdf' } }),
                new AbortController().signal,
            ),
        ).toEqual(expected);
        let cancelled = false;
        const large = new Uint8Array(31 * 1024 * 1024);
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(large);
                controller.enqueue(large);
            },
            cancel() {
                cancelled = true;
            },
        });
        await expect(
            readPdfResponse(
                new Response(stream, { headers: { 'Content-Type': 'application/pdf' } }),
                new AbortController().signal,
            ),
        ).rejects.toThrow('Invalid PDF size');
        expect(cancelled).toBe(true);
        await expect(
            readPdfResponse(
                new Response('html', { headers: { 'Content-Type': 'text/html' } }),
                new AbortController().signal,
            ),
        ).rejects.toThrow('Invalid PDF response');
    });
    it('keeps source/download bytes unchanged while the PDF parser owns a separate copy', async () => {
        const bytes = await sourceFixture();
        const original = new Uint8Array(bytes);
        const source = await openSource(bytes, new AbortController().signal);
        try {
            expect(bytes).toEqual(original);
            expect(source.bytes()).toEqual(original);
            const copy = source.bytes();
            copy[0] = 0;
            expect(source.bytes()).toEqual(original);
            expect(source.pages).toEqual([{ number: 1, width: 400, height: 600 }]);
            expect(Object.isFrozen(source.pages[0])).toBe(true);
        } finally {
            await source.destroy();
        }
        expect(() => source.bytes()).toThrow('closed');
        await source.destroy();
    });
    it.each([
        { rotation: 0, width: 400, height: 600, x: 60, y: 500, w: 100, h: 20 },
        { rotation: 90, width: 600, height: 400, x: 80, y: 60, w: 20, h: 100 },
        { rotation: 180, width: 400, height: 600, x: 240, y: 80, w: 100, h: 20 },
        { rotation: 270, width: 600, height: 400, x: 500, y: 240, w: 20, h: 100 },
    ])(
        'uses original page rotation $rotation for geometry and widget hit regions',
        async ({ rotation, width, height, x, y, w, h }) => {
            const source = await openSource(await sourceFixture(rotation), new AbortController().signal);
            try {
                expect(source.pages[0]).toEqual({ number: 1, width, height });
                const annotations = await pdfAnnotations(await source.page(1));
                expect(annotations.widgets.find((field) => field.name === 'field-name')).toMatchObject({
                    x,
                    y,
                    width: w,
                    height: h,
                    readOnly: false,
                });
                expect(annotations.widgets.find((field) => field.name === 'locked')?.readOnly).toBe(true);
                expect(annotations.widgets.some((field) => field.name === 'hidden')).toBe(false);
                expect(annotations.links.map((link) => link.href)).toEqual(['https://example.test/path']);
            } finally {
                await source.destroy();
            }
        },
    );
    it('accounts for crop offsets before rotating widget rectangles', async () => {
        const source = await openSource(await sourceFixture(90, 1, true), new AbortController().signal);
        try {
            expect(source.pages[0]).toEqual({ number: 1, width: 400, height: 300 });
            const { widgets } = await pdfAnnotations(await source.page(1));
            expect(widgets[0]).toMatchObject({ x: 60, y: 50, width: 20, height: 100 });
            await expect(source.page(0)).rejects.toThrow('Invalid PDF page');
            await expect(source.page(2)).rejects.toThrow('Invalid PDF page');
        } finally {
            await source.destroy();
        }
    });
    it('scales page and widget geometry by the PDF user unit', async () => {
        const source = await openSource(await sourceFixture(0, 1, false, 2), new AbortController().signal);
        try {
            expect(source.pages[0]).toEqual({ number: 1, width: 800, height: 1200 });
            const { widgets } = await pdfAnnotations(await source.page(1));
            expect(widgets[0]).toMatchObject({ x: 120, y: 1000, width: 200, height: 40 });
        } finally {
            await source.destroy();
        }
    });
    it('opens the complete page geometry of a 600-page PDF within five seconds', async () => {
        const bytes = await sourceFixture(0, 600);
        const started = performance.now();
        const source = await openSource(bytes, new AbortController().signal);
        try {
            expect(source.pages).toHaveLength(600);
            expect(performance.now() - started).toBeLessThan(5000);
        } finally {
            await source.destroy();
        }
    });
    it('cancels opening and closes access after cancellation without changing source bytes', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(openSource(await sourceFixture(), controller.signal)).rejects.toThrow();
        const active = new AbortController();
        const source = await openSource(await sourceFixture(), active.signal);
        active.abort();
        await expect(source.page(1)).rejects.toThrow();
        await source.destroy();
    });
    it('rejects empty, oversized and invalid files instead of displaying a partial document', async () => {
        await expect(openSource(new Uint8Array(), new AbortController().signal)).rejects.toThrow('Invalid PDF size');
        await expect(openSource(new Uint8Array(60 * 1024 * 1024 + 1), new AbortController().signal)).rejects.toThrow(
            'Invalid PDF size',
        );
        await expect(openSource(new TextEncoder().encode('not a PDF'), new AbortController().signal)).rejects.toThrow();
    });
});

async function createFrozenSourcePdf(pages = 3): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let index = 0; index < pages; index++) {
        const page = pdf.addPage(index % 2 ? [600, 400] : [400, 600]);
        if (index % 3 === 1) page.setRotation(degrees(90));
        if (index % 3 === 2) {
            page.setCropBox(10, 20, 300, 400);
            page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
        }
        page.drawText(`Frozen document page ${index + 1}`, { x: 30, y: page.getHeight() - 60, size: 16, font });
        page.drawText('Selectable words stay aligned.', { x: 30, y: 220, size: 14, font });
    }
    const page = pdf.getPage(0);
    const field = pdf.getForm().createTextField('editable');
    field.addToPage(page, { x: 60, y: 80, width: 180, height: 30, borderWidth: 1 });
    const locked = pdf.getForm().createTextField('completed');
    locked.addToPage(page, { x: 60, y: 130, width: 180, height: 30, borderWidth: 1 });
    locked.setText('Existing signed revision');
    locked.enableReadOnly();
    page.node.lookup(PDFName.of('Annots'), PDFArray).push(
        pdf.context.register(
            pdf.context.obj({
                Type: 'Annot',
                Subtype: 'Link',
                Rect: [30, 180, 200, 200],
                A: { S: 'URI', URI: PDFString.of('https://example.test/document') },
            }),
        ),
    );
    return pdf.save();
}
