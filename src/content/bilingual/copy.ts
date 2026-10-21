import { copyJson, isRecord, type Attributes, type Json, type NativeNode } from '../../document/model.js';
import { isTextBlock } from '../../editing/text.js';
import { languageDirection } from '../../typography/direction.js';

const identityKeys = new Set(['id', 'nativeId']);
const derivedClause = new Set(['groupId', 'activeVariantId', 'contentHash', 'variantCount', 'isDefaultVariant']);
export function bilingualContentKey(nodes: readonly NativeNode[]): string {
    const visit = (node: NativeNode): Json => {
        const attrs = Object.fromEntries(
            Object.entries(node.attributes ?? {}).filter(
                ([name]) => !identityKeys.has(name) && !(node.kind === 'clause' && derivedClause.has(name)),
            ),
        );
        if (node.kind === 'clause' && Array.isArray(attrs.variants)) {
            const active = node.attributes?.activeVariantId ?? node.attributes?.id ?? node.id;
            attrs.variants = attrs.variants.flatMap((entry) => {
                if (!isRecord(entry)) return [entry];
                const value = Object.fromEntries(
                    Object.entries(entry).filter(
                        ([name]) =>
                            !['id', 'contentHash', 'isDefault'].includes(name) &&
                            !(entry.id === active && name === 'bodyContent'),
                    ),
                );
                return Object.values(value).some((value) => value !== null) ? [value] : [];
            });
        }
        if (
            node.kind === 'clause' &&
            (attrs.variants === null || (Array.isArray(attrs.variants) && !attrs.variants.length))
        )
            delete attrs.variants;
        return {
            kind: node.kind,
            ...(node.text !== undefined ? { text: node.text } : {}),
            ...(node.marks ? { marks: copyJson(node.marks) } : {}),
            attrs: copyJson(attrs),
            ...(node.children ? { children: node.children.map(visit) } : {}),
        };
    };
    const ordered = (value: Json): Json =>
        Array.isArray(value)
            ? value.map(ordered)
            : isRecord(value)
              ? Object.fromEntries(
                    Object.entries(value)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([name, child]) => [name, ordered(child)]),
                )
              : value;
    return JSON.stringify(ordered(nodes.map(visit)));
}

export function copyBilingualContent(
    nodes: readonly NativeNode[],
    from: string,
    to: string,
    direction: 'rtl' | 'ltr',
    baseline: readonly NativeNode[] = [],
): readonly NativeNode[] {
    const ids = new Map<string, string>();
    const fields = new Map<string, string>();
    const used = new Set<string>();
    const targetFor = new Map<string, NativeNode>();
    const seed = (source: NativeNode, target?: NativeNode): void => {
        if (!target || source.kind !== target.kind || source.id === target.id) return;
        ids.set(source.id, target.id);
        used.add(target.id);
        targetFor.set(source.id, target);
        if (
            source.kind === 'variable' &&
            typeof source.attributes?.id === 'string' &&
            typeof target.attributes?.id === 'string' &&
            source.attributes.id !== target.attributes.id
        )
            fields.set(source.attributes.id, target.attributes.id);
        source.children?.forEach((child, index) => seed(child, target.children?.[index]));
    };
    nodes.forEach((node, index) => seed(node, baseline[index]));
    const blocks = (values: readonly NativeNode[]): NativeNode[] =>
        values.flatMap((node) => (isTextBlock(node) ? [node] : blocks(node.children ?? [])));
    const available = blocks(baseline).filter((block) => !used.has(block.id));
    blocks(nodes).forEach((block) => {
        if (ids.has(block.id)) return;
        const index = available.findIndex((target) => target.kind === block.kind);
        if (index < 0) return;
        const target = available.splice(index, 1)[0];
        ids.set(block.id, target.id);
        targetFor.set(block.id, target);
    });
    const identity = (map: Map<string, string>, source: string): string => {
        let value = map.get(source);
        if (!value) {
            value = crypto.randomUUID();
            map.set(source, value);
        }
        return value;
    };
    const visit = (node: NativeNode, inline = false): NativeNode => {
        const id = identity(ids, node.id);
        const attrs: Record<string, Json> = { ...(copyJson(node.attributes ?? {}) as Attributes) };
        if (node.kind !== 'text') {
            attrs.id = node.kind === 'variable' ? identity(fields, String(node.attributes?.id ?? node.id)) : id;
            attrs.nativeId = id;
            if (node.kind !== 'variable' && !inline) {
                if (attrs.dir !== undefined) attrs.dir = attrs.dirLocked ? languageDirection(to, direction) : 'auto';
                if (languageDirection(from, direction) !== languageDirection(to, direction)) {
                    if (attrs.textAlign === 'left') attrs.textAlign = 'right';
                    else if (attrs.textAlign === 'right') attrs.textAlign = 'left';
                }
            }
        }
        if (node.kind === 'clause') {
            const target = targetFor.get(node.id);
            attrs.groupId =
                target?.attributes?.groupId !== node.attributes?.groupId &&
                typeof target?.attributes?.groupId === 'string'
                    ? target.attributes.groupId
                    : crypto.randomUUID();
            attrs.activeVariantId =
                target?.attributes?.activeVariantId !== node.attributes?.activeVariantId &&
                typeof target?.attributes?.activeVariantId === 'string'
                    ? target.attributes.activeVariantId
                    : crypto.randomUUID();
            attrs.variants = null;
            attrs.variantCount = 1;
            attrs.isDefaultVariant = true;
            attrs.contentHash = null;
        }
        return Object.freeze({
            id,
            kind: node.kind,
            ...(node.text !== undefined ? { text: node.text } : {}),
            ...(node.marks ? { marks: node.marks } : {}),
            ...(node.kind !== 'text' || node.attributes ? { attributes: Object.freeze(attrs) } : {}),
            ...(node.children
                ? { children: Object.freeze(node.children.map((child) => visit(child, isTextBlock(node)))) }
                : {}),
        });
    };
    return Object.freeze(nodes.map((node) => visit(node)));
}
