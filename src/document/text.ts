import type { NativeDocument, NativeNode } from './model.js';

const textBlockKinds = new Set(['paragraph', 'heading', 'clauseTitle', 'codeBlock']);

export function isTextBlock(node: NativeNode): boolean {
    return textBlockKinds.has(node.kind);
}

export function nodePath(document: NativeDocument, id: string): readonly NativeNode[] {
    const visit = (node: NativeNode): NativeNode[] | undefined => {
        if (node.id === id) return [node];
        for (const child of node.children ?? []) {
            const path = visit(child);
            if (path) return [node, ...path];
        }
    };
    return visit(document.root) ?? [];
}

export function textBlocks(root: NativeNode): NativeNode[] {
    if (isTextBlock(root)) return [root];
    return root.children?.flatMap(textBlocks) ?? [];
}

export function blockText(node: NativeNode): string {
    return (node.children ?? [])
        .map((child) => {
            if (child.kind === 'text') return child.text ?? '';
            if (child.kind === 'hardBreak') return '\n';
            if (child.kind === 'image' || child.kind === 'variable') return '\uFFFC';
            throw new Error(`Unsupported inline content: ${child.kind}`);
        })
        .join('');
}
