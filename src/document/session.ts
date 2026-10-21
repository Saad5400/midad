import { findNode, type NativeDocument, type NativeNode } from './model.js';

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
