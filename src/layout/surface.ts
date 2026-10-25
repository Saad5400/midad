import type { NativeDocument } from '../document/model.js';
import { pdfPageNumbers } from '../document/pdf-pages.js';
import type { NativeTextKernel } from '../rendering/kernel.js';
import { layoutDocument } from './document.js';
import { layoutPdfOverlays, type PdfPageGeometry } from './pdf-overlays.js';
import type { DocumentScene } from './scene.js';

export interface PdfDocumentSurface {
    readonly kind: 'pdf';
    readonly pages: readonly (PdfPageGeometry & { readonly number: number })[];
}
export type DocumentSurface = PdfDocumentSurface | { readonly kind: 'flow'; readonly width?: number };

export function assertPdfSurface(document: NativeDocument, surface: PdfDocumentSurface): void {
    const numbers = pdfPageNumbers(document);
    if (
        !surface.pages.length ||
        surface.pages.some(
            (page) => ![page.width, page.height].every((value) => Number.isFinite(value) && value > 0),
        ) ||
        !numbers ||
        numbers.length !== surface.pages.length ||
        numbers.some((number, index) => number !== surface.pages[index].number)
    )
        throw new Error('The PDF document does not match its source pages');
}

export function layoutDocumentSurface(
    document: NativeDocument,
    kernel: NativeTextKernel,
    surface: DocumentSurface = { kind: 'flow' },
): DocumentScene {
    if (surface.kind === 'flow') {
        if (document.root.children?.some((node) => node.kind === 'pdfPage'))
            throw new Error('A PDF document requires its source page surface');
        return layoutDocument(document, kernel, surface.width);
    }
    if (surface.kind !== 'pdf') throw new Error('Unknown document surface');
    assertPdfSurface(document, surface);
    return layoutPdfOverlays(document, kernel, surface.pages);
}
