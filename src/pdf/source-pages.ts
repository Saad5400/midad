import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';

export interface PdfOverlayViewport {
    readonly width: number;
    readonly height: number;
    readonly transform: readonly number[];
}

export interface PdfSourcePage extends PdfOverlayViewport {
    readonly number: number;
}

export async function pdfSourcePages(bytes: Uint8Array): Promise<readonly PdfSourcePage[]> {
    const source = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
    return sourcePageViewports(source);
}

export function sourcePageViewports(source: PDFDocument): readonly PdfSourcePage[] {
    return Object.freeze(
        source.getPages().map((page, index) => {
            const media = page.getMediaBox(),
                crop = page.getCropBox();
            const left = Math.max(media.x, crop.x),
                bottom = Math.max(media.y, crop.y);
            const right = Math.min(media.x + media.width, crop.x + crop.width),
                top = Math.min(media.y + media.height, crop.y + crop.height);
            const box =
                right > left && top > bottom
                    ? { x: left, y: bottom, width: right - left, height: top - bottom }
                    : media;
            const value = page.node.lookup(PDFName.of('UserUnit'));
            const unit =
                value instanceof PDFNumber && Number.isFinite(value.asNumber()) && value.asNumber() > 0
                    ? value.asNumber()
                    : 1;
            const rotation = ((page.getRotation().angle % 360) + 360) % 360;
            if (
                ![0, 90, 180, 270].includes(rotation) ||
                ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
                box.width <= 0 ||
                box.height <= 0
            )
                throw new Error('Invalid PDF source page geometry');
            const { x, y, width, height } = box;
            const transforms: Record<number, number[]> = {
                0: [unit, 0, 0, -unit, -x * unit, (y + height) * unit],
                90: [0, unit, unit, 0, -y * unit, -x * unit],
                180: [-unit, 0, 0, unit, (x + width) * unit, -y * unit],
                270: [0, -unit, -unit, 0, (y + height) * unit, (x + width) * unit],
            };
            return Object.freeze({
                number: index + 1,
                width: (rotation % 180 ? height : width) * unit,
                height: (rotation % 180 ? width : height) * unit,
                transform: Object.freeze(transforms[rotation].map((value) => (value === 0 ? 0 : value))),
            });
        }),
    );
}
