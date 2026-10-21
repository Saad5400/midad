import { findNode, type NativeDocument, type NativeNode } from '../document/model.js';
import { selectionRanges, type NativeSelection } from './selection.js';
import {
    allocator,
    blockText,
    identity,
    nodePath,
    normalize,
    parentOf,
    sliceInlineContent,
    update,
    type InlineEdit,
    type TextCaret,
} from './text.js';

export type ListKind = 'bulletList' | 'orderedList';
export interface StructureResult {
    document: NativeDocument;
    caret: TextCaret;
}
const isList = (node?: NativeNode): boolean => node?.kind === 'bulletList' || node?.kind === 'orderedList';
const childrenOf = (node: NativeNode, children: readonly NativeNode[]): NativeNode =>
    Object.freeze({ ...node, children: Object.freeze(children) });

export function listContext(
    document: NativeDocument,
    blockId: string,
): { list: NativeNode; item: NativeNode } | undefined {
    const path = nodePath(document, blockId);
    for (let index = path.length - 1; index > 0; index--)
        if (path[index].kind === 'listItem' && isList(path[index - 1]))
            return { list: path[index - 1], item: path[index] };
}

function listSlice(list: NativeNode, from: number, to: number, nextId: () => string): NativeNode | undefined {
    if (from === to) return;
    const start = Number(list.attributes?.start ?? 1) + from;
    return identity(
        {
            ...list,
            ...(list.kind === 'orderedList' ? { attributes: Object.freeze({ ...list.attributes, start }) } : {}),
            children: Object.freeze(list.children!.slice(from, to)),
        },
        from ? nextId() : list.id,
    );
}

export function toggleList(document: NativeDocument, selection: NativeSelection, kind: ListKind): NativeDocument {
    const ranges = selectionRanges(document, selection);
    if (!ranges.length) return document;
    const selected = new Set(ranges.map((range) => range.blockId));
    const contexts = ranges.map((range) => listContext(document, range.blockId));
    const nextId = allocator(document);
    if (contexts.every((context) => context && context.list === contexts[0]!.list)) {
        const list = contexts[0]!.list;
        if (list.kind === kind) return indentList(document, selection, true);
        const indices = contexts.map((context) => list.children!.indexOf(context!.item));
        const from = Math.min(...indices),
            to = Math.max(...indices) + 1;
        const before = listSlice(list, 0, from, nextId),
            after = listSlice(list, to, list.children!.length, nextId);
        const items = list.children!.slice(from, to);
        const middle = [
            identity(
                {
                    ...list,
                    kind,
                    attributes: Object.freeze({ ...list.attributes, start: 1 }),
                    children: Object.freeze(items),
                },
                from ? nextId() : list.id,
            ),
        ];
        return update(document, list, [...(before ? [before] : []), ...middle, ...(after ? [after] : [])]);
    }
    const transform = (node: NativeNode): readonly NativeNode[] => {
        if (!node.children) return [node];
        if (isList(node) && node.children.some((item) => item.children?.some((child) => selected.has(child.id)))) {
            const output: NativeNode[] = [];
            let from = 0;
            while (from < node.children.length) {
                const active = node.children[from].children?.some((child) => selected.has(child.id)) ?? false;
                let to = from + 1;
                while (
                    to < node.children.length &&
                    (node.children[to].children?.some((child) => selected.has(child.id)) ?? false) === active
                )
                    to++;
                const part = listSlice(node, from, to, nextId)!;
                output.push(active ? Object.freeze({ ...part, kind }) : part);
                from = to;
            }
            return output;
        }
        const output: NativeNode[] = [];
        let pending: NativeNode[] = [];
        const flush = (): void => {
            if (!pending.length) return;
            output.push(
                Object.freeze({
                    id: nextId(),
                    kind,
                    children: Object.freeze(
                        pending.map((block) =>
                            Object.freeze({ id: nextId(), kind: 'listItem', children: Object.freeze([block]) }),
                        ),
                    ),
                }),
            );
            pending = [];
        };
        for (const child of node.children) {
            if (
                selected.has(child.id) &&
                ['paragraph', 'heading', 'codeBlock'].includes(child.kind) &&
                node.kind !== 'listItem'
            )
                pending.push(child);
            else {
                flush();
                output.push(...transform(child));
            }
        }
        flush();
        return [
            output.some((child, index) => child !== node.children![index]) || output.length !== node.children.length
                ? childrenOf(node, output)
                : node,
        ];
    };
    const root = transform(document.root)[0];
    return root === document.root ? document : Object.freeze({ ...document, root, revision: document.revision + 1 });
}

