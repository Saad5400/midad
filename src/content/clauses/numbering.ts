import type { NativeDocument, NativeNode } from '../../document/model.js';

export function rejectedClause(node: NativeNode): boolean {
    return (
        node.attributes?.optional === true &&
        [false, 'false', '0'].includes(node.attributes.optionalValue as boolean | string)
    );
}
export function clauseNumbers(document: NativeDocument): ReadonlyMap<string, number> {
    const numbers = new Map<string, number>();
    let order = 0;
    const visit = (node: NativeNode): void => {
        if (node.kind === 'parallelRow') {
            const start = order;
            let end = order;
            for (const cell of node.children ?? []) {
                order = start;
                visit(cell);
                end = Math.max(end, order);
            }
            order = end;
            return;
        }
        if (node.kind === 'clause' && node.attributes?.ordered !== false && !rejectedClause(node))
            numbers.set(node.id, ++order);
        node.children?.forEach(visit);
    };
    visit(document.root);
    return numbers;
}
export function persistClauseNumbers(document: NativeDocument): NativeDocument {
    const numbers = clauseNumbers(document);
    const visit = (node: NativeNode): NativeNode => {
        const children = node.children?.map(visit);
        const order = numbers.get(node.id);
        const changed = order !== undefined && node.attributes?.order !== order;
        if (!changed && children?.every((child, index) => child === node.children![index]) !== false) return node;
        return Object.freeze({
            ...node,
            ...(changed ? { attributes: Object.freeze({ ...node.attributes, order }) } : {}),
            ...(children ? { children: Object.freeze(children) } : {}),
        });
    };
    const root = visit(document.root);
    return root === document.root ? document : Object.freeze({ ...document, root });
}
