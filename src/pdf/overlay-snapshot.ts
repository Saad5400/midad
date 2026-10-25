import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import type { NativeDocument } from '../document/model.js';
import type { DocumentScene } from '../layout/scene.js';
import { assertSceneRevision } from '../layout/scene.js';
import type { NativeTextKernel } from '../rendering/kernel.js';
import { writeScenePdf } from './document.js';
import { sourcePageViewports, type PdfOverlayViewport } from './source-pages.js';

export type { PdfOverlayViewport } from './source-pages.js';

export async function createPdfOverlaySnapshot(
    original: Uint8Array,
    scene: DocumentScene,
    kernel: NativeTextKernel,
    latestDocument: () => NativeDocument,
    viewports: readonly PdfOverlayViewport[],
): Promise<Uint8Array> {
    const current = () => {
        const document = latestDocument();
        assertSceneRevision(scene, document, () => kernel.fontHashFor(document));
    };
    current();
    const source = await PDFDocument.load(new Uint8Array(original), { updateMetadata: false });
    if (source.getPageCount() !== scene.pages.length || viewports.length !== scene.pages.length)
        throw new Error('The overlay does not match the source PDF pages');
    const expected = sourcePageViewports(source);
    const matrices = viewports.map((viewport, index) => {
        const { width, height, transform: matrix } = viewport;
        if (
            matrix.length !== 6 ||
            !matrix.every(Number.isFinite) ||
            ![width, height].every((value) => Number.isFinite(value) && value > 0) ||
            Math.abs(width - scene.pages[index].width) > 0.001 ||
            Math.abs(height - scene.pages[index].height) > 0.001 ||
            Math.abs(width - expected[index].width) > 0.001 ||
            Math.abs(height - expected[index].height) > 0.001 ||
            matrix.some((value, part) => Math.abs(value - expected[index].transform[part]) > 0.000001)
        )
            throw new Error('Invalid overlay viewport');
        const [a, b, c, d, e, f] = matrix;
        const determinant = a * d - b * c;
        if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
            throw new Error('Invalid overlay transform');
        return [
            d / determinant,
            -b / determinant,
            c / determinant,
            -a / determinant,
            (c * f - d * e - c * height) / determinant,
            (b * e - a * f + a * height) / determinant,
        ];
    });
    const overlay = await PDFDocument.load(await writeScenePdf(scene, kernel, latestDocument));
    const embedded = await source.embedPages(overlay.getPages());
    for (const [index, page] of source.getPages().entries()) {
        const crop = page.getCropBox();
        const bounds = [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height];
        const appearance = source.context.register(
            source.context.flateStream(
                `q ${matrices[index].map((value) => PDFNumber.of(value).toString()).join(' ')} cm /MidadOverlay Do Q`,
                {
                    Type: 'XObject',
                    Subtype: 'Form',
                    BBox: bounds,
                    Resources: { XObject: { MidadOverlay: embedded[index].ref } },
                },
            ),
        );
        const annotation = source.context.register(
            source.context.obj({
                Type: 'Annot',
                Subtype: 'Stamp',
                Rect: bounds,
                P: page.ref,
                F: 4,
                AP: { N: appearance },
            }),
        );
        const annotations = page.node.Annots();
        if (annotations) annotations.push(annotation);
        else page.node.set(PDFName.of('Annots'), source.context.obj([annotation]));
    }
    current();
    const bytes = await source.save({ updateFieldAppearances: false, objectsPerTick: 100000 });
    current();
    return bytes;
}
