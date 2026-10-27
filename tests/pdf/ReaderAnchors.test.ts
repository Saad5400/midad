// @vitest-environment node
import { importClmDocument } from '@saad5400/midad/document';
import { NativeTextKernel } from '@saad5400/midad/kernel';
import { layoutDocument } from '@saad5400/midad/layout';
import { writeScenePdf } from '@saad5400/midad/pdf';
import { sceneReviewMap } from '@saad5400/midad/pdf-review';
import {
    decodeReviewMap,
    mappedReviewLocations,
    pdfPageText,
    reviewLocationValid,
    textReviewLocations,
    type EncodedPdfReviewMap,
    type PdfReviewData,
    type PdfReviewLocation,
} from '@saad5400/midad/pdf/reading';
import CanvasKitInit from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
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
