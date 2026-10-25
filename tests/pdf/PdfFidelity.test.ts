// @vitest-environment node
import { exportDocument, importDocument } from '@saad5400/midad/document';
import { layoutDocument } from '@saad5400/midad/layout';
import { writeScenePdf } from '@saad5400/midad/pdf';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import CanvasKitInit from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PDFBool, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { CORPUS_CASES, createMigrationFixture } from '../fixtures/migrationCorpus';
import { makeNestedRichFixture } from '../fixtures/nativeDocument';
import { verifyScenePdf } from '../fixtures/pdfGeometry';

let kernel: NativeTextKernel;
let transparentImage: string;
beforeAll(async () => {
    const require = createRequire(import.meta.url);
    kernel = await NativeTextKernel.withAssets(
        await CanvasKitInit({ wasmBinary: await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')) }),
        async (font) => new Uint8Array(await readFile(`assets/fonts/${font}.ttf`)),
        async (source) => ({ bytes: new Uint8Array(Buffer.from(source.slice(source.indexOf(',') + 1), 'base64')) }),
    );
    const surface = kernel.ck.MakeSurface(128, 64)!;
    const paint = new kernel.ck.Paint();
    try {
        const canvas = surface.getCanvas();
        canvas.clear(kernel.ck.TRANSPARENT);
        for (let y = 0; y < 64; y += 8)
            for (let x = 0; x < 128; x += 8) {
                paint.setColor(kernel.ck.Color4f(x / 128, y / 64, 0.4, (x + y) % 24 ? 1 : 0.5));
                canvas.drawRect(kernel.ck.XYWHRect(x + 1, y + 1, 6, 6), paint);
            }
        surface.flush();
        const snapshot = surface.makeImageSnapshot();
        try {
            transparentImage = `data:image/png;base64,${Buffer.from(snapshot.encodeToBytes()!).toString('base64')}`;
        } finally {
            snapshot.delete();
        }
    } finally {
        paint.delete();
        surface.delete();
    }
});

it.each(
    [595, 1900].flatMap((width) =>
        [0, 0.1].flatMap((offset) => [false, true].map((italic) => ({ width, offset, italic }))),
    ),
)(
    'preserves exact mixed-script glyph coordinates at $width pt, offset $offset, italic $italic',
    async ({ width, offset, italic }) => {
        const document = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        attrs: { id: 'precise-text', dir: 'rtl' },
                        content: [
                            {
                                type: 'text',
                                text: 'نَصٌّ بالعربية á office किंक्र',
                                marks: [
                                    { type: 'textStyle', attrs: { fontFamily: 'Amiri' } },
                                    { type: 'bold' },
                                    ...(italic ? [{ type: 'italic' }] : []),
                                ],
                            },
                        ],
                    },
                ],
            },
            'precise-pdf',
        );
        await kernel.prepare(document);
        const scene = layoutDocument(document, kernel, width);
        const positioned = {
            ...scene,
            pages: scene.pages.map((page) => ({
                ...page,
                commands: page.commands.map((command) =>
                    'glyphs' in command
                        ? { ...command, positions: command.positions.map((value) => value + offset) }
                        : command,
                ),
            })),
        };
        await verifyScenePdf(document, positioned, kernel, 'precise-pdf');
    },
);

it.each(['inline', 'floating', 'stamp'].flatMap((kind) => [40, 128, 200.5].map((width) => ({ kind, width }))))(
    'keeps transparent $kind image sampling consistent at $width px',
    async ({ kind, width }) => {
        const attrs = { id: 'sample-image', src: transparentImage, x: 100, y: 100, width, height: width / 2 };
        const fixture = {
            type: 'doc',
            attrs: { floatingImages: kind === 'floating' ? [attrs] : [] },
            content: [
                {
                    type: 'paragraph',
                    content: [
                        ...(kind === 'inline' ? [{ type: 'image', attrs }] : []),
                        ...(kind === 'stamp'
                            ? [{ type: 'variable', attrs: { ...attrs, type: 'stamp', value: transparentImage } }]
                            : []),
                        { type: 'text', text: 'Image sampling صورة' },
                    ],
                },
            ],
        };
        const document = importDocument(fixture, `image-${kind}-${width}`);
        await kernel.prepare(document);
        const scene = layoutDocument(document, kernel);
        expect(scene.pages.flatMap((page) => page.commands).filter((command) => command.kind === 'image')).toHaveLength(
            1,
        );
        const pdf = await PDFDocument.load(await writeScenePdf(scene, kernel, () => document));
        const images = pdf.context
            .enumerateIndirectObjects()
            .map(([, object]) => object)
            .filter(
                (object): object is PDFRawStream =>
                    object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'),
            );
        expect(images).toHaveLength(2);
        expect(images.every((image) => image.dict.get(PDFName.of('Interpolate')) === PDFBool.True)).toBe(true);
        await verifyScenePdf(document, scene, kernel, `image-${kind}-${width}`);
    },
);
afterAll(() => kernel?.destroy());

it.each(CORPUS_CASES)('preserves the mixed-content export corpus ($id)', async ({ id }) => {
    const fixture = createMigrationFixture(id, 1);
    const document = importDocument(fixture, `pdf-corpus-${id}`);
    await kernel.prepare(document);
    const scene = layoutDocument(document, kernel);
    expect(scene.glyphCount).toBeGreaterThan(0);
    expect(exportDocument(document)).toEqual(fixture);
    await verifyScenePdf(document, scene, kernel, `corpus-${id}`);
});

it.each(Array.from({ length: 8 }, (_, seed) => seed))('preserves seeded nested rich layouts (%i)', async (seed) => {
    const fixture = makeNestedRichFixture() as { type: string; attrs?: object; content: unknown[] };
    fixture.attrs = {
        dir: seed % 2 ? 'rtl' : 'ltr',
        pageLayout: {
            orientation: seed % 4 < 2 ? 'portrait' : 'landscape',
            margins: { top: 72 + seed * 3, right: 96, bottom: 96, left: 72 + seed * 4 },
        },
    };
    const document = importDocument(fixture, `pdf-seed-${seed}`);
    await kernel.prepare(document);
    const started = performance.now();
    const scene = layoutDocument(document, kernel);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(scene.glyphCount).toBeGreaterThan(0);
    expect(exportDocument(document)).toEqual(fixture);
    await verifyScenePdf(document, scene, kernel, `seeded-nested-${seed}`);
});
