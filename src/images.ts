import { copyJson, findNode, type Attributes, type Json, type NativeDocument, type NativeNode } from './document.js';
import {
    allocator,
    blockText,
    editableTextBlock,
    isTextBlock,
    normalize,
    replaceInlineText,
    sliceInlineContent,
    update,
    type InlineEdit,
    type TextCaret,
} from './editing.js';
import {
    placementAttributes,
    transformField,
    type FieldBounds,
    type FieldHandle,
    type FieldPlacement,
} from './field-placement.js';
import { fieldSettings, isRecord } from './fields.js';
import type { DocumentScene } from './layout.js';

export interface NativeImage {
    readonly id: string;
    readonly attributes: Attributes;
    readonly blockId?: string;
    readonly offset?: number;
    readonly floating: boolean;
}
export interface ImageDraft {
    readonly src: string;
    readonly attachmentId?: string | null;
    readonly alt: string;
    readonly title?: string;
    readonly width: number;
    readonly height: number;
    readonly keepAspect?: boolean;
}
export interface UploadedImage {
    readonly src: string;
    readonly attachmentId: string;
}
export type ImageUpload = (file: File, attachmentId: string | undefined, signal: AbortSignal) => Promise<UploadedImage>;
export type AttachmentUpload = (
    id: string,
    name: string,
    file: File,
    signal: AbortSignal,
) => Promise<{ value: string; filename: string }>;

export function transformImage(
    box: FieldBounds,
    handle: FieldHandle,
    dx: number,
    dy: number,
    page: { width: number; height: number },
    keepAspect = true,
): FieldBounds {
    const resized = transformField(box, handle, dx, dy, page);
    if (!keepAspect || handle === 'move' || handle.length !== 2) return resized;
    const west = handle.includes('w'),
        north = handle.includes('n');
    const pivotX = box.x + (west ? box.width : 0),
        pivotY = box.y + (north ? box.height : 0);
    const desired =
        Math.abs(dx / box.width) >= Math.abs(dy / box.height) ? resized.width / box.width : resized.height / box.height;
    const limit = Math.min(
        (west ? pivotX : page.width - pivotX) / box.width,
        (north ? pivotY : page.height - pivotY) / box.height,
    );
    const minimum = Math.min(1, Math.max(9 / box.width, 9 / box.height));
    const scale = Math.max(minimum, Math.min(limit, desired));
    const width = box.width * scale,
        height = box.height * scale;
    return { x: pivotX - (west ? width : 0), y: pivotY - (north ? height : 0), width, height };
}

export function nativeImages(document: NativeDocument): readonly NativeImage[] {
    const images: NativeImage[] = [];
    const visit = (node: NativeNode): void => {
        if (isTextBlock(node)) {
            let offset = 0;
            for (const child of node.children ?? []) {
                if (child.kind === 'image')
                    images.push({
                        id: child.id,
                        attributes: child.attributes ?? {},
                        blockId: node.id,
                        offset,
                        floating: false,
                    });
                offset += child.kind === 'text' ? (child.text?.length ?? 0) : 1;
            }
        } else node.children?.forEach(visit);
    };
    visit(document.root);
    const floating = document.root.attributes?.floatingImages;
    if (Array.isArray(floating))
        for (const attrs of floating)
            if (isRecord(attrs) && typeof attrs.id === 'string')
                images.push({ id: attrs.id, attributes: attrs, floating: true });
    return images;
}

function imageAttributes(draft: ImageDraft, existing: Attributes = {}): Attributes {
    if (!draft.src || /^(?:javascript|vbscript):/i.test(draft.src)) throw new Error('Choose an image');
    if (![draft.width, draft.height].every((size) => Number.isFinite(size) && size >= 1 && size <= 2000))
        throw new Error('Invalid image dimensions');
    const defined = Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== undefined));
    return copyJson({ ...existing, ...defined }) as Attributes;
}

