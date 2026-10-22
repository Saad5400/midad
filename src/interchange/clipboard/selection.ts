import { findNode, type NativeDocument, type NativeNode } from '../../document/model.js';
import { selectionRanges, type NativeSelection } from '../../editing/selection.js';
import { selectedTableFragment } from '../../editing/tables.js';
import { sliceInlineContent } from '../../editing/text.js';
import { textKinds, type NativeFragment } from './model.js';

function treePath(root: NativeNode, id: string): NativeNode[] | undefined {
    if (root.id === id) return [root];
    for (const child of root.children ?? []) {
        const path = treePath(child, id);
        if (path) return [root, ...path];
    }
}

export function selectionFragment(document: NativeDocument, selection: NativeSelection): NativeFragment {
    if (selection.cells) {
        const table = selectedTableFragment(document, selection.cells);
        return { blocks: table ? [table] : [] };
    }
    const ranges = selectionRanges(document, selection),
        first = ranges[0],
        last = ranges.at(-1)!;
    const selected = new Map(ranges.map((range) => [range.blockId, range]));
    const scoped = selection.scopeId ? findNode(document, selection.scopeId) : undefined;
    if (scoped && !textKinds.has(scoped.kind)) return { blocks: scoped.children ?? [] };
    const start = treePath(document.root, first.blockId)!,
        end = treePath(document.root, last.blockId)!;
    let depth = 0;
    while (depth + 1 < Math.min(start.length, end.length) && start[depth + 1] === end[depth + 1]) depth++;
    if (['tableRow', 'tableRowGroup'].includes(start[depth].kind))
        while (depth > 0 && start[depth].kind !== 'table') depth--;
    const root = start[depth];
    let inside = false;
    const extract = (node: NativeNode): NativeNode | undefined => {
        const range = selected.get(node.id);
        if (range) {
            inside = node.id !== last.blockId;
            return Object.freeze({
                ...node,
                children: Object.freeze(sliceInlineContent(node.children ?? [], range.from, range.to)),
            });
        }
        if (!node.children) return inside ? node : undefined;
        const children = node.children.flatMap((child) => {
            const copy = extract(child);
            return copy ? [copy] : [];
        });
        if (!children.length) return;
        const offset =
            node.kind === 'orderedList'
                ? Math.max(
                      0,
                      node.children.findIndex((child) => !!treePath(child, first.blockId)),
                  )
                : 0;
        return Object.freeze({
            ...node,
            ...(offset
                ? {
                      attributes: Object.freeze({
                          ...node.attributes,
                          start: Number(node.attributes?.start ?? 1) + offset,
                      }),
                  }
                : {}),
            children: Object.freeze(children),
        });
    };
    const fragment = extract(root);
    if (!fragment) return { blocks: [] };
    return {
        blocks: ['doc', 'tableCell', 'tableHeader', 'listItem', 'clauseBody', 'parallelCell'].includes(root.kind)
            ? (fragment.children ?? [])
            : [fragment],
    };
}

export function fragmentText(fragment: NativeFragment): string {
    const render = (node: NativeNode): string => {
        if (node.kind === 'text') return node.text ?? '';
        if (node.kind === 'hardBreak') return '\n';
        if (node.kind === 'variable') return String(node.attributes?.value ?? node.attributes?.label ?? '\uFFFC');
        if (node.kind === 'image') return typeof node.attributes?.alt === 'string' ? node.attributes.alt : '';
        return (node.children ?? [])
            .map(render)
            .join(textKinds.has(node.kind) ? '' : node.kind === 'tableRow' ? '\t' : '\n');
    };
    return fragment.blocks.map(render).join('\n');
}
