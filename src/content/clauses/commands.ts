import { exportDocument, importDocument } from '../../document/codec.js';
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
    blockText,
    identity,
    nodePath,
    sliceInlineContent,
    textBlocks,
    update,
    type TextCaret,
} from '../../editing/text.js';

export interface ClauseVariant {
    readonly id: string;
    readonly description: Json;
    readonly bodyContent: Json;
    readonly isDefault: boolean;
    readonly contentHash: string | null;
    readonly [key: string]: Json;
}
export interface ClauseProperties {
    readonly ordered?: boolean;
    readonly isTitleHidden?: boolean;
    readonly optional?: boolean;
    readonly optionalValue?: boolean | null;
    readonly explanation?: Json;
}
export interface LibraryClause {
    readonly uuid: string;
    readonly title: string;
    readonly ordered?: boolean;
    readonly optional?: boolean;
    readonly is_title_hidden?: boolean;
    readonly explanation?: Json;
    readonly default_variant?: { readonly uuid: string } | null;
    readonly variants: readonly {
        readonly uuid: string;
        readonly description?: Json;
        readonly body_content: Json;
        readonly content_hash?: string | null;
    }[];
}
export interface ClauseResult {
    readonly document: NativeDocument;
    readonly caret: TextCaret;
}

const json = (document: NativeDocument, node: NativeNode): Json =>
    copyJson(exportDocument({ ...document, root: node }));
const fresh = (kind: string, children: readonly NativeNode[] = [], attrs: Attributes = {}): NativeNode => {
    const id = crypto.randomUUID();
    return Object.freeze({ id, kind, attributes: Object.freeze({ ...attrs, id }), children: Object.freeze(children) });
};
export function nativeClauses(document: NativeDocument): readonly NativeNode[] {
    const result: NativeNode[] = [];
    const visit = (node: NativeNode): void => {
        if (node.kind === 'clause') result.push(node);
        node.children?.forEach(visit);
    };
    visit(document.root);
    return result;
}
export function clauseContext(document: NativeDocument, blockId?: string): NativeNode | undefined {
    return blockId ? [...nodePath(document, blockId)].reverse().find((node) => node.kind === 'clause') : undefined;
}
export function clauseTitle(node: NativeNode): string {
    return (
        node.children
            ?.find((child) => child.kind === 'clauseTitle')
            ?.children?.map((child) => child.text ?? '')
            .join('') ?? ''
    );
}

