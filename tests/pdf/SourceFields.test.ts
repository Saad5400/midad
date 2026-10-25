// @vitest-environment node
import { importDocument } from '@saad5400/midad/document';
import { layoutDocumentSurface } from '@saad5400/midad/layout';
import {
    createPdfOverlaySnapshot,
    fillNativePdf,
    pdfSourceFieldBoxes,
    pdfSourcePages,
    writePdfOverlayDocument,
} from '@saad5400/midad/pdf';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import CanvasKitInit from 'canvaskit-wasm';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
    PDFBool,
    PDFDict,
    PDFDocument,
    PDFHexString,
    PDFName,
    PDFNumber,
    PDFString,
    StandardFonts,
    degrees,
} from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, expect, it } from 'vitest';

let kernel: NativeTextKernel;
beforeAll(async () => {
    const require = createRequire(import.meta.url);
    kernel = await NativeTextKernel.withAssets(
        await CanvasKitInit({ wasmBinary: await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')) }),
        async (font) => new Uint8Array(await readFile(`assets/fonts/${font}.ttf`)),
        async () => {
            throw new Error('Unexpected source image');
        },
    );
});
afterAll(() => kernel?.destroy());

it('keeps preview snapshots free of orphaned native cover widgets', async () => {
    const f = await fixture(true),
        document = f.document(false);
    await kernel.prepare(document);
    const scene = layoutDocumentSurface(document, kernel, { kind: 'pdf', pages: f.pages });
    const preview = await PDFDocument.load(
        await createPdfOverlaySnapshot(f.bytes, scene, kernel, () => document, f.pages),
    );
    expect(
        preview
            .getForm()
            .getFields()
            .map((field) => field.getName()),
    ).toEqual(['original']);
    expect(preview.getPage(0).node.Annots()).toBeUndefined();
});

it('refuses a native field that shadows an original source form field', async () => {
    const f = await fixture(false),
        original = f.document(false);
    const fields = original.root.attributes!.blockVariables as readonly Record<string, unknown>[];
    const document = {
        ...original,
        root: {
            ...original.root,
            attributes: {
                ...original.root.attributes,
                blockVariables: fields.map((field, index) => (index ? field : { ...field, id: 'original' })),
            },
        },
    } as typeof original;
    await kernel.prepare(document);
    const scene = layoutDocumentSurface(document, kernel, { kind: 'pdf', pages: f.pages });
    await expect(writePdfOverlayDocument(f.bytes, scene, kernel, () => document, f.pages)).rejects.toThrow('conflicts');
    expect((await PDFDocument.load(f.bytes)).getForm().getFields()).toHaveLength(1);
});

it('does not silently freeze stale source form appearances or discard their current values', async () => {
    const f = await fixture(false),
        source = await PDFDocument.load(f.bytes);
    source
        .getForm()
        .getTextField('original')
        .acroField.dict.set(PDFName.of('V'), PDFHexString.fromText('New value with old appearance'));
    source.catalog.lookup(PDFName.of('AcroForm'), PDFDict).set(PDFName.of('NeedAppearances'), PDFBool.True);
    const bytes = await source.save({ updateFieldAppearances: false });
    const document = f.document(false);
    await kernel.prepare(document);
    const scene = layoutDocumentSurface(document, kernel, { kind: 'pdf', pages: f.pages });
    await expect(pdfSourcePages(bytes, ['field-0'])).rejects.toThrow('Resolve source form appearances');
    await expect(writePdfOverlayDocument(bytes, scene, kernel, () => document, f.pages)).rejects.toThrow(
        'Resolve source form appearances',
    );
    const preview = await PDFDocument.load(
        await createPdfOverlaySnapshot(bytes, scene, kernel, () => document, f.pages),
    );
    expect(preview.catalog.lookup(PDFName.of('AcroForm'), PDFDict).lookup(PDFName.of('NeedAppearances'))).toBe(
        PDFBool.True,
    );
    expect(preview.getForm().getTextField('original').getText()).toBe('New value with old appearance');
});

async function fixture(cover: boolean) {
    const pdf = await PDFDocument.create();
    for (let index = 0; index < 8; index++) {
        const page = pdf.addPage([400, 600]);
        page.setCropBox(10, 20, 300, 400);
        page.setRotation(degrees((index % 4) * 90));
        if (index >= 4) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
        page.drawLine({ start: { x: 20, y: 40 }, end: { x: 290, y: 390 }, thickness: 0.25 });
    }
    const original = pdf.getForm().createTextField('original');
    original.setText('Original source field');
    original.addToPage(pdf.getPage(0), { x: 20, y: 40, width: 160, height: 20 });
    const sourceFont = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.catalog
        .lookup(PDFName.of('AcroForm'), PDFDict)
        .set(PDFName.of('DR'), pdf.context.obj({ Font: { MidadForm0: sourceFont.ref, Helvetica: sourceFont.ref } }));
    const bytes = await pdf.save();
    const pages = await pdfSourcePages(bytes);
    const document = (filled: boolean) =>
        importDocument(
            {
                type: 'doc',
                attrs: {
                    nativePresentation: { cover: { enabled: cover, src: null }, header: { enabled: false, src: null } },
                    blockVariables: [
                        ...pages.map((page, index) => ({
                            id: `field-${index}`,
                            type: 'text',
                            name: `Field ${index}`,
                            value: filled ? `قيمة ${index} ABC` : '',
                            settings: {
                                page: page.number,
                                relativeXPct: 0.2,
                                relativeYPct: 0.3,
                                widthPct: 0.4,
                                heightPct: 0.15,
                                fontFamily: 'Amiri',
                                fontSize: '16px',
                                direction: 'rtl',
                                textAlign: 'right',
                            },
                        })),
                        ...(cover
                            ? [
                                  {
                                      id: 'cover',
                                      type: 'text',
                                      name: 'Cover',
                                      surface: 'cover',
                                      x: 80,
                                      y: 100,
                                      width: 180,
                                      height: 40,
                                      value: filled ? 'Cover value' : '',
                                      settings: { fontFamily: 'Amiri', fontSize: '16px' },
                                  },
                              ]
                            : []),
                    ],
                },
                content: pages.map((page) => ({ type: 'pdfPage', attrs: { number: page.number } })),
            },
            'source-fields',
        );
    return { bytes, pages, document };
}

it.each([false, true])(
    'exports and incrementally fills real fields on rotated/cropped/UserUnit source pages (cover %s)',
    async (cover) => {
        const f = await fixture(cover),
            document = f.document(false);
        await kernel.prepare(document);
        const scene = layoutDocumentSurface(document, kernel, { kind: 'pdf', pages: f.pages });
        const started = performance.now();
        const exported = await writePdfOverlayDocument(f.bytes, scene, kernel, () => document, f.pages);
        expect(performance.now() - started).toBeLessThan(5000);
        const parsed = await PDFDocument.load(exported);
        const boxes = pdfSourceFieldBoxes(scene, f.pages);
        for (const box of boxes) {
            const rect = parsed.getForm().getTextField(box.id).acroField.getWidgets()[0].getRectangle();
            expect(box.pdfBox).toEqual([rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]);
            expect(box.pdfRotation).toBe(box.id === 'cover' ? 0 : (Number(box.id.slice(-1)) % 4) * 90);
        }
        expect(parsed.getForm().getTextField('original').getText()).toBe('Original source field');
        expect(parsed.getForm().getFields()).toHaveLength(9 + Number(cover));
        const fonts = parsed.catalog
            .lookup(PDFName.of('AcroForm'), PDFDict)
            .lookup(PDFName.of('DR'), PDFDict)
            .lookup(PDFName.of('Font'), PDFDict);
        for (const field of parsed
            .getForm()
            .getFields()
            .filter((field) => field.getName() !== 'original')) {
            const da = field.acroField.dict.lookup(PDFName.of('DA'), PDFString).asString();
            const font = /^\/([^\s]+)/.exec(da)![1];
            expect(fonts.has(PDFName.of(font))).toBe(true);
            expect(font).not.toBe('MidadForm0');
        }
        const reader = await getDocument({ data: new Uint8Array(exported) }).promise;
        try {
            for (const [index, scenePage] of scene.pages.entries()) {
                const page = await reader.getPage(index + 1),
                    viewport = page.getViewport({ scale: 1 });
                const annotations = await page.getAnnotations();
                for (const command of scenePage.commands) {
                    if (command.kind !== 'field') continue;
                    const annotation = annotations.find((entry) => entry.fieldName === command.nodeId)!;
                    expect(annotation).toBeDefined();
                    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(annotation.rect);
                    expect(Math.min(x1, x2)).toBeCloseTo(command.x, 6);
                    expect(Math.min(y1, y2)).toBeCloseTo(command.y, 6);
                    expect(Math.abs(x2 - x1)).toBeCloseTo(command.width, 6);
                    expect(Math.abs(y2 - y1)).toBeCloseTo(command.height, 6);
                }
            }
        } finally {
            await reader.destroy();
        }
        const filled = f.document(true);
        await kernel.prepare(filled);
        const ids = [...f.pages.map((_, index) => `field-${index}`), ...(cover ? ['cover'] : [])];
        const fillStarted = performance.now();
        const result = await fillNativePdf(exported, filled, kernel, ids);
        expect(performance.now() - fillStarted).toBeLessThan(5000);
        expect(result.bytes.subarray(0, exported.length)).toEqual(exported);
        const after = await PDFDocument.load(result.bytes);
        expect((await fillNativePdf(result.bytes, filled, kernel, ids)).bytes).toEqual(result.bytes);
        for (const id of ids) {
            expect(after.getForm().getTextField(id).isReadOnly()).toBe(true);
            expect(after.getForm().getTextField(id).getText()).toBe(
                id === 'cover' ? 'Cover value' : `قيمة ${id.slice(-1)} ABC`,
            );
        }
        const artifacts = process.env.NATIVE_FIDELITY_ARTIFACTS;
        if (artifacts) {
            await mkdir(artifacts, { recursive: true });
            const expected = layoutDocumentSurface(filled, kernel, { kind: 'pdf', pages: f.pages });
            await writeFile(join(artifacts, `source-filled-${cover}.pdf`), result.bytes);
            await writeFile(
                join(artifacts, `source-expected-${cover}.pdf`),
                await writePdfOverlayDocument(f.bytes, expected, kernel, () => filled, f.pages),
            );
        }
    },
);
