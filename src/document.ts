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

const supportedNodes = new Set([
    'doc',
    'paragraph',
    'text',
    'heading',
    'hardBreak',
    'horizontalRule',
    'blockquote',
    'codeBlock',
    'bulletList',
    'orderedList',
    'listItem',
    'image',
    'variable',
    'clause',
    'clauseTitle',
    'clauseBody',
    'parallelRow',
    'parallelCell',
    'table',
    'tableRow',
    'tableHeader',
    'tableCell',
    'tableRowGroup',
    'pdfPage',
]);

function object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nodeIdentity(value: Record<string, unknown>): string | undefined {
    const attrs = object(value.attrs) ? value.attrs : {};
    const original = typeof attrs.id === 'string' && attrs.id.trim() ? attrs.id : undefined;
    const native = typeof attrs.nativeId === 'string' && attrs.nativeId.trim() ? attrs.nativeId : undefined;
    return value.type === 'variable' ? original : (native ?? original);
}

export function copyJson(value: unknown): Json {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return Object.freeze(value.map(copyJson));
    if (object(value))
        return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyJson(item)])));
    throw new Error('Document metadata must contain JSON values');
}

export function importDocument(input: unknown, id: string): NativeDocument {
    if (!id.trim()) throw new Error('A document identity is required');
    const storedIds = new Set<string>();
    const collect = (value: unknown): void => {
        if (!object(value)) return;
        const stored = nodeIdentity(value);
        if (stored !== undefined) {
            if (storedIds.has(stored)) throw new Error(`Duplicate node identity: ${stored}`);
            storedIds.add(stored);
        }
        if (Array.isArray(value.content)) value.content.forEach(collect);
    };
    collect(input);
    const identifiers = new Set<string>();
    const visit = (value: unknown, path: string): NativeNode => {
        if (!object(value) || typeof value.type !== 'string' || !supportedNodes.has(value.type)) {
            throw new Error(`Unsupported document node at ${path}`);
        }
        if (value.attrs !== undefined && !object(value.attrs)) throw new Error(`Invalid attributes at ${path}`);
        const stored = nodeIdentity(value);
        let nodeId = stored ?? `${id}:${path}`;
        let sequence = 0;
        while (stored === undefined && (storedIds.has(nodeId) || identifiers.has(nodeId)))
            nodeId = `${id}:generated:${path}:${++sequence}`;
        if (identifiers.has(nodeId)) throw new Error(`Duplicate node identity: ${nodeId}`);
        identifiers.add(nodeId);
        if (value.content !== undefined && !Array.isArray(value.content))
            throw new Error(`Invalid children at ${path}`);
        if (value.text !== undefined && typeof value.text !== 'string') throw new Error(`Invalid text at ${path}`);
        if (value.marks !== undefined && !Array.isArray(value.marks)) throw new Error(`Invalid marks at ${path}`);
        const marks = value.marks as unknown[] | undefined;
        return Object.freeze({
            id: nodeId,
            kind: value.type,
            ...(value.attrs === undefined ? {} : { attributes: copyJson(value.attrs) as Attributes }),
            ...(value.text === undefined ? {} : { text: value.text as string }),
            ...(marks === undefined
                ? {}
                : {
                      marks: Object.freeze(
                          marks.map((mark): NativeMark => {
                              if (!object(mark) || typeof mark.type !== 'string')
                                  throw new Error(`Invalid mark at ${path}`);
                              if (mark.attrs !== undefined && !object(mark.attrs))
                                  throw new Error(`Invalid mark attributes at ${path}`);
                              return Object.freeze({
                                  kind: mark.type,
                                  ...(mark.attrs === undefined
                                      ? {}
                                      : { attributes: copyJson(mark.attrs) as Attributes }),
                              });
                          }),
                      ),
                  }),
            ...(value.content === undefined
                ? {}
                : {
                      children: Object.freeze(
                          (value.content as unknown[]).map((child, index) => visit(child, `${path}.${index}`)),
                      ),
                  }),
        });
    };
    const root = visit(input, 'root');
    if (root.kind !== 'doc') throw new Error('The document root must be doc');
    return Object.freeze({ schemaVersion: 1, id, revision: 0, root });
}

