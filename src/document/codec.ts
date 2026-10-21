import { copyJson, type Attributes, type NativeDocument, type NativeMark, type NativeNode } from './model.js';

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

export { exportDocument as exportClmDocument, importDocument as importClmDocument };