export function insertNativeImage(
    document: NativeDocument,
    edit: Omit<InlineEdit, 'text'>,
    draft: ImageDraft,
): { document: NativeDocument; caret: TextCaret; imageId: string } {
    const block = editableTextBlock(document, { ...edit, text: '' }),
        id = crypto.randomUUID();
    const image: NativeNode = Object.freeze({
        id,
        kind: 'image',
        attributes: Object.freeze({ ...imageAttributes(draft), id }),
    });
    const children = normalize(
        [
            ...sliceInlineContent(block.children ?? [], 0, edit.from),
            image,
            ...sliceInlineContent(block.children ?? [], edit.to, blockText(block).length),
        ],
        allocator(document),
    );
    return {
        document: update(document, block, [Object.freeze({ ...block, children })]),
        caret: { blockId: block.id, offset: edit.from + 1 },
        imageId: id,
    };
}

export function updateNativeImage(document: NativeDocument, id: string, draft: ImageDraft): NativeDocument {
    const image = nativeImages(document).find((image) => image.id === id);
    if (!image) throw new Error('The image no longer exists');
    let attrs = imageAttributes(draft, image.attributes);
    if (!image.floating) {
        const node = findNode(document, id)!;
        return update(document, node, [Object.freeze({ ...node, attributes: attrs })]);
    }
    const settings = fieldSettings(attrs);
    attrs = Object.freeze({
        ...attrs,
        settings: Object.freeze({
            ...settings,
            ...(typeof settings.widthPct === 'number' && Number(image.attributes.width) > 0
                ? { widthPct: (settings.widthPct * draft.width) / Number(image.attributes.width) }
                : {}),
            ...(typeof settings.heightPct === 'number' && Number(image.attributes.height) > 0
                ? { heightPct: (settings.heightPct * draft.height) / Number(image.attributes.height) }
                : {}),
        }),
    });
    return updateFloating(document, id, attrs);
}

export function insertFloatingNativeImage(
    document: NativeDocument,
    draft: ImageDraft,
    scene: DocumentScene,
    position: FieldPlacement,
): { document: NativeDocument; imageId: string } {
    if (scene.documentId !== document.id || scene.revision !== document.revision)
        throw new Error('The image layout is stale');
    const imageId = crypto.randomUUID(),
        attrs = placementAttributes(imageAttributes(draft), imageId, scene, position, document);
    const images = document.root.attributes?.floatingImages;
    return {
        imageId,
        document: update(document, document.root, [
            Object.freeze({
                ...document.root,
                attributes: Object.freeze({
                    ...document.root.attributes,
                    floatingImages: Object.freeze([...(Array.isArray(images) ? images : []), attrs]),
                }),
            }),
        ]),
    };
}

function updateFloating(document: NativeDocument, id: string, attrs?: Attributes): NativeDocument {
    const images = document.root.attributes?.floatingImages;
    return update(document, document.root, [
        Object.freeze({
            ...document.root,
            attributes: Object.freeze({
                ...document.root.attributes,
                floatingImages: Object.freeze(
                    (Array.isArray(images) ? images : []).flatMap((entry) =>
                        isRecord(entry) && entry.id === id ? (attrs ? [attrs] : []) : [entry],
                    ),
                ),
            }),
        }),
    ]);
}

export function removeNativeImage(
    document: NativeDocument,
    id: string,
): { document: NativeDocument; caret?: TextCaret } {
    const image = nativeImages(document).find((image) => image.id === id);
    if (!image) return { document };
    if (image.floating) return { document: updateFloating(document, id) };
    return {
        document: replaceInlineText(document, {
            blockId: image.blockId!,
            from: image.offset!,
            to: image.offset! + 1,
            text: '',
            expectedRevision: document.revision,
        }),
        caret: { blockId: image.blockId!, offset: image.offset! },
    };
}