export function exportDocument(document: NativeDocument): unknown {
    const visit = (node: NativeNode): unknown => ({
        type: node.kind,
        ...(node.attributes === undefined ? {} : { attrs: node.attributes }),
        ...(node.text === undefined ? {} : { text: node.text }),
        ...(node.marks === undefined
            ? {}
            : {
                  marks: node.marks.map((mark) => ({
                      type: mark.kind,
                      ...(mark.attributes === undefined ? {} : { attrs: mark.attributes }),
                  })),
              }),
        ...(node.children === undefined ? {} : { content: node.children.map(visit) }),
    });
    return visit(document.root);
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

export interface TextReplacement {
    readonly nodeId: string;
    readonly from: number;
    readonly to: number;
    readonly text: string;
    readonly expectedRevision: number;
}

export function replaceText(document: NativeDocument, replacement: TextReplacement): NativeDocument {
    if (document.revision !== replacement.expectedRevision) throw new Error('Document revision conflict');
    const target = findNode(document, replacement.nodeId);
    if (target?.kind !== 'text' || target.text === undefined) throw new Error('The text anchor no longer exists');
    const { from, to } = replacement;
    const boundaries = new Set([
        0,
        target.text.length,
        ...Array.from(
            new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(target.text),
            (part) => part.index,
        ),
    ]);
    if (
        !Number.isSafeInteger(from) ||
        !Number.isSafeInteger(to) ||
        from > to ||
        !boundaries.has(from) ||
        !boundaries.has(to)
    ) {
        throw new Error('Text edits must use valid grapheme boundaries');
    }
    const nextText = target.text.slice(0, from) + replacement.text + target.text.slice(to);
    if (nextText === target.text) return document;
    const visit = (node: NativeNode): NativeNode => {
        if (node === target) return Object.freeze({ ...node, text: nextText });
        const children = node.children?.map(visit);
        return children?.some((child, index) => child !== node.children![index])
            ? Object.freeze({ ...node, children: Object.freeze(children) })
            : node;
    };
    return Object.freeze({ ...document, revision: document.revision + 1, root: visit(document.root) });
}

export class DocumentSession {
    private past: NativeNode[] = [];
    private future: NativeNode[] = [];

    constructor(public document: NativeDocument) {}

    get canUndo(): boolean {
        return this.past.length > 0;
    }
    get canRedo(): boolean {
        return this.future.length > 0;
    }

    reset(document: NativeDocument): void {
        this.document = Object.freeze({ ...document, revision: this.document.revision + 1 });
        this.past = [];
        this.future = [];
    }

    rebase(transform: (document: NativeDocument) => NativeDocument): { past: number[]; future: number[] } {
        const mapped = new Map<NativeNode, NativeNode>();
        const rootOf = (root: NativeNode): NativeNode => {
            if (mapped.has(root)) return mapped.get(root)!;
            const next = transform(Object.freeze({ ...this.document, root }));
            if (next.id !== this.document.id) throw new Error('Document identity conflict');
            mapped.set(root, next.root);
            return next.root;
        };
        const root = rootOf(this.document.root);
        const compact = (stack: NativeNode[]) => {
            let previous = root;
            const indices: number[] = [],
                roots: NativeNode[] = [];
            for (let index = stack.length - 1; index >= 0; index--) {
                const next = rootOf(stack[index]);
                if (next !== previous) {
                    indices.push(index);
                    roots.push(next);
                    previous = next;
                }
            }
            return { indices: indices.reverse(), roots: roots.reverse() };
        };
        const past = compact(this.past),
            future = compact(this.future);
        this.past = past.roots;
        this.future = future.roots;
        this.document = Object.freeze({ ...this.document, revision: this.document.revision + 1, root });
        return { past: past.indices, future: future.indices };
    }

    replace(replacement: TextReplacement): void {
        this.commit(replaceText(this.document, replacement));
    }

    commit(next: NativeDocument): void {
        if (next === this.document) return;
        if (next.id !== this.document.id || next.revision !== this.document.revision + 1)
            throw new Error('Document revision conflict');
        this.past.push(this.document.root);
        this.future = [];
        this.document = next;
    }

    undo(validate?: (document: NativeDocument) => void): boolean {
        const target = this.past.at(-1);
        if (target) validate?.({ ...this.document, root: target });
        const root = this.past.pop();
        if (!root) return false;
        this.future.push(this.document.root);
        this.document = Object.freeze({ ...this.document, revision: this.document.revision + 1, root });
        return true;
    }

    redo(validate?: (document: NativeDocument) => void): boolean {
        const target = this.future.at(-1);
        if (target) validate?.({ ...this.document, root: target });
        const root = this.future.pop();
        if (!root) return false;
        this.past.push(this.document.root);
        this.document = Object.freeze({ ...this.document, revision: this.document.revision + 1, root });
        return true;
    }
}

export { importDocument as importClmDocument, exportDocument as exportClmDocument };
