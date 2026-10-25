// @vitest-environment node
import { importDocument } from '@saad5400/midad/document';
import { layoutDocumentSurface, layoutPdfOverlays } from '@saad5400/midad/layout';
import { createPdfOverlaySnapshot, pdfSourcePages } from '@saad5400/midad/pdf';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import CanvasKitInit from 'canvaskit-wasm';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts, degrees, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { LAB_IMAGE } from '../fixtures/migrationCorpus';

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

it('retains encoded source images, text, fonts and fine vector content without rasterizing the background', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([240, 320]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const image = await pdf.embedPng(Buffer.from(LAB_IMAGE.slice(LAB_IMAGE.indexOf(',') + 1), 'base64'));
    page.drawText('Original vector text', { x: 12, y: 280, size: 18, font });
    page.drawImage(image, { x: 30, y: 130, width: 180, height: 60 });
    for (let index = 0; index < 12; index++)
        page.drawLine({
            start: { x: 12, y: 20 + index * 4 },
            end: { x: 225, y: 32 + index * 4 },
            thickness: 0.125,
            color: rgb(0, 0, 0),
        });
    const bytes = await pdf.save();
    const pages = await pdfSourcePages(bytes);
    const document = importDocument(
        { type: 'doc', content: [{ type: 'pdfPage', attrs: { number: 1 } }] },
        'quality-source',
    );
    await kernel.prepare(document);
    const scene = layoutDocumentSurface(document, kernel, { kind: 'pdf', pages });
    const started = performance.now();
    const snapshot = await createPdfOverlaySnapshot(bytes, scene, kernel, () => document, pages);
    expect(performance.now() - started).toBeLessThan(5000);
    const before = await PDFDocument.load(bytes);
    const after = await PDFDocument.load(snapshot);
    expect(after.getPage(0).node.Contents()!.toString()).toBe(before.getPage(0).node.Contents()!.toString());
    expect(after.getPage(0).node.Resources()!.toString()).toBe(before.getPage(0).node.Resources()!.toString());
    for (const [reference, object] of before.context.enumerateIndirectObjects()) {
        if (!(object instanceof PDFRawStream) || object.dict.get(PDFName.of('Type')) === PDFName.of('ObjStm')) continue;
        const retained = after.context.lookup(reference);
        expect(retained).toBeInstanceOf(PDFRawStream);
        expect((retained as PDFRawStream).getContents()).toEqual(object.getContents());
    }
    const diagnostics = process.env.NATIVE_FIDELITY_ARTIFACTS;
    if (diagnostics) {
        await mkdir(diagnostics, { recursive: true });
        await writeFile(join(diagnostics, 'import-quality-source.pdf'), bytes);
        await writeFile(join(diagnostics, 'import-quality-snapshot.pdf'), snapshot);
    }
});