export function indentList(document: NativeDocument, selection: NativeSelection, lift: boolean): NativeDocument {
    const contexts = selectionRanges(document, selection).map((range) => listContext(document, range.blockId));
    if (!contexts.length || !contexts.every((context) => context && context.list === contexts[0]!.list))
        return document;
    const { list } = contexts[0]!;
    const indices = contexts.map((context) => list.children!.indexOf(context!.item));
    const from = Math.min(...indices),
        to = Math.max(...indices) + 1;
    const items = list.children!.slice(from, to),
        nextId = allocator(document);
    if (!lift) {
        const previous = list.children![from - 1];
        if (!previous) return document;
        const tail = previous.children?.at(-1);
        const nested =
            tail?.kind === list.kind
                ? childrenOf(tail, [...(tail.children ?? []), ...items])
                : identity(
                      {
                          ...list,
                          attributes: Object.freeze({ ...list.attributes, start: 1 }),
                          children: Object.freeze(items),
                      },
                      nextId(),
                  );
        const previousChildren =
            tail?.kind === list.kind
                ? [...previous.children!.slice(0, -1), nested]
                : [...(previous.children ?? []), nested];
        return update(document, list, [
            childrenOf(list, [
                ...list.children!.slice(0, from - 1),
                childrenOf(previous, previousChildren),
                ...list.children!.slice(to),
            ]),
        ]);
    }
    const parentItem = parentOf(document, list.id),
        outerList = parentItem ? parentOf(document, parentItem.id) : undefined;
    if (parentItem?.kind === 'listItem' && isList(outerList)) {
        const following = listSlice(list, to, list.children!.length, nextId);
        if (following) {
            const last = items.at(-1)!;
            items[items.length - 1] = childrenOf(last, [...(last.children ?? []), following]);
        }
        const before = listSlice(list, 0, from, nextId);
        const remaining = parentItem.children!.flatMap((child) =>
            child === list ? (before ? [before] : []) : [child],
        );
        const at = outerList!.children!.indexOf(parentItem);
        return update(document, outerList!, [
            childrenOf(outerList!, [
                ...outerList!.children!.slice(0, at),
                childrenOf(parentItem, remaining),
                ...items,
                ...outerList!.children!.slice(at + 1),
            ]),
        ]);
    }
    const before = listSlice(list, 0, from, nextId),
        after = listSlice(list, to, list.children!.length, nextId);
    return update(document, list, [
        ...(before ? [before] : []),
        ...items.flatMap((item) => item.children ?? []),
        ...(after ? [after] : []),
    ]);
}

export function splitListItem(document: NativeDocument, edit: Omit<InlineEdit, 'text'>): StructureResult | null {
    const context = listContext(document, edit.blockId);
    if (!context) return null;
    const { item, list } = context,
        block = findNode(document, edit.blockId)!;
    if (!['paragraph', 'heading'].includes(block.kind) || !item.children?.includes(block)) return null;
    const from = edit.from,
        to = edit.to;
    if (document.revision !== edit.expectedRevision) throw new Error('Document revision conflict');
    const boundaries = new Set([
        blockText(block).length,
        ...Array.from(
            new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(blockText(block)),
            (part) => part.index,
        ),
    ]);
    if (!boundaries.has(from) || !boundaries.has(to) || from > to)
        throw new Error('Text edits must use valid grapheme boundaries');
    if (!blockText(block) && item.children.length === 1) {
        const selection = { anchor: { blockId: block.id, offset: 0 }, focus: { blockId: block.id, offset: 0 } };
        return { document: indentList(document, selection, true), caret: selection.focus };
    }
    const nextId = allocator(document),
        index = item.children.indexOf(block),
        itemIndex = list.children!.indexOf(item);
    const leftContent = sliceInlineContent(block.children ?? [], 0, from),
        used = new Set(leftContent.map((child) => child.id));
    const right = identity(
        {
            ...block,
            kind: 'paragraph',
            children: Object.freeze(
                sliceInlineContent(block.children ?? [], to, blockText(block).length).map((child) =>
                    used.has(child.id) ? identity(child, nextId()) : child,
                ),
            ),
        },
        nextId(),
    );
    const left = childrenOf(block, leftContent);
    const leftItem = childrenOf(item, [...item.children.slice(0, index), left]);
    const rightItem = identity(childrenOf(item, [right, ...item.children.slice(index + 1)]), nextId());
    return {
        document: update(document, list, [
            childrenOf(list, [
                ...list.children!.slice(0, itemIndex),
                leftItem,
                rightItem,
                ...list.children!.slice(itemIndex + 1),
            ]),
        ]),
        caret: { blockId: right.id, offset: 0 },
    };
}

export function joinListItem(document: NativeDocument, blockId: string): StructureResult | null {
    const context = listContext(document, blockId),
        block = findNode(document, blockId);
    if (!context || !block || context.item.children?.[0] !== block) return null;
    const { item, list } = context,
        index = list.children!.indexOf(item),
        previous = list.children![index - 1];
    if (!previous) {
        const caret = { blockId, offset: 0 };
        return { document: indentList(document, { anchor: caret, focus: caret }, true), caret };
    }
    const target = previous.children?.at(-1);
    if (!target || !['paragraph', 'heading'].includes(target.kind) || !['paragraph', 'heading'].includes(block.kind))
        return null;
    const caret = { blockId: target.id, offset: blockText(target).length };
    const merged = childrenOf(
        target,
        normalize([...(target.children ?? []), ...(block.children ?? [])], allocator(document)),
    );
    const combined = childrenOf(previous, [...previous.children!.slice(0, -1), merged, ...item.children!.slice(1)]);
    return {
        document: update(document, list, [
            childrenOf(list, [...list.children!.slice(0, index - 1), combined, ...list.children!.slice(index + 1)]),
        ]),
        caret,
    };
}
