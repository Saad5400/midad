export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
export type Attributes = Readonly<Record<string, Json>>;

export interface NativeMark {
    readonly kind: string;
    readonly attributes?: Attributes;
}

export interface NativeNode {
    readonly id: string;
    readonly kind: string;
    readonly attributes?: Attributes;
    readonly text?: string;
    readonly marks?: readonly NativeMark[];
    readonly children?: readonly NativeNode[];
}

export interface NativeDocument {
    readonly schemaVersion: 1;
    readonly id: string;
    readonly revision: number;
    readonly root: NativeNode;
}

export function copyJson(value: unknown): Json {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return Object.freeze(value.map(copyJson));
    if (!!value && typeof value === 'object')
        return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyJson(item)])));
    throw new Error('Document metadata must contain JSON values');
}

const indexes = new WeakMap<NativeDocument, ReadonlyMap<string, NativeNode>>();

export function findNode(document: NativeDocument, id: string): NativeNode | undefined {
    let index = indexes.get(document);
    if (!index) {
        const nodes = new Map<string, NativeNode>();
        const visit = (node: NativeNode): void => {
            nodes.set(node.id, node);
            node.children?.forEach(visit);
        };
        visit(document.root);
        indexes.set(document, (index = nodes));
    }
    return index.get(id);
}

export const isRecord = (value: Json | undefined): value is Attributes =>
    !!value && typeof value === 'object' && !Array.isArray(value);
