import type { Attributes, NativeDocument, NativeNode } from './model.js';

export function persistNativeIdentities(document: NativeDocument): NativeDocument {
    const visit = (node: NativeNode): NativeNode => {
        const children = node.children?.map(visit);
        let attributes: Attributes | undefined = node.attributes;
        if (node.kind !== 'text' && node.kind !== 'variable') {
            const existing = attributes?.id;
            const missing =
                existing === undefined || existing === null || (typeof existing === 'string' && !existing.trim());
            const key = attributes?.nativeId !== undefined || (!missing && existing !== node.id) ? 'nativeId' : 'id';
            if (attributes?.[key] !== node.id) attributes = Object.freeze({ ...attributes, [key]: node.id });
        }
        if (
            attributes === node.attributes &&
            children?.every((child, index) => child === node.children![index]) !== false
        )
            return node;
        return Object.freeze({
            ...node,
            ...(attributes ? { attributes } : {}),
            ...(children ? { children: Object.freeze(children) } : {}),
        });
    };
    const root = visit(document.root);
    return root === document.root ? document : Object.freeze({ ...document, root });
}