export function placeNativeImage(
    document: NativeDocument,
    id: string,
    scene: DocumentScene,
    placement?: FieldPlacement,
): { document: NativeDocument; caret?: TextCaret } {
    if (scene.documentId !== document.id || scene.revision !== document.revision)
        throw new Error('The image layout is stale');
    const image = nativeImages(document).find((image) => image.id === id);
    if (!image || image.attributes.locked) throw new Error('The image cannot be moved');
    const target =
        placement ??
        scene.pages.flatMap((page, index) =>
            page.commands.flatMap((command) =>
                command.kind === 'image' && command.nodeId === id
                    ? [{ page: index, x: command.x, y: command.y, width: command.width, height: command.height }]
                    : [],
            ),
        )[0];
    if (!target) throw new Error('Choose a document page');
    const attrs = placementAttributes(image.attributes, id, scene, target, document);
    if (image.floating) return { document: updateFloating(document, id, attrs) };
    const removed = removeNativeImage(document, id);
    const images = removed.document.root.attributes?.floatingImages;
    const next = update(removed.document, removed.document.root, [
        Object.freeze({
            ...removed.document.root,
            attributes: Object.freeze({
                ...removed.document.root.attributes,
                floatingImages: Object.freeze([...(Array.isArray(images) ? images : []), attrs]),
            }),
        }),
    ]);
    return { document: Object.freeze({ ...next, revision: document.revision + 1 }), caret: removed.caret };
}

export function inlineNativeImage(
    document: NativeDocument,
    id: string,
    caret: TextCaret,
): { document: NativeDocument; caret: TextCaret } {
    const image = nativeImages(document).find((image) => image.id === id);
    if (!image?.floating || image.attributes.locked) throw new Error('Choose a floating image');
    const removed = removeNativeImage(document, id).document;
    const block = editableTextBlock(removed, {
        blockId: caret.blockId,
        from: caret.offset,
        to: caret.offset,
        text: '',
        expectedRevision: removed.revision,
    });
    const attributes = { ...image.attributes };
    delete attributes.surface;
    delete attributes.nativeAnchor;
    const node: NativeNode = Object.freeze({
        id,
        kind: 'image',
        attributes: Object.freeze({ ...attributes, display: 'inline' }),
    });
    const children = normalize(
        [
            ...sliceInlineContent(block.children ?? [], 0, caret.offset),
            node,
            ...sliceInlineContent(block.children ?? [], caret.offset, blockText(block).length),
        ],
        allocator(removed),
    );
    const next = update(removed, block, [Object.freeze({ ...block, children })]);
    return {
        document: Object.freeze({ ...next, revision: document.revision + 1 }),
        caret: { blockId: caret.blockId, offset: caret.offset + 1 },
    };
}

export function stampNativeImages(document: NativeDocument, scene: DocumentScene): NativeDocument {
    if (scene.documentId !== document.id || scene.revision !== document.revision)
        throw new Error('The image layout is stale');
    const positioned = new Map<string, Attributes>();
    const images = new Map(nativeImages(document).map((image) => [image.id, image]));
    for (const [page, entry] of scene.pages.entries())
        for (const command of entry.commands)
            if (command.kind === 'image' && command.nodeId) {
                const image = images.get(command.nodeId);
                if (image?.floating)
                    positioned.set(
                        image.id,
                        placementAttributes(image.attributes, image.id, scene, { page, ...command }),
                    );
            }
    const floating = document.root.attributes?.floatingImages;
    if (!Array.isArray(floating)) return document;
    return Object.freeze({
        ...document,
        root: Object.freeze({
            ...document.root,
            attributes: Object.freeze({
                ...document.root.attributes,
                floatingImages: Object.freeze(
                    floating.map((entry: Json) =>
                        isRecord(entry) && typeof entry.id === 'string' ? (positioned.get(entry.id) ?? entry) : entry,
                    ),
                ),
            }),
        }),
    });
}
