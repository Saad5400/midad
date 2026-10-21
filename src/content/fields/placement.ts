import { type Attributes, type NativeDocument, type NativeNode } from '../../document/model.js';
import {
    allocator,
    blockText,
    editableTextBlock,
    normalize,
    sliceInlineContent,
    update,
    type TextCaret,
} from '../../editing/text.js';
import type { DocumentScene } from '../../layout/scene.js';
import { anchorForPlacement, floatingAnchorIndex, followsText } from '../floating-anchors.js';
import {
    createNativeFieldAttributes,
    fieldSettings,
    isRecord,
    nativeFields,
    removeNativeField,
    type FieldDraft,
} from './commands.js';

export interface FieldBounds {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
export interface FieldPlacement extends FieldBounds {
    readonly page: number;
}
export type FieldHandle = 'move' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export function transformField(
    box: FieldBounds,
    handle: FieldHandle,
    dx: number,
    dy: number,
    page: { width: number; height: number },
): FieldBounds {
    if (![box.x, box.y, box.width, box.height, dx, dy, page.width, page.height].every(Number.isFinite))
        throw new Error('Invalid field position');
    const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
    if (handle === 'move')
        return {
            ...box,
            x: clamp(box.x + dx, 0, page.width - box.width),
            y: clamp(box.y + dy, 0, page.height - box.height),
        };
    let left = box.x,
        top = box.y,
        right = box.x + box.width,
        bottom = box.y + box.height;
    const minimumWidth = Math.min(9, box.width),
        minimumHeight = Math.min(9, box.height);
    if (handle.includes('w')) left = clamp(left + dx, 0, right - minimumWidth);
    if (handle.includes('e')) right = clamp(right + dx, left + minimumWidth, page.width);
    if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minimumHeight);
    if (handle.includes('s')) bottom = clamp(bottom + dy, top + minimumHeight, page.height);
    return { x: left, y: top, width: right - left, height: bottom - top };
}

export function floatingFieldPlacement(
    attrs: Attributes,
    page: { width: number; height: number },
    legacyStride: number,
): FieldPlacement {
    const settings = fieldSettings(attrs);
    const normalized = ['relativeXPct', 'relativeYPct', 'widthPct', 'heightPct'].every(
        (key) => typeof settings[key] === 'number' && Number.isFinite(settings[key]),
    );
    const rawY = typeof attrs.y === 'number' ? attrs.y : 0;
    if (normalized && Number.isInteger(settings.page) && Number(settings.page) >= 1)
        return {
            page: Number(settings.page) - 1,
            x: Number(settings.relativeXPct) * page.width,
            y: Number(settings.relativeYPct) * page.height,
            width: Number(settings.widthPct) * page.width,
            height: Number(settings.heightPct) * page.height,
        };
    const index = Math.max(0, Math.floor(rawY / legacyStride));
    return {
        page: index,
        x: Number(attrs.x ?? 0) * 0.75,
        y: (rawY - index * legacyStride) * 0.75,
        width: Number(attrs.width ?? 200) * 0.75,
        height: Number(attrs.height ?? 24) * 0.75,
    };
}

export function insertFloatingNativeField(
    document: NativeDocument,
    draft: FieldDraft,
    scene: DocumentScene,
    placement: FieldPlacement,
    attributes?: Attributes,
): { document: NativeDocument; fieldId: string } {
    if (scene.documentId !== document.id || scene.revision !== document.revision)
        throw new Error('The field layout is stale');
    const id = crypto.randomUUID();
    const attrs = placementAttributes(createNativeFieldAttributes(draft, attributes), id, scene, placement, document);
    const blocks = document.root.attributes?.blockVariables;
    const next = update(document, document.root, [
        Object.freeze({
            ...document.root,
            attributes: Object.freeze({
                ...document.root.attributes,
                blockVariables: Object.freeze([...(Array.isArray(blocks) ? blocks : []), attrs]),
            }),
        }),
    ]);
    return { document: next, fieldId: id };
}