async function fixture() {
    const pdf = await PDFDocument.create();
    for (let index = 0; index < 8; index++) {
        const page = pdf.addPage([400, 600]);
        page.setRotation(degrees((index % 4) * 90));
        page.setCropBox(10, 20, 300, 400);
        if (index >= 4) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
        const appearance = pdf.context.register(
            pdf.context.flateStream('1 0 0 rg 10 20 300 400 re f', {
                Type: 'XObject',
                Subtype: 'Form',
                BBox: [10, 20, 310, 420],
                Resources: {},
            }),
        );
        page.node.addAnnot(
            pdf.context.register(
                pdf.context.obj({
                    Type: 'Annot',
                    Subtype: 'Stamp',
                    Rect: [10, 20, 310, 420],
                    F: 4,
                    AP: { N: appearance },
                }),
            ),
        );
    }
    const field = pdf.getForm().createTextField('existing-value');
    field.setText('Original field');
    field.addToPage(pdf.getPage(0), { x: 50, y: 80, width: 160, height: 30 });
    const bytes = await pdf.save();
    const reader = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
    const viewports = await Promise.all(
        Array.from({ length: 8 }, async (_, index) => {
            const viewport = (await reader.getPage(index + 1)).getViewport({ scale: 1 });
            return { width: viewport.width, height: viewport.height, transform: [...viewport.transform] };
        }),
    );
    await reader.destroy();
    const document = importDocument(
        {
            type: 'doc',
            attrs: {
                blockVariables: [
                    {
                        id: 'value',
                        type: 'text',
                        value: 'قيمة عربية Hello',
                        x: 40,
                        y: 120,
                        width: 180,
                        height: 40,
                        settings: { fontFamily: 'Amiri', fontSize: '16px', direction: 'rtl' },
                    },
                ],
                floatingImages: [{ id: 'logo', src: LAB_IMAGE, x: 200, y: 200, width: 80, height: 40 }],
            },
            content: Array.from({ length: 8 }, (_, index) => ({ type: 'pdfPage', attrs: { number: index + 1 } })),
        },
        'overlay-snapshot',
    );
    await kernel.prepare(document);
    const original = layoutPdfOverlays(document, kernel, viewports);
    const scene = {
        ...original,
        pages: original.pages.map((page) => ({
            ...page,
            commands: [
                ...page.commands,
                { kind: 'rect' as const, x: 40, y: 30, width: 60, height: 40, color: [0, 0, 1, 1] as const },
            ],
        })),
    };
    return { bytes, document, scene, viewports };
}

it('retains original page geometry, fields and annotation order without changing source bytes', async () => {
    const { bytes, document, scene, viewports } = await fixture();
    const untouched = new Uint8Array(bytes);
    const result = await createPdfOverlaySnapshot(bytes, scene, kernel, () => document, viewports);
    const diagnostics = process.env.NATIVE_FIDELITY_ARTIFACTS;
    if (diagnostics) {
        await mkdir(diagnostics, { recursive: true });
        await writeFile(join(diagnostics, 'import-mixed-overlays.pdf'), result);
        await writeFile(join(diagnostics, 'import-mixed-viewports.json'), JSON.stringify(viewports));
    }
    expect(bytes).toEqual(untouched);
    expect(scene.glyphCount).toBeGreaterThan(0);
    expect(scene.pages[0].commands.some((command) => command.kind === 'image')).toBe(true);
    const source = await PDFDocument.load(bytes);
    const snapshot = await PDFDocument.load(result);
    expect(snapshot.getForm().getTextField('existing-value').getText()).toBe('Original field');
    for (let index = 0; index < 8; index++) {
        const before = source.getPage(index),
            after = snapshot.getPage(index);
        expect(after.getMediaBox()).toEqual(before.getMediaBox());
        expect(after.getCropBox()).toEqual(before.getCropBox());
        expect(after.getRotation()).toEqual(before.getRotation());
        expect(after.node.get(PDFName.of('UserUnit'))?.toString()).toEqual(
            before.node.get(PDFName.of('UserUnit'))?.toString(),
        );
        expect(after.node.Annots()!.size()).toBe(before.node.Annots()!.size() + 1);
        const last = after.node.Annots()!.lookup(after.node.Annots()!.size() - 1, PDFDict);
        expect(last.get(PDFName.of('Subtype'))).toBe(PDFName.of('Stamp'));
    }
    const reader = await getDocument({ data: result }).promise;
    for (let index = 0; index < 8; index++) {
        const page = await reader.getPage(index + 1);
        expect(page.getViewport({ scale: 1 }).width).toBe(viewports[index].width);
        expect(page.getViewport({ scale: 1 }).height).toBe(viewports[index].height);
        await page.getOperatorList({ intent: 'print' });
    }
    await reader.destroy();
}, 10000);

