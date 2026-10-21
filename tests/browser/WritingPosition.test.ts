import { emptyWritingPosition } from '@saad5400/midad/browser';
import { importDocument } from '@saad5400/midad/document';
import type { DocumentScene } from '@saad5400/midad/layout';
import { describe, expect, it } from 'vitest';

const scene = (id: string): DocumentScene => ({
    documentId: id,
    revision: 0,
    fontHash: 'fonts',
    margin: 72,
    glyphCount: 0,
    pages: [{ width: 600, height: 840, lines: [], commands: [] }],
});
describe('empty writing geometry', () => {
    it.each(['rtl', 'ltr'])('respects %s direction and asymmetric page margins without altering content', (dir) => {
        const document = importDocument(
            { type: 'doc', attrs: { dir, pageLayout: { margins: { top: 48, bottom: 96, left: 72, right: 120 } } } },
            'empty',
        );
        const before = document.root;
        const position = emptyWritingPosition(document, scene(document.id))!;
        expect(position.x).toBe(dir === 'rtl' ? 510 : 54);
        expect(position.y).toBe(36);
        expect(position.height).toBeGreaterThan(10);
        expect(document.root).toBe(before);
    });
    it('refuses stale scenes and imported PDF bodies', () => {
        const document = importDocument({ type: 'doc' }, 'empty');
        expect(emptyWritingPosition(document, { ...scene(document.id), revision: 1 })).toBeUndefined();
        expect(emptyWritingPosition(document, scene('other'))).toBeUndefined();
        const pdf = importDocument({ type: 'doc', content: [{ type: 'pdfPage' }] }, 'frozen');
        expect(emptyWritingPosition(pdf, scene(pdf.id))).toBeUndefined();
    });
    it('starts on the body after a cover and refuses containers that already have text positions', () => {
        const document = importDocument({ type: 'doc' }, 'empty');
        const layout = scene(document.id);
        const position = emptyWritingPosition(document, {
            ...layout,
            coverPages: 1,
            pages: [...layout.pages, ...layout.pages],
        });
        expect(position?.pageIndex).toBe(1);
        const occupied = importDocument({ type: 'doc', content: [{ type: 'paragraph' }] }, 'occupied');
        expect(emptyWritingPosition(occupied, scene(occupied.id))).toBeUndefined();
    });
});
