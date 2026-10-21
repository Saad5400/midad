import { importDocument } from '@saad5400/midad/document';
import { placementAttributes } from '@saad5400/midad/content/fields';
import { stampNativeFields } from '@saad5400/midad/content/fields';
import type { DocumentScene } from '@saad5400/midad/layout';
import { documentPresentation, headerTile, setDocumentPresentation } from '@saad5400/midad/content/presentation';
import { describe, expect, it } from 'vitest';

describe('native document presentation', () => {
    it('keeps a blank cover as an explicit choice and preserves source media while toggling it', () => {
        const original = importDocument({ type: 'doc', content: [{ type: 'paragraph' }] }, 'document');
        const enabled = { cover: { enabled: true, src: 'private-cover-uuid' }, header: { enabled: false, src: null } };
        const document = setDocumentPresentation(original, enabled);
        expect(documentPresentation(document)).toEqual(enabled);
        expect(document.revision).toBe(1);
        expect(setDocumentPresentation(document, enabled)).toBe(document);
        expect(
            documentPresentation(
                setDocumentPresentation(document, { ...enabled, cover: { ...enabled.cover, enabled: false } }),
            ).cover.src,
        ).toBe('private-cover-uuid');
        expect(documentPresentation(original).cover.enabled).toBe(false);
    });
    it('uses the original letterhead strip and full-page stretch rules', () => {
        expect(headerTile(210, 30, 600, 800)).toEqual({ width: 600, height: (600 * 30) / 210 });
        expect(headerTile(210, 297, 600, 800)).toEqual({ width: 600, height: 800 });
    });
    it('separates physical PDF pages from cover and body coordinates during field stamping and movement', () => {
        const document = importDocument(
            {
                type: 'doc',
                attrs: {
                    blockVariables: [
                        { id: 'cover', type: 'signature', surface: 'cover' },
                        { id: 'body', type: 'signature' },
                    ],
                },
                content: [{ type: 'paragraph' }],
            },
            'document',
        );
        const field = (id: string) => ({
            kind: 'field' as const,
            nodeId: id,
            attributes: {},
            x: 60,
            y: 80,
            width: 120,
            height: 40,
        });
        const scene: DocumentScene = {
            documentId: document.id,
            revision: 0,
            fontHash: 'test',
            margin: 72,
            glyphCount: 0,
            coverPages: 1,
            pages: ['cover', 'body'].map((id) => ({ width: 600, height: 800, commands: [field(id)], lines: [] })),
        };
        const stamped = stampNativeFields(document, scene).root.attributes!.blockVariables as Array<{
            id: string;
            y: number;
            settings: { page: number };
        }>;
        expect(stamped.map((field) => field.settings.page)).toEqual([1, 1]);
        expect(stamped.map((field) => field.y)).toEqual([80 / 0.75, 80 / 0.75]);
        const body = placementAttributes({ surface: 'cover' }, 'body', scene, {
            page: 1,
            x: 60,
            y: 80,
            width: 120,
            height: 40,
        });
        expect(body.surface).toBeUndefined();
        expect(body.y).toBe(80 / 0.75);
        expect(body.settings).toMatchObject({ page: 1, relativeYPct: 0.1 });
        expect(placementAttributes({}, 'cover', scene, { page: 0, x: 60, y: 80, width: 120, height: 40 }).surface).toBe(
            'cover',
        );
    });
});
