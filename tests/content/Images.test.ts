import { DocumentSession, exportDocument, findNode, importDocument } from '@saad5400/midad/document';
import { blockText } from '@saad5400/midad/editing';
import {
    inlineNativeImage,
    insertFloatingNativeImage,
    insertNativeImage,
    nativeImages,
    placeNativeImage,
    removeNativeImage,
    stampNativeImages,
    transformImage,
    updateNativeImage,
} from '@saad5400/midad/content/images';
import type { DocumentScene } from '@saad5400/midad/layout';
import { describe, expect, it } from 'vitest';

const draft = { src: 'media-one', attachmentId: 'encrypted-attachment', alt: 'شعار', width: 200, height: 100 };
const source = () =>
    importDocument(
        {
            type: 'doc',
            attrs: { custom: 'preserved' },
            content: [
                {
                    type: 'paragraph',
                    attrs: { id: 'p' },
                    content: [{ type: 'text', text: 'قبل بعد', marks: [{ type: 'bold' }] }],
                },
            ],
        },
        'images',
    );
const insert = () => insertNativeImage(source(), { blockId: 'p', from: 4, to: 4, expectedRevision: 0 }, draft);
const scene = (document: ReturnType<typeof source>, id: string): DocumentScene =>
    ({
        documentId: document.id,
        revision: document.revision,
        pages: [
            {
                width: 600,
                height: 800,
                lines: [],
                commands: [{ kind: 'image', nodeId: id, assetId: 'asset', x: 50, y: 100, width: 150, height: 75 }],
            },
        ],
    }) as unknown as DocumentScene;

describe('native image authoring', () => {
    it('preserves image proportions while resizing corners and clamps the result to its page', () => {
        const box = { x: 50, y: 100, width: 150, height: 75 },
            page = { width: 600, height: 800 };
        expect(transformImage(box, 'se', 30, 0, page)).toEqual({ x: 50, y: 100, width: 180, height: 90 });
        expect(transformImage(box, 'nw', -30, 0, page)).toEqual({ x: 20, y: 85, width: 180, height: 90 });
        const limited = transformImage(box, 'se', 1000, 1000, page);
        expect(limited.x + limited.width).toBeLessThanOrEqual(page.width);
        expect(limited.width / limited.height).toBe(2);
        expect(transformImage(box, 'se', 30, 0, page, false)).toMatchObject({ width: 180, height: 75 });
    });
    it('inserts an atomic image without losing styled neighboring text', () => {
        const result = insert(),
            image = nativeImages(result.document)[0];
        expect(blockText(findNode(result.document, 'p')!)).toBe('قبل \uFFFCبعد');
        expect(image).toMatchObject({
            id: result.imageId,
            floating: false,
            blockId: 'p',
            offset: 4,
            attributes: draft,
        });
        expect(findNode(result.document, 'p')?.children?.[2].marks?.[0].kind).toBe('bold');
        expect(importDocument(exportDocument(result.document), 'images')).toMatchObject({
            root: { attributes: { custom: 'preserved' } },
        });
    });
    it('omits an unavailable attachment identity until the upload returns one', () => {
        const inserted = insertNativeImage(
            source(),
            { blockId: 'p', from: 0, to: 0, expectedRevision: 0 },
            { ...draft, attachmentId: undefined },
        );
        expect(nativeImages(inserted.document)[0].attributes.attachmentId).toBeUndefined();
    });
    it('replaces image media and preserves unknown metadata with reversible deletion', () => {
        const inserted = insert(),
            session = new DocumentSession(inserted.document);
        const changed = updateNativeImage(session.document, inserted.imageId, {
            ...draft,
            src: 'media-two',
            alt: 'Updated',
            width: 300,
        });
        session.commit(changed);
        session.commit(removeNativeImage(session.document, inserted.imageId).document);
        expect(nativeImages(session.document)).toEqual([]);
        session.undo();
        expect(nativeImages(session.document)[0].attributes).toMatchObject({
            src: 'media-two',
            width: 300,
            attachmentId: 'encrypted-attachment',
        });
        session.undo();
        expect(nativeImages(session.document)[0].attributes.src).toBe('media-one');
    });
    it('moves an inline image into exact page coordinates and returns it to the caret without changing identity', () => {
        const inserted = insert();
        const floated = placeNativeImage(
            inserted.document,
            inserted.imageId,
            scene(inserted.document, inserted.imageId),
        );
        expect(floated.document.revision).toBe(inserted.document.revision + 1);
        expect(blockText(findNode(floated.document, 'p')!)).toBe('قبل بعد');
        expect(nativeImages(floated.document)[0]).toMatchObject({
            id: inserted.imageId,
            floating: true,
            attributes: { settings: { page: 1, relativeYPct: 0.125, widthPct: 0.25 } },
        });
        const inline = inlineNativeImage(floated.document, inserted.imageId, { blockId: 'p', offset: 4 });
        expect(nativeImages(inline.document)).toHaveLength(1);
        expect(nativeImages(inline.document)[0]).toMatchObject({ id: inserted.imageId, floating: false });
        expect(blockText(findNode(inline.document, 'p')!)).toBe('قبل \uFFFCبعد');
    });
    it('inserts floating images independently of text and stamps the displayed bounds', () => {
        const document = source(),
            original = exportDocument(document);
        const inserted = insertFloatingNativeImage(document, draft, scene(document, ''), {
            page: 0,
            x: 75,
            y: 150,
            width: 150,
            height: 75,
        });
        expect(inserted.document.root.children).toBe(document.root.children);
        const positioned = scene(inserted.document, inserted.imageId);
        const stamped = stampNativeImages(inserted.document, positioned);
        expect(nativeImages(stamped)[0].attributes).toMatchObject({
            x: 50 / 0.75,
            y: 100 / 0.75,
            width: 200,
            settings: { relativeYPct: 0.125 },
        });
        expect(exportDocument(document)).toEqual(original);
        const changed = updateNativeImage(stamped, inserted.imageId, { ...draft, width: 400, height: 50 });
        expect(nativeImages(changed)[0].attributes.settings).toMatchObject({ widthPct: 0.5, heightPct: 37.5 / 800 });
    });
    it('rejects invalid dimensions, stale geometry, off-page placement and invalid insertion points', () => {
        const inserted = insert(),
            layout = scene(inserted.document, inserted.imageId);
        expect(() => updateNativeImage(inserted.document, inserted.imageId, { ...draft, width: NaN })).toThrow();
        expect(() => placeNativeImage(inserted.document, inserted.imageId, { ...layout, revision: 99 })).toThrow(
            'stale',
        );
        expect(() =>
            placeNativeImage(inserted.document, inserted.imageId, layout, {
                page: 0,
                x: 599,
                y: 0,
                width: 150,
                height: 75,
            }),
        ).toThrow();
        expect(() =>
            insertNativeImage(source(), { blockId: 'p', from: 1, to: 1, expectedRevision: 5 }, draft),
        ).toThrow();
        expect(nativeImages(inserted.document)).toHaveLength(1);
    });
});
