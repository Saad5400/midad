import { LAB_IMAGE } from '../fixtures/migrationCorpus.js';
// @vitest-environment node
import {
    MARGIN_PRESETS,
    documentPageLayout,
    setDocumentPageLayout,
    setPageLayout,
} from '@saad5400/midad/content/page-layout';
import { importDocument } from '@saad5400/midad/document';
import { layoutDocument } from '@saad5400/midad/layout';
import { writeScenePdf } from '@saad5400/midad/pdf';
import { NativeTextKernel, paintPage } from '@saad5400/midad/rendering';
import CanvasKitInit from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { afterAll, beforeAll, expect, it } from 'vitest';

let kernel: NativeTextKernel;
beforeAll(async () => {
    const require = createRequire(import.meta.url);
    kernel = await NativeTextKernel.withAssets(
        await CanvasKitInit({ wasmBinary: await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')) }),
        async (font) => new Uint8Array(await readFile(`assets/fonts/${font}.ttf`)),
    );
});
afterAll(() => kernel?.destroy());

it('uses the same per-page colors in canvas and PDF and independently hides a footer', async () => {
    const original = importDocument(
        {
            type: 'doc',
            content: Array.from({ length: 150 }, (_, index) => ({
                type: 'paragraph',
                content: [{ type: 'text', text: `Page content ${index} محتوى الصفحة` }],
            })),
        },
        'backgrounds',
    );
    const defaults = setDocumentPageLayout(original, {
        ...documentPageLayout(original),
        background: { color: '#123456' },
    });
    const document = setPageLayout(defaults, 2, { background: { color: '#abcdef' }, footer: false });
    const layoutStarted = performance.now();
    await kernel.prepare(document);
    const scene = layoutDocument(document, kernel);
    expect(performance.now() - layoutStarted).toBeLessThan(5000);
    expect(scene.pages.length).toBeGreaterThan(2);
    for (const [index, page] of scene.pages.entries()) {
        expect(page.background?.[0]).toMatchObject({ kind: 'rect', width: page.width, height: page.height });
        const surface = kernel.ck.MakeSurface(Math.ceil(page.width), Math.ceil(page.height))!;
        try {
            paintPage(kernel, surface, page, 1);
            const image = surface.makeImageSnapshot();
            try {
                const pixels = image.readPixels(0, 0, {
                    width: 1,
                    height: 1,
                    colorType: kernel.ck.ColorType.RGBA_8888,
                    alphaType: kernel.ck.AlphaType.Unpremul,
                    colorSpace: kernel.ck.ColorSpace.SRGB,
                })!;
                expect([...pixels].slice(0, 3)).toEqual(index === 1 ? [171, 205, 239] : [18, 52, 86]);
            } finally {
                image.delete();
            }
        } finally {
            surface.delete();
        }
    }
    const footers = scene.pages.map(
        (page) =>
            page.commands.filter(
                (command) => 'glyphs' in command && command.reading?.some((part) => part.group.startsWith('["footer"')),
            ).length,
    );
    expect(footers[0]).toBeGreaterThan(0);
    expect(footers[1]).toBe(0);
    expect(footers[2]).toBeGreaterThan(0);
    const exportStarted = performance.now();
    const pdf = await PDFDocument.load(await writeScenePdf(scene, kernel, () => document));
    expect(performance.now() - exportStarted).toBeLessThan(5000);
    for (const [index, page] of pdf.getPages().entries()) {
        const contents = page.node.Contents();
        const streams =
            contents instanceof PDFArray ? contents.asArray().map((item) => pdf.context.lookup(item)) : [contents];
        const text = streams
            .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
            .map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode()))
            .join('\n');
        expect(text).toContain(
            index === 1 ? `${171 / 255} ${205 / 255} ${239 / 255} rg` : `${18 / 255} ${52 / 255} ${86 / 255} rg`,
        );
    }
});
it('uses named paper sizes for uniform document pagination and PDF page boxes', async () => {
    const document = setDocumentPageLayout(
        importDocument(
            { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Letter paper' }] }] },
            'paper',
        ),
        { orientation: 'landscape', size: 'letter', margins: MARGIN_PRESETS.normal },
    );
    const layoutStarted = performance.now();
    await kernel.prepare(document);
    const scene = layoutDocument(document, kernel);
    expect(performance.now() - layoutStarted).toBeLessThan(5000);
    expect(scene.pages[0]).toMatchObject({ width: 792, height: 612 });
    const exportStarted = performance.now();
    const pdf = await PDFDocument.load(await writeScenePdf(scene, kernel, () => document));
    expect(performance.now() - exportStarted).toBeLessThan(5000);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 792, height: 612 });
});

it.each(['cover', 'contain', 'stretch'] as const)(
    'prepares page-only background images and shares the %s fit with PDF drawing',
    async (fit) => {
        const document = setPageLayout(
            importDocument(
                {
                    type: 'doc',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text above the background' }] }],
                },
                `background-${fit}`,
            ),
            1,
            { background: { src: LAB_IMAGE, fit } },
        );
        await kernel.prepare(document);
        const scene = layoutDocument(document, kernel);
        const page = scene.pages[0];
        const image = page.background?.find((command) => command.kind === 'image');
        expect(image?.kind).toBe('image');
        if (image?.kind !== 'image') throw new Error('Background image was not prepared');
        if (fit === 'contain') {
            expect(image.width).toBeCloseTo(page.width, 3);
            expect(image.height).toBeLessThan(page.height);
        } else if (fit === 'cover') {
            expect(image.height).toBeCloseTo(page.height, 3);
            expect(image.width).toBeGreaterThan(page.width);
        } else {
            expect(image.width).toBe(page.width);
            expect(image.height).toBe(page.height);
        }
        expect(page.background?.map((command) => command.kind)).toEqual(['clipStart', 'image', 'clipEnd']);
        const exportStarted = performance.now();
        const pdf = await PDFDocument.load(await writeScenePdf(scene, kernel, () => document));
        expect(performance.now() - exportStarted).toBeLessThan(5000);
        expect(pdf.getPage(0).node.Resources()?.toString()).toContain('/XObject');
    },
);
