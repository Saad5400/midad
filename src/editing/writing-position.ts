import { findNode, type NativeDocument, type NativeNode } from '../document/model.js';
import { allocator, nodePath, update, type TextCaret } from './text.js';
import type { NativeSelection } from './selection.js';

export interface WritingTarget {
    readonly containerId?: string;
    readonly afterId?: string;
}
export interface WritingResult {
    readonly document: NativeDocument;
    readonly caret?: TextCaret;
}
const containers = new Set(['doc', 'tableCell', 'tableHeader', 'parallelCell', 'clauseBody', 'listItem', 'blockquote']);

export function resolveWritingTarget(
    document: NativeDocument,
    target?: WritingTarget,
): { container: NativeNode; index: number } {
    const after = target?.afterId ? nodePath(document, target.afterId) : undefined;
    if (target?.afterId && (!after || after.length < 2)) throw new Error('The writing anchor no longer exists');
    const container = after?.at(-2) ?? (target?.containerId ? findNode(document, target.containerId) : document.root);
    if (!container || !containers.has(container.kind) || (target?.containerId && container.id !== target.containerId))
        throw new Error('The writing container is not available');
    if (container.kind === 'doc' && container.children?.some((node) => node.kind === 'pdfPage'))
        throw new Error('Flow content cannot be inserted into an imported PDF');
    return {
        container,
        index: after ? (container.children ?? []).indexOf(after.at(-1)!) + 1 : (container.children?.length ?? 0),
    };
}

export function writeAtPosition<T extends WritingResult>(
    document: NativeDocument,
    selection: NativeSelection | null,
    target: WritingTarget | undefined,
    action: (document: NativeDocument, selection: NativeSelection) => T | undefined | null,
): T | undefined {
    let working = document,
        selected = selection;
    if (!selected) {
        const { container: parent, index } = resolveWritingTarget(document, target);
        const id = allocator(document)();
        const paragraph: NativeNode = Object.freeze({
            id,
            kind: 'paragraph',
            attributes: Object.freeze({ nativeId: id }),
            children: Object.freeze([]),
        });
        const children = [...(parent.children ?? [])];
        children.splice(index, 0, paragraph);
        const prepared = update(document, parent, [Object.freeze({ ...parent, children: Object.freeze(children) })]);
        working = Object.freeze({ ...prepared, revision: document.revision });
        selected = { anchor: { blockId: id, offset: 0 }, focus: { blockId: id, offset: 0 } };
    }
    const result = action(working, selected);
    if (!result || result.document === working || result.document.root === document.root) return;
    if (result.document.id !== document.id) throw new Error('Document identity conflict');
    return { ...result, document: Object.freeze({ ...result.document, revision: document.revision + 1 }) };
}