it.each(['count', 'dimensions', 'singular', 'nonfinite', 'revision', 'translation', 'rotation', 'source-size'])(
    'refuses a mismatched %s instead of producing an incomplete print',
    async (kind) => {
        const { bytes, document, scene, viewports } = await fixture();
        const changed = viewports.map((viewport) => ({ ...viewport }));
        if (kind === 'count') changed.pop();
        if (kind === 'dimensions') changed[0].width++;
        if (kind === 'singular') changed[0].transform = [0, 0, 0, 0, 0, 0];
        if (kind === 'nonfinite') changed[0].transform = [1, 0, 0, -1, NaN, 0];
        if (kind === 'translation') changed[0].transform = [1, 0, 0, -1, 0, 400];
        if (kind === 'rotation') changed[0].transform = [0, 1, 1, 0, -20, -10];
        if (kind === 'source-size') changed[0].width++;
        await expect(
            createPdfOverlaySnapshot(
                bytes,
                kind === 'revision'
                    ? { ...scene, revision: scene.revision + 1 }
                    : kind === 'source-size'
                      ? {
                            ...scene,
                            pages: scene.pages.map((page, index) =>
                                index ? page : { ...page, width: page.width + 1 },
                            ),
                        }
                      : scene,
                kernel,
                () => document,
                changed,
            ),
        ).rejects.toThrow();
    },
);

it('keeps pages with no overlay content and rejects changes during snapshot creation', async () => {
    const { bytes, document, scene, viewports } = await fixture();
    const sparse = { ...scene, pages: scene.pages.map((page, index) => (index ? { ...page, commands: [] } : page)) };
    const result = await createPdfOverlaySnapshot(bytes, sparse, kernel, () => document, viewports);
    expect((await PDFDocument.load(result)).getPageCount()).toBe(8);
    let reads = 0;
    await expect(
        createPdfOverlaySnapshot(
            bytes,
            scene,
            kernel,
            () => (++reads > 2 ? { ...document, revision: document.revision + 1 } : document),
            viewports,
        ),
    ).rejects.toThrow();
});

it.runIf(process.env.NATIVE_PDF_RASTER === '1')(
    'paints overlays above existing annotations for every rotation, crop and UserUnit',
    async () => {
        const { bytes, document, scene, viewports } = await fixture();
        const directory = await mkdtemp(join(tmpdir(), 'midad-overlay-'));
        try {
            const started = performance.now();
            const snapshot = await createPdfOverlaySnapshot(bytes, scene, kernel, () => document, viewports);
            expect(performance.now() - started).toBeLessThan(5000);
            await writeFile(join(directory, 'snapshot.pdf'), snapshot);
            const diagnostics = process.env.NATIVE_FIDELITY_ARTIFACTS;
            if (diagnostics) {
                await mkdir(diagnostics, { recursive: true });
                await writeFile(join(diagnostics, 'overlay-snapshot.pdf'), snapshot);
            }
            execFileSync('pdftoppm', [
                '-r',
                '72',
                '-cropbox',
                '-png',
                join(directory, 'snapshot.pdf'),
                join(directory, 'page'),
            ]);
            for (let index = 0; index < 8; index++) {
                const png = join(directory, `page-${index + 1}.png`);
                if (diagnostics) await copyFile(png, join(diagnostics, `overlay-${index + 1}.png`));
                const image = kernel.ck.MakeImageFromEncoded(await readFile(png))!;
                try {
                    const width = image.width(),
                        height = image.height();
                    const pixels = image.readPixels(0, 0, {
                        width,
                        height,
                        colorType: kernel.ck.ColorType.RGBA_8888,
                        alphaType: kernel.ck.AlphaType.Unpremul,
                        colorSpace: kernel.ck.ColorSpace.SRGB,
                    }) as Uint8Array;
                    const colorAt = (x: number, y: number) => {
                        const at =
                            (Math.floor((y * height) / viewports[index].height) * width +
                                Math.floor((x * width) / viewports[index].width)) *
                            4;
                        return Array.from(pixels.slice(at, at + 3));
                    };
                    expect(colorAt(60, 50), `overlay page ${index + 1}`).toEqual([0, 0, 255]);
                    expect(colorAt(20, 20), `background page ${index + 1}`).toEqual([255, 0, 0]);
                } finally {
                    image.delete();
                }
            }
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    },
    20000,
);