export function clausePreview(document: NativeDocument, id: string, variantId?: string): Json {
    const node = requireClause(document, id);
    const variant = clauseVariants(document, node).find(
        (variant) => variant.id === (variantId ?? activeClauseVariant(node)),
    );
    const title = node.children?.find((child) => child.kind === 'clauseTitle');
    const live = node.children?.find((child) => child.kind === 'clauseBody');
    return copyJson({
        type: 'doc',
        attrs: { pageLayout: { margins: { top: 20, bottom: 20, left: 20, right: 20 } } },
        content: [
            {
                type: 'clause',
                attrs: { ...node.attributes, optional: false },
                content: [
                    title ? json(document, title) : null,
                    variant?.bodyContent ?? (live ? json(document, live) : null),
                ].filter(Boolean),
            },
        ],
    });
}
function requireClause(document: NativeDocument, id: string): NativeNode {
    const node = findNode(document, id);
    if (node?.kind !== 'clause') throw new Error('The clause no longer exists');
    return node;
}
export function activeClauseVariant(node: NativeNode): string {
    return String(node.attributes?.activeVariantId ?? node.attributes?.id ?? node.id);
}
export function clauseVariants(document: NativeDocument, node: NativeNode): readonly ClauseVariant[] {
    const active = activeClauseVariant(node);
    const live = node.children?.find((child) => child.kind === 'clauseBody');
    if (!live) throw new Error('The clause has no body');
    const raw = node.attributes?.variants;
    if (raw !== undefined && raw !== null && !Array.isArray(raw)) throw new Error('Invalid clause variants');
    const variants: ClauseVariant[] = [];
    const seen = new Set<string>();
    for (const entry of Array.isArray(raw) ? raw : []) {
        if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id || seen.has(entry.id))
            throw new Error('Invalid clause variant identity');
        seen.add(entry.id);
        variants.push(
            Object.freeze({
                ...entry,
                id: entry.id,
                description: entry.description ?? null,
                bodyContent: entry.id === active ? json(document, live) : (entry.bodyContent ?? null),
                isDefault: variants.length === 0,
                contentHash: typeof entry.contentHash === 'string' ? entry.contentHash : null,
            }),
        );
    }
    if (!seen.has(active))
        variants.push(
            Object.freeze({
                id: active,
                description: null,
                bodyContent: json(document, live),
                isDefault: variants.length === 0,
                contentHash: typeof node.attributes?.contentHash === 'string' ? node.attributes.contentHash : null,
            }),
        );
    return Object.freeze(variants);
}
export function persistClauseVariants(document: NativeDocument): NativeDocument {
    const visit = (node: NativeNode): NativeNode => {
        const children = node.children?.map(visit);
        const current =
            children?.every((child, index) => child === node.children![index]) === false
                ? Object.freeze({ ...node, children: Object.freeze(children) })
                : node;
        if (current.kind !== 'clause') return current;
        const variants = clauseVariants(document, current);
        const attributes = {
            ...current.attributes,
            activeVariantId: activeClauseVariant(current),
            variants: copyJson(variants),
            variantCount: variants.length,
            isDefaultVariant: variants[0].id === activeClauseVariant(current),
        };
        return JSON.stringify(attributes) === JSON.stringify(current.attributes)
            ? current
            : Object.freeze({ ...current, attributes: Object.freeze(attributes) });
    };
    const root = visit(document.root);
    return root === document.root ? document : Object.freeze({ ...document, root });
}
function body(document: NativeDocument, value: Json): NativeNode {
    if (
        value !== null &&
        !Array.isArray(value) &&
        !(isRecord(value) && ['doc', 'clauseBody'].includes(String(value.type)))
    )
        throw new Error('Invalid clause variant body');
    const input =
        isRecord(value) && value.type === 'clauseBody'
            ? value
            : {
                  type: 'clauseBody',
                  content:
                      isRecord(value) && value.type === 'doc'
                          ? (value.content ?? [])
                          : Array.isArray(value)
                            ? value
                            : [{ type: 'paragraph' }],
              };
    const parsed = importDocument({ type: 'doc', content: [input] }, `${document.id}:variant`).root.children![0];
    return parsed.children?.length
        ? parsed
        : Object.freeze({ ...parsed, children: Object.freeze([fresh('paragraph')]) });
}
function cloneTree(node: NativeNode, variables?: Map<string, string>): NativeNode {
    const id =
        node.kind === 'variable'
            ? variables
                ? (variables.get(node.id) ?? crypto.randomUUID())
                : node.id
            : crypto.randomUUID();
    if (node.kind === 'variable' && variables) variables.set(node.id, id);
    const attrs: Record<string, Json> = {
        ...node.attributes,
        id,
        ...(node.attributes?.nativeId !== undefined ? { nativeId: id } : {}),
    };
    if (node.kind === 'variable' && variables) {
        attrs.participant_id = null;
        if (['signature', 'stamp', 'initials'].includes(String(attrs.type))) {
            attrs.value = '';
            attrs.reference_id = null;
        }
    }
    return Object.freeze({
        ...node,
        id,
        attributes: Object.freeze(attrs),
        ...(node.children
            ? { children: Object.freeze(node.children.map((child) => cloneTree(child, variables))) }
            : {}),
    });
}
function caret(node: NativeNode): TextCaret {
    const preferred = node.attributes?.isTitleHidden
        ? node.children?.find((child) => child.kind === 'clauseBody')
        : node;
    const block = textBlocks(preferred ?? node)[0];
    if (!block) throw new Error('The clause has no editable paragraph');
    return { blockId: block.id, offset: 0 };
}
export function createNativeClause(document: NativeDocument, title = '', source?: LibraryClause): NativeNode {
    const variables = new Map<string, string>();
    const rawVariants = source?.variants ?? [];
    const variants = rawVariants.map(
        (variant, index): ClauseVariant =>
            Object.freeze({
                id: variant.uuid,
                description: variant.description ?? null,
                bodyContent: json(document, cloneTree(body(document, variant.body_content), variables)),
                isDefault: index === 0,
                contentHash: variant.content_hash ?? null,
            }),
    );
    if (!variants.length)
        variants.push(
            Object.freeze({
                id: crypto.randomUUID(),
                description: null,
                bodyContent: json(document, fresh('clauseBody', [fresh('paragraph')])),
                isDefault: true,
                contentHash: null,
            }),
        );
    const selected = variants.find((variant) => variant.id === source?.default_variant?.uuid) ?? variants[0];
    const titleNode = fresh(
        'clauseTitle',
        title ? [Object.freeze({ id: crypto.randomUUID(), kind: 'text', text: title })] : [],
    );
    const node = fresh('clause', [titleNode, body(document, selected.bodyContent)], {
        groupId: source?.uuid ?? crypto.randomUUID(),
        activeVariantId: selected.id,
        ordered: source?.ordered ?? true,
        optional: source?.optional ?? false,
        optionalValue: null,
        isTitleHidden: source?.is_title_hidden ?? false,
        explanation: source?.explanation ?? null,
        variants: copyJson(variants),
        variantCount: variants.length,
        isDefaultVariant: selected.id === variants[0].id,
        contentHash: selected.contentHash,
    });
    return Object.freeze({
        ...node,
        attributes: Object.freeze({ ...node.attributes, id: selected.id, nativeId: node.id }),
    });
}
export function insertNativeClause(document: NativeDocument, at?: TextCaret, source?: LibraryClause): ClauseResult {
    const clause = createNativeClause(document, source?.title ?? '', source);
    const path = at ? nodePath(document, at.blockId) : [];
    const enclosing = path.find((node) => node.kind === 'clause');
    if (enclosing) return { document: update(document, enclosing, [enclosing, clause]), caret: caret(clause) };
    const block = path.at(-1);
    if (block && at && ['paragraph', 'heading'].includes(block.kind)) {
        const length = blockText(block).length;
        if (!Number.isSafeInteger(at.offset) || at.offset < 0 || at.offset > length)
            throw new Error('Choose a valid insertion point');
        const parts: NativeNode[] = [];
        if (at.offset)
            parts.push(
                Object.freeze({
                    ...block,
                    children: Object.freeze(sliceInlineContent(block.children ?? [], 0, at.offset)),
                }),
            );
        parts.push(clause);
        if (at.offset < length)
            parts.push(
                Object.freeze({
                    ...(at.offset ? identity(block, crypto.randomUUID()) : block),
                    children: Object.freeze(sliceInlineContent(block.children ?? [], at.offset, length)),
                }),
            );
        return { document: update(document, block, parts), caret: caret(clause) };
    }
    return {
        document: update(document, document.root, [
            Object.freeze({ ...document.root, children: Object.freeze([...(document.root.children ?? []), clause]) }),
        ]),
        caret: caret(clause),
    };
}
export function setClauseProperties(document: NativeDocument, id: string, patch: ClauseProperties): NativeDocument {
    const clause = requireClause(document, id);
    for (const [key, value] of Object.entries(patch)) {
        if (!['ordered', 'isTitleHidden', 'optional', 'optionalValue', 'explanation'].includes(key))
            throw new Error('Unknown clause property');
        if (key !== 'explanation' && !(typeof value === 'boolean' || (key === 'optionalValue' && value === null)))
            throw new Error('Invalid clause property');
    }
    copyJson(patch);
    const optionalChanged = patch.optional !== undefined && patch.optional !== (clause.attributes?.optional === true);
    const visit = (node: NativeNode): NativeNode => {
        const children = node.children?.map(visit);
        const selected = node.id === id;
        const grouped =
            optionalChanged &&
            node.kind === 'clause' &&
            !!clause.attributes?.groupId &&
            node.attributes?.groupId === clause.attributes.groupId;
        const attributes = selected
            ? {
                  ...node.attributes,
                  ...patch,
                  ...(optionalChanged ? { optionalValue: patch.optional ? (patch.optionalValue ?? null) : null } : {}),
              }
            : grouped
              ? { ...node.attributes, optional: patch.optional!, optionalValue: null }
              : node.attributes;
        if (
            JSON.stringify(attributes) === JSON.stringify(node.attributes) &&
            children?.every((child, index) => child === node.children![index]) !== false
        )
            return node;
        return Object.freeze({
            ...node,
            ...(attributes ? { attributes: Object.freeze(attributes) as Attributes } : {}),
            ...(children ? { children: Object.freeze(children) } : {}),
        });
    };
    const root = visit(document.root);
    return root === document.root ? document : Object.freeze({ ...document, root, revision: document.revision + 1 });
}
export type ClauseVariantAction =
    | { readonly kind: 'select'; readonly id: string }
    | { readonly kind: 'add' }
    | { readonly kind: 'remove'; readonly id: string }
    | { readonly kind: 'move'; readonly id: string; readonly delta: -1 | 1 }
    | { readonly kind: 'describe'; readonly id: string; readonly description: string; readonly locale?: string };
