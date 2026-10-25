import * as Y from 'yjs';
import { exportDocument, importDocument } from '../../document/codec.js';
import {
    copyJson,
    isRecord,
    type Attributes,
    type Json,
    type NativeDocument,
    type NativeMark,
    type NativeNode,
} from '../../document/model.js';
import { pdfPageNumbers } from '../../document/pdf-pages.js';
import { isTextBlock, textBlocks } from '../../document/text.js';
import { encodeSharedBytes, nativeSharedMarks, readSharedAttributes } from '../values.js';
import { identity, key } from './schema.js';
import type { SharedStore } from './store.js';

function nodeReader(store: SharedStore, view: NativeDocument): (address: string, depth?: number) => NativeNode {
    const visited = new Set<string>();
    const readNode = (address: string, depth = 0): NativeNode => {
        if (depth > 64 || visited.has(address) || visited.size > 100000)
            throw new Error('Invalid shared document structure');
        visited.add(address);
        const kind = store.registry.get(address),
            id = identity(address);
        if (typeof kind !== 'string') throw new Error('The shared node does not exist');
        const source = store.attributes(address),
            attrs: Record<string, Json> = { ...readSharedAttributes(source) };
        let children: NativeNode[] = [];
        if (isTextBlock({ kind, id })) {
            for (const delta of store.parts(address)) {
                const offset = delta.from;
                if (typeof delta.insert === 'string') {
                    const attributes = (delta.attributes ?? {}) as Record<string, Json>,
                        raw = attributes.textAttributes;
                    const marks = nativeSharedMarks(attributes),
                        relative = store.relativePosition(delta.source, offset);
                    const textId = `shared-text:${encodeSharedBytes(Y.encodeRelativePosition(relative))}`;
                    const textAttrs = isRecord(raw)
                        ? {
                              ...raw,
                              ...(raw.id !== undefined || raw.nativeId !== undefined ? { nativeId: textId } : {}),
                          }
                        : undefined;
                    children.push({
                        id: textId,
                        kind: 'text',
                        text: delta.insert,
                        ...(textAttrs ? { attributes: textAttrs } : {}),
                        ...(marks.length ? { marks } : {}),
                    });
                } else if (delta.insert && typeof delta.insert === 'object' && typeof delta.insert.node === 'string') {
                    if (store.visibleEmbed(delta.source, delta.insert))
                        children.push(readNode(delta.insert.node, depth + 1));
                } else throw new Error('Invalid shared inline content');
            }
        } else children = store.activeChildren(address).map((entry) => readNode(entry.id, depth + 1));
        if (kind === 'doc')
            for (const field of ['blockVariables', 'floatingImages']) {
                const values = store
                    .activeChildren(`${field}:${address}`)
                    .map((entry) => readNode(entry.id, depth + 1).attributes ?? {});
                if (values.length || source.has(JSON.stringify([field]))) attrs[field] = values;
            }
        if (kind === 'clause') {
            const variants = store.activeChildren(`variants:${address}`).map((entry, index) => {
                const raw = readSharedAttributes(store.attributes(entry.id));
                if (typeof raw.id !== 'string') throw new Error('Invalid shared clause variant');
                const body = store.activeChildren(`body:${entry.id}`)[0];
                if (!body) throw new Error('The shared clause variant has no body');
                const node = readNode(body.id, depth + 1);
                return {
                    ...raw,
                    id: raw.id,
                    isDefault: index === 0,
                    bodyContent: copyJson(exportDocument({ ...view, root: node })),
                    node,
                };
            });
            const active = variants.find((variant) => variant.id === attrs.activeVariantId) ?? variants[0];
            if (!active) throw new Error('The shared clause has no variants');
            children.push(active.node);
            attrs.id = active.id;
            attrs.activeVariantId = active.id;
            attrs.variantCount = variants.length;
            attrs.isDefaultVariant = active.isDefault;
            attrs.variants = variants.map((variant) =>
                Object.fromEntries(Object.entries(variant).filter(([key]) => key !== 'node')),
            ) as Json;
        }
        if (
            ['doc', 'tableCell', 'tableHeader', 'parallelCell', 'clauseBody', 'listItem', 'blockquote'].includes(
                kind,
            ) &&
            !children.length
        ) {
            const scope = (JSON.parse(address) as [string, string])[0];
            const base = `shared-empty:${address}`;
            let placeholder = base,
                sequence = 0;
            while (store.registry.has(key(scope, placeholder))) placeholder = `${base}:${++sequence}`;
            children.push({
                id: placeholder,
                kind: 'paragraph',
                attributes: { nativeId: placeholder },
                children: [],
            });
        }
        const rawMarks = source.get('@marks');
        return Object.freeze({
            id,
            kind,
            ...(Object.keys(attrs).length ? { attributes: copyJson(attrs) as Attributes } : {}),
            ...(Array.isArray(rawMarks) ? { marks: rawMarks as unknown as readonly NativeMark[] } : {}),
            ...(!['variable', 'image', 'hardBreak', 'horizontalRule', 'pdfPage'].includes(kind)
                ? { children: Object.freeze(children) }
                : {}),
        });
    };
    return readNode;
}

export function readSharedNode(store: SharedStore, view: NativeDocument, address: string): NativeNode {
    return nodeReader(store, view)(address);
}

export function readSharedDocument(store: SharedStore, view: NativeDocument, revision: number): NativeDocument {
    const root = store.meta.get('root');
    if (typeof root !== 'string') throw new Error('The shared document has no root');
    const parsed = importDocument(exportDocument({ ...view, root: readSharedNode(store, view, root) }), view.id);
    if (!textBlocks(parsed.root).length && !pdfPageNumbers(parsed))
        throw new Error('The shared document has no editable content');
    return Object.freeze({ ...parsed, revision });
}