export function placeNativeField(
    document: NativeDocument,
    fieldId: string,
    scene: DocumentScene,
    placement?: FieldPlacement,
): { document: NativeDocument; caret?: TextCaret } {
    if (scene.documentId !== document.id || scene.revision !== document.revision)
        throw new Error('The field layout is stale');
    const field = nativeFields(document).find((field) => field.id === fieldId);
    if (!field) throw new Error('The contract field cannot be positioned');
    let target = placement;
    if (!target)
        for (const [page, entry] of scene.pages.entries()) {
            const box = entry.commands.find((command) => command.kind === 'field' && command.nodeId === fieldId);
            if (box?.kind === 'field') target = { x: box.x, y: box.y, width: box.width, height: box.height, page };
        }
    if (!target) throw new Error('Choose a document page');
    const attrs = placementAttributes(field.attributes, fieldId, scene, target, document);
    const removed = field.floating ? { document } : removeNativeField(document, fieldId);
    const blocks = removed.document.root.attributes?.blockVariables;
    const entries = Array.isArray(blocks) ? blocks : [];
    const positioned = field.floating
        ? entries.map((value) => (isRecord(value) && value.id === fieldId ? attrs : value))
        : [...entries, attrs];
    const next = update(removed.document, removed.document.root, [
        Object.freeze({
            ...removed.document.root,
            attributes: Object.freeze({
                ...removed.document.root.attributes,
                blockVariables: Object.freeze(positioned),
            }),
        }),
    ]);
    return { document: Object.freeze({ ...next, revision: document.revision + 1 }), caret: removed.caret };
}

export function placementAttributes(
    attributes: Attributes,
    id: string,
    scene: DocumentScene,
    target: FieldPlacement,
    document?: NativeDocument,
): Attributes {
    if (!Number.isInteger(target.page)) throw new Error('Choose a document page');
    const page = scene.pages[target.page];
    if (
        !page ||
        ![target.x, target.y, target.width, target.height].every(Number.isFinite) ||
        target.x < 0 ||
        target.y < 0 ||
        target.width < 0.75 ||
        target.height < 0.75 ||
        target.x + target.width > page.width + 0.001 ||
        target.y + target.height > page.height + 0.001
    )
        throw new Error('The field must fit inside its page');
    const offset = scene.coverPages ?? 0;
    const stride = scene.pages.slice(offset, target.page).reduce((sum, page) => sum + page.height / 0.75 + 30, 0);
    const attributesWithoutSurface = { ...attributes };
    delete attributesWithoutSurface.surface;
    const canAnchor = target.page >= offset && followsText(attributesWithoutSurface);
    const nativeAnchor = canAnchor
        ? document
            ? anchorForPlacement(floatingAnchorIndex(document, scene), target)
            : attributes.nativeAnchor
        : undefined;
    delete attributesWithoutSurface.nativeAnchor;
    const attrs: Attributes = Object.freeze({
        ...attributesWithoutSurface,
        ...(target.page < offset ? { surface: 'cover' } : {}),
        id,
        display: 'block',
        ...(nativeAnchor ? { nativeAnchor } : {}),
        x: target.x / 0.75,
        y: stride + target.y / 0.75,
        width: target.width / 0.75,
        height: target.height / 0.75,
        settings: Object.freeze({
            ...fieldSettings(attributes),
            page: target.page < offset ? 1 : target.page - offset + 1,
            relativeXPct: target.x / page.width,
            relativeYPct: target.y / page.height,
            widthPct: target.width / page.width,
            heightPct: target.height / page.height,
        }),
    });
    return attrs;
}

export function inlineNativeField(
    document: NativeDocument,
    fieldId: string,
    caret: TextCaret,
): { document: NativeDocument; caret: TextCaret } {
    const field = nativeFields(document).find((field) => field.id === fieldId);
    if (!field?.floating) throw new Error('Choose a floating document field');
    const block = editableTextBlock(document, {
        blockId: caret.blockId,
        from: caret.offset,
        to: caret.offset,
        text: '',
        expectedRevision: document.revision,
    });
    const attributes = { ...field.attributes };
    delete attributes.surface;
    delete attributes.nativeAnchor;
    const attrs = Object.freeze({ ...attributes, display: 'inline' });
    const node: NativeNode = Object.freeze({ id: fieldId, kind: 'variable', attributes: attrs });
    const children = normalize(
        [
            ...sliceInlineContent(block.children ?? [], 0, caret.offset),
            node,
            ...sliceInlineContent(block.children ?? [], caret.offset, blockText(block).length),
        ],
        allocator(document),
    );
    const withInline = update(document, block, [Object.freeze({ ...block, children })]);
    const blocks = document.root.attributes?.blockVariables;
    const root = withInline.root;
    const next = update(withInline, root, [
        Object.freeze({
            ...root,
            attributes: Object.freeze({
                ...root.attributes,
                blockVariables: Object.freeze(
                    (Array.isArray(blocks) ? blocks : []).filter((value) => !isRecord(value) || value.id !== fieldId),
                ),
            }),
        }),
    ]);
    return {
        document: Object.freeze({ ...next, revision: document.revision + 1 }),
        caret: { blockId: caret.blockId, offset: caret.offset + 1 },
    };
}