export function changeClauseVariant(document: NativeDocument, id: string, action: ClauseVariantAction): ClauseResult {
    const clause = requireClause(document, id);
    let variants = [...clauseVariants(document, clause)],
        active = activeClauseVariant(clause);
    if (action.kind === 'add') {
        const current = variants.find((variant) => variant.id === active)!;
        active = crypto.randomUUID();
        variants.push(
            Object.freeze({
                ...current,
                id: active,
                description: null,
                bodyContent: json(document, cloneTree(body(document, current.bodyContent))),
                contentHash: null,
                isDefault: false,
            }),
        );
    } else {
        const index = variants.findIndex((variant) => variant.id === action.id);
        if (index < 0) throw new Error('The clause variant no longer exists');
        if (action.kind === 'select') active = action.id;
        else if (action.kind === 'remove') {
            if (variants.length === 1) throw new Error('Keep at least one clause variant');
            variants.splice(index, 1);
            if (active === action.id) active = variants[0].id;
        } else if (action.kind === 'move') {
            const target = index + action.delta;
            if (target >= 0 && target < variants.length) {
                const [moved] = variants.splice(index, 1);
                variants.splice(target, 0, moved);
            }
        } else {
            const previous = variants[index].description;
            const description = action.description.trim();
            variants[index] = Object.freeze({
                ...variants[index],
                description: !description
                    ? null
                    : isRecord(previous)
                      ? copyJson({ ...previous, [action.locale ?? Object.keys(previous)[0] ?? 'ar']: description })
                      : description,
            });
        }
    }
    variants = variants.map((variant, index) => Object.freeze({ ...variant, isDefault: index === 0 }));
    const target = variants.find((variant) => variant.id === active)!;
    const previousBody = clause.children?.find((child) => child.kind === 'clauseBody');
    const nextBody = body(document, target.bodyContent ?? (previousBody ? json(document, previousBody) : null));
    const outside = new Set<string>();
    const collect = (node: NativeNode): void => {
        if (node === previousBody) return;
        outside.add(node.id);
        node.children?.forEach(collect);
    };
    collect(document.root);
    const repair = (node: NativeNode): NativeNode => {
        const current = outside.has(node.id) ? identity(node, crypto.randomUUID()) : node;
        outside.add(current.id);
        return Object.freeze({
            ...current,
            ...(current.children ? { children: Object.freeze(current.children.map(repair)) } : {}),
        });
    };
    const next = Object.freeze({
        ...clause,
        attributes: Object.freeze({
            ...clause.attributes,
            id: active,
            nativeId: clause.id,
            activeVariantId: active,
            variants: copyJson(variants),
            variantCount: variants.length,
            isDefaultVariant: target.isDefault,
            contentHash: target.contentHash,
        }),
        children: Object.freeze([clause.children!.find((child) => child.kind === 'clauseTitle')!, repair(nextBody)]),
    });
    return { document: update(document, clause, [next]), caret: caret(next) };
}
export function removeNativeClause(document: NativeDocument, id: string, unwrap = false): ClauseResult {
    const clause = requireClause(document, id);
    const title = clause.children?.find((child) => child.kind === 'clauseTitle');
    const replacement = unwrap
        ? [
              ...(title
                  ? [
                        Object.freeze({
                            ...title,
                            kind: 'heading',
                            attributes: Object.freeze({ ...title.attributes, level: 3 }),
                        }),
                    ]
                  : []),
              ...(clause.children?.find((child) => child.kind === 'clauseBody')?.children ?? []),
          ]
        : [];
    let next = update(document, clause, replacement);
    const repair = (node: NativeNode): NativeNode => {
        if (
            ['tableCell', 'tableHeader', 'parallelCell', 'clauseBody', 'blockquote', 'listItem'].includes(node.kind) &&
            !node.children?.length
        )
            return Object.freeze({ ...node, children: Object.freeze([fresh('paragraph')]) });
        const children = node.children?.map(repair);
        return children?.some((child, index) => child !== node.children![index])
            ? Object.freeze({ ...node, children: Object.freeze(children) })
            : node;
    };
    const root = repair(next.root);
    if (root !== next.root) next = Object.freeze({ ...next, root });
    if (!textBlocks(next.root).length)
        next = Object.freeze({
            ...next,
            root: Object.freeze({
                ...next.root,
                children: Object.freeze([...(next.root.children ?? []), fresh('paragraph')]),
            }),
        });
    const block = textBlocks(next.root)[0];
    return { document: next, caret: { blockId: block.id, offset: 0 } };
}
