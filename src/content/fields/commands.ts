import {
    copyJson,
    findNode,
    isRecord,
    type Attributes,
    type Json,
    type NativeDocument,
    type NativeNode,
} from '../../document/model.js';
import {
    allocator,
    blockText,
    editableTextBlock,
    normalize,
    replaceInlineText,
    sliceInlineContent,
    update,
    type InlineEdit,
    type TextCaret,
} from '../../editing/text.js';
import type { DocumentScene } from '../../layout/scene.js';
import { getDefaultVariableDimensions, getDefaultVariableSettings, type VariableType } from './schema.js';
import { fieldSettings, nativeFields, NATIVE_FIELD_TYPES } from './queries.js';
export * from './queries.js';
export { isRecord } from '../../document/model.js';

export interface FieldDraft {
    readonly type: VariableType;
    readonly name: string;
    readonly description?: string;
    readonly value?: string;
    readonly participant_id?: string | null;
    readonly width?: number;
    readonly height?: number;
    readonly settings?: Attributes;
}

export function createNativeFieldAttributes(draft: FieldDraft, existing: Attributes = {}): Attributes {
    if (!NATIVE_FIELD_TYPES.includes(draft.type)) throw new Error('Unknown contract field type');
    if (typeof draft.name !== 'string' || draft.name.length > 255) throw new Error('Invalid field name');
    const defaults = getDefaultVariableDimensions(draft.type),
        width = draft.width ?? Number(existing.width ?? defaults.width),
        height = draft.height ?? Number(existing.height ?? defaults.height);
    if (![width, height].every((value) => Number.isFinite(value) && value >= 1 && value <= 2000))
        throw new Error('Invalid field dimensions');
    const settings = { ...getDefaultVariableSettings(draft.type), ...fieldSettings(existing), ...draft.settings };
    if (
        settings.options !== undefined &&
        (!Array.isArray(settings.options) || settings.options.some((option) => typeof option !== 'string'))
    )
        throw new Error('Field choices must be strings');
    if (draft.participant_id && !/^\d+$/.test(draft.participant_id)) throw new Error('Choose a contract participant');
    return copyJson({
        ...existing,
        ...draft,
        name: draft.name.trim(),
        width,
        height,
        settings,
        description: draft.description ?? existing.description ?? '',
        value: draft.participant_id && !Object.keys(existing).length ? '' : (draft.value ?? existing.value ?? ''),
        participant_id:
            draft.participant_id === undefined ? (existing.participant_id ?? '') : (draft.participant_id ?? ''),
    }) as Attributes;
}

export function insertNativeField(
    document: NativeDocument,
    edit: Omit<InlineEdit, 'text'>,
    draft: FieldDraft,
): { document: NativeDocument; caret: TextCaret; fieldId: string } {
    const block = editableTextBlock(document, { ...edit, text: '' }),
        id = crypto.randomUUID(),
        nextId = allocator(document);
    const attrs = Object.freeze({ ...createNativeFieldAttributes(draft), id, display: 'inline', x: 0, y: 0 });
    const field: NativeNode = Object.freeze({ id, kind: 'variable', attributes: attrs });
    const children = normalize(
        [
            ...sliceInlineContent(block.children ?? [], 0, edit.from),
            field,
            ...sliceInlineContent(block.children ?? [], edit.to, blockText(block).length),
        ],
        nextId,
    );
    return {
        document: update(document, block, [Object.freeze({ ...block, children })]),
        caret: { blockId: block.id, offset: edit.from + 1 },
        fieldId: id,
    };
}

