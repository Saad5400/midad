import { exportDocument } from '../../document/codec.js';
import { copyJson, findNode, isRecord, type Json, type NativeDocument, type NativeNode } from '../../document/model.js';
import { nodePath } from '../../document/text.js';

export interface ClauseVariant {
    readonly id: string;
    readonly description: Json;
    readonly bodyContent: Json;
    readonly isDefault: boolean;
    readonly contentHash: string | null;
    readonly [key: string]: Json;
}
const json = (document: NativeDocument, node: NativeNode): Json =>
    copyJson(exportDocument({ ...document, root: node }));
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
export function requireClause(document: NativeDocument, id: string): NativeNode {
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
