import type { NativeDocument, NativeNode } from './document.js';
import { nodePath, textBlocks, type TextCaret } from './editing.js';

export interface BlockContext {
    readonly node: NativeNode;
    readonly index: number;
    readonly canMoveUp: boolean;
    readonly canMoveDown: boolean;
}

export function blockContext(document: NativeDocument, id: string): BlockContext | undefined {
    const node = nodePath(document, id)[1];
    if (!node || node.kind === 'pdfPage') return;
    const children = document.root.children ?? [];
    const index = children.indexOf(node);
    return {
        node,
        index,
        canMoveUp: index > 0 && children[index - 1].kind !== 'pdfPage',
        canMoveDown: index < children.length - 1 && children[index + 1].kind !== 'pdfPage',
    };
}

export function moveBlock(
    document: NativeDocument,
    id: string,
    targetId: string,
    side: 'before' | 'after',
): NativeDocument {
    const source = blockContext(document, id),
        target = blockContext(document, targetId);
    if (!source || !target || source.node === target.node) return document;
    const children = [...document.root.children!];
    const between = children.slice(Math.min(source.index, target.index), Math.max(source.index, target.index) + 1);
    if (between.some((node) => node.kind === 'pdfPage')) return document;
    children.splice(source.index, 1);
    children.splice(children.indexOf(target.node) + (side === 'after' ? 1 : 0), 0, source.node);
    if (children.every((node, index) => node === document.root.children![index])) return document;
    return Object.freeze({
        ...document,
        revision: document.revision + 1,
        root: Object.freeze({ ...document.root, children: Object.freeze(children) }),
    });
}

export function moveBlockStep(document: NativeDocument, id: string, direction: 'up' | 'down'): NativeDocument {
    const context = blockContext(document, id);
    if (!context || !(direction === 'up' ? context.canMoveUp : context.canMoveDown)) return document;
    return moveBlock(
        document,
        id,
        document.root.children![context.index + (direction === 'up' ? -1 : 1)].id,
        direction === 'up' ? 'before' : 'after',
    );
}

export function deleteBlock(
    document: NativeDocument,
    id: string,
): { document: NativeDocument; caret: TextCaret } | undefined {
    const context = blockContext(document, id);
    if (!context) return;
    const children = document.root.children!.filter((node) => node !== context.node);
    if (!children.some((node) => textBlocks(node).length)) {
        const id = crypto.randomUUID();
        children.push(
            Object.freeze({
                id,
                kind: 'paragraph',
                attributes: Object.freeze({ nativeId: id }),
                children: Object.freeze([]),
            }),
        );
    }
    const block = children.slice(context.index).flatMap(textBlocks)[0] ?? children.flatMap(textBlocks).at(-1)!;
    return {
        document: Object.freeze({
            ...document,
            revision: document.revision + 1,
            root: Object.freeze({ ...document.root, children: Object.freeze(children) }),
        }),
        caret: { blockId: block.id, offset: 0 },
    };
}