export function updateNativeField(
    document: NativeDocument,
    fieldId: string,
    patch: Partial<FieldDraft>,
): NativeDocument {
    const field = nativeFields(document).find((field) => field.id === fieldId);
    if (!field) throw new Error('The contract field no longer exists');
    const participantChanged =
        patch.participant_id !== undefined &&
        String(patch.participant_id ?? '') !== String(field.attributes.participant_id ?? '');
    let attrs = createNativeFieldAttributes(
        {
            ...field.attributes,
            ...patch,
            ...(participantChanged ? { value: '' } : {}),
            type: (patch.type ?? field.attributes.type) as VariableType,
            name: patch.name ?? String(field.attributes.name ?? ''),
        },
        field.attributes,
    );
    if (field.floating) {
        const settings = fieldSettings(attrs),
            previous = fieldSettings(field.attributes);
        attrs = Object.freeze({
            ...attrs,
            settings: Object.freeze({
                ...settings,
                ...(typeof previous.widthPct === 'number' && Number(field.attributes.width) > 0
                    ? { widthPct: (previous.widthPct * Number(attrs.width)) / Number(field.attributes.width) }
                    : {}),
                ...(typeof previous.heightPct === 'number' && Number(field.attributes.height) > 0
                    ? { heightPct: (previous.heightPct * Number(attrs.height)) / Number(field.attributes.height) }
                    : {}),
            }),
        });
    }
    if (!field.floating) {
        const node = findNode(document, fieldId)!;
        return update(document, node, [Object.freeze({ ...node, attributes: attrs })]);
    }
    const blocks = document.root.attributes!.blockVariables as readonly Json[];
    return update(document, document.root, [
        Object.freeze({
            ...document.root,
            attributes: Object.freeze({
                ...document.root.attributes,
                blockVariables: Object.freeze(
                    blocks.map((value) => (isRecord(value) && value.id === fieldId ? attrs : value)),
                ),
            }),
        }),
    ]);
}

export function removeNativeField(
    document: NativeDocument,
    fieldId: string,
): { document: NativeDocument; caret?: TextCaret } {
    const field = nativeFields(document).find((field) => field.id === fieldId);
    if (!field) return { document };
    if (!field.floating)
        return {
            document: replaceInlineText(document, {
                blockId: field.blockId!,
                from: field.offset!,
                to: field.offset! + 1,
                text: '',
                expectedRevision: document.revision,
            }),
            caret: { blockId: field.blockId!, offset: field.offset! },
        };
    const blocks = document.root.attributes!.blockVariables as readonly Json[];
    return {
        document: update(document, document.root, [
            Object.freeze({
                ...document.root,
                attributes: Object.freeze({
                    ...document.root.attributes,
                    blockVariables: Object.freeze(blocks.filter((value) => !isRecord(value) || value.id !== fieldId)),
                }),
            }),
        ]),
    };
}

export function stampNativeFields(document: NativeDocument, scene: DocumentScene): NativeDocument {
    if (scene.documentId !== document.id || scene.revision !== document.revision)
        throw new Error('The field layout is stale');
    const positions = new Map<string, Attributes>();
    let stride = 0;
    for (const [index, page] of scene.pages.entries()) {
        for (const command of page.commands)
            if (command.kind === 'field')
                positions.set(command.nodeId, {
                    x: command.x / 0.75,
                    y: stride + command.y / 0.75,
                    width: command.width / 0.75,
                    height: command.height / 0.75,
                    page: index < (scene.coverPages ?? 0) ? 1 : index - (scene.coverPages ?? 0) + 1,
                    relativeXPct: command.x / page.width,
                    relativeYPct: command.y / page.height,
                    widthPct: command.width / page.width,
                    heightPct: command.height / page.height,
                });
        if (index >= (scene.coverPages ?? 0)) stride += page.height / 0.75 + 30;
    }
    const stamped = (attrs: Attributes, id: string): Attributes => {
        const position = positions.get(id);
        if (!position) return attrs;
        const { page, relativeXPct, relativeYPct, widthPct, heightPct, ...box } = position;
        return Object.freeze({
            ...attrs,
            id,
            ...box,
            settings: Object.freeze({ ...fieldSettings(attrs), page, relativeXPct, relativeYPct, widthPct, heightPct }),
        });
    };
    const visit = (node: NativeNode): NativeNode =>
        Object.freeze({
            ...node,
            ...(node.kind === 'variable' ? { attributes: stamped(node.attributes ?? {}, node.id) } : {}),
            ...(node.children ? { children: Object.freeze(node.children.map(visit)) } : {}),
        });
    const blocks = document.root.attributes?.blockVariables;
    const root = visit(document.root);
    return Object.freeze({
        ...document,
        root: Object.freeze({
            ...root,
            ...(Array.isArray(blocks)
                ? {
                      attributes: Object.freeze({
                          ...root.attributes,
                          blockVariables: Object.freeze(
                              blocks.map((value) =>
                                  isRecord(value) && typeof value.id === 'string' ? stamped(value, value.id) : value,
                              ),
                          ),
                      }),
                  }
                : {}),
        }),
    });
}
