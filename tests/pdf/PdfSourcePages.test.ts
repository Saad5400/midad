// @vitest-environment node
import { importDocument } from '@saad5400/midad/document';
import { assertPdfSurface, layoutDocumentSurface } from '@saad5400/midad/layout';
import { pdfSourcePages } from '@saad5400/midad/pdf';
import type { NativeTextKernel } from '@saad5400/midad/rendering';
import { PDFDocument, PDFName, PDFNumber, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, it } from 'vitest';

it('matches actual PDF.js source viewports for mixed sizes, crops, rotation and UserUnit', async () => {
    const pdf = await PDFDocument.create();
    for (const [index, rotation] of [0, 90, 180, 270, -90].entries()) {
        const page = pdf.addPage([400 + index * 20, 600 + index * 10]);
        page.setCropBox(20, 30, 300 + index * 10, 400);
        page.setRotation(degrees(rotation));
        page.node.set(PDFName.of('UserUnit'), PDFNumber.of(index % 2 ? 1.25 : 2));
    }
    const bytes = await pdf.save();
    const source = await pdfSourcePages(bytes);
    const reference = await getDocument({ data: new Uint8Array(bytes) }).promise;
    try {
        for (const [index, page] of source.entries()) {
            const viewport = (await reference.getPage(index + 1)).getViewport({ scale: 1 });
            expect(page.width).toBe(viewport.width);
            expect(page.height).toBe(viewport.height);
            expect(page.transform.map((value) => (value === 0 ? 0 : value))).toEqual(
                viewport.transform.map((value) => (value === 0 ? 0 : value)),
            );
        }
    } finally {
        await reference.destroy();
    }
});

it('rejects reordered, missing and substituted PDF background pages without mutating content', () => {
    const document = importDocument(
        {
            type: 'doc',
            content: [
                { type: 'pdfPage', attrs: { number: 1 } },
                { type: 'pdfPage', attrs: { number: 2 } },
            ],
        },
        'source',
    );
    const pages = [
        { number: 1, width: 300, height: 400 },
        { number: 2, width: 600, height: 500 },
    ];
    expect(() => assertPdfSurface(document, { kind: 'pdf', pages })).not.toThrow();
    expect(() => assertPdfSurface(document, { kind: 'pdf', pages: [...pages].reverse() })).toThrow('source pages');
    expect(() => assertPdfSurface(document, { kind: 'pdf', pages: pages.slice(0, 1) })).toThrow('source pages');
    const wrong = importDocument(
        { type: 'doc', content: [{ type: 'paragraph' }, { type: 'pdfPage', attrs: { number: 2 } }] },
        'source',
    );
    expect(() => assertPdfSurface(wrong, { kind: 'pdf', pages })).toThrow('source pages');
    expect(document.revision).toBe(0);
    expect(() => assertPdfSurface(document, { kind: 'pdf', pages: [{ ...pages[0], width: NaN }, pages[1]] })).toThrow();
    expect(() => layoutDocumentSurface(document, {} as NativeTextKernel)).toThrow('source page surface');
    const nested = {
        ...document,
        root: {
            ...document.root,
            children: document.root.children!.map((page, index) =>
                index ? page : { ...page, children: [wrong.root.children![0]] },
            ),
        },
    };
    expect(() => assertPdfSurface(nested, { kind: 'pdf', pages })).toThrow('source pages');
});

it.each([
    [0, 0, 800, 900],
    [-20, -30, 350, 450],
    [900, 900, 20, 20],
])('uses the same media/crop intersection and fallback as PDF.js for crop %j', async (...crop) => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([300, 400]);
    page.setMediaBox(-10, -20, 300, 400);
    page.setCropBox(...(crop as [number, number, number, number]));
    const bytes = await pdf.save();
    const [actual] = await pdfSourcePages(bytes);
    const reader = await getDocument({ data: new Uint8Array(bytes) }).promise;
    try {
        const expected = (await reader.getPage(1)).getViewport({ scale: 1 });
        expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
        expect(actual.transform).toEqual(expected.transform.map((value) => (value === 0 ? 0 : value)));
    } finally {
        await reader.destroy();
    }
});
