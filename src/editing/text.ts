import {
    copyJson,
    findNode,
    type Attributes,
    type NativeDocument,
    type NativeMark,
    type NativeNode,
} from '../document/model.js';

export interface InlineEdit {
    readonly blockId: string;
    readonly from: number;
    readonly to: number;
    readonly text: string;
    readonly expectedRevision: number;
    readonly marks?: readonly NativeMark[];
}
export interface TextCaret {
    readonly blockId: string;
    readonly offset: number;
}
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

export function editableTextBlock(document: NativeDocument, edit: InlineEdit): NativeNode {
    if (document.revision !== edit.expectedRevision) throw new Error('Document revision conflict');
    const block = findNode(document, edit.blockId);
    if (!block || !textBlockKinds.has(block.kind)) throw new Error('The text block no longer exists');
    const text = blockText(block);
    const boundaries = new Set([
        text.length,
        ...Array.from(new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text), (part) => part.index),
    ]);
    boundaries.add(0);
    if (
        !Number.isSafeInteger(edit.from) ||
        !Number.isSafeInteger(edit.to) ||
        edit.from > edit.to ||
        !boundaries.has(edit.from) ||
        !boundaries.has(edit.to)
    )
        throw new Error('Text edits must use valid grapheme boundaries');
    return block;
}

export function identity(node: NativeNode, id: string): NativeNode {
    if (node.kind === 'variable') id = crypto.randomUUID();
    return Object.freeze({
        ...node,
        id,
        ...(node.attributes?.id === undefined && node.attributes?.nativeId === undefined
            ? {}
            : {
                  attributes: Object.freeze({
                      ...node.attributes,
                      ...(node.attributes?.id === undefined ? {} : { id }),
                      ...(node.attributes?.nativeId === undefined ? {} : { nativeId: id }),
                  }),
              }),
    });
}

export function allocator(document: NativeDocument): () => string {
    const ids = new Set<string>();
    const visit = (node: NativeNode): void => {
        ids.add(node.id);
        node.children?.forEach(visit);
    };
    visit(document.root);
    return () => {
        let id: string;
        do {
            id = crypto.randomUUID();
        } while (ids.has(id));
        ids.add(id);
        return id;
    };
}

export function sliceInlineContent(nodes: readonly NativeNode[], from: number, to: number): NativeNode[] {
    let offset = 0;
    const output: NativeNode[] = [];
    for (const node of nodes) {
        const length = node.kind === 'text' ? (node.text?.length ?? 0) : 1;
        const start = Math.max(from - offset, 0);
        const end = Math.min(to - offset, length);
        if (start < end)
            output.push(
                start === 0 && end === length ? node : Object.freeze({ ...node, text: node.text!.slice(start, end) }),
            );
        offset += length;
    }
    return output;
}

const slice = sliceInlineContent;

function copyMarks(marks: readonly NativeMark[]): readonly NativeMark[] {
    return Object.freeze(
        marks.map((mark) =>
            Object.freeze({
                ...mark,
                ...(mark.attributes ? { attributes: copyJson(mark.attributes) as Attributes } : {}),
            }),
        ),
    );
}

export function pasteBlocks(
    document: NativeDocument,
    edit: Omit<InlineEdit, 'text'>,
    blocks: readonly NativeNode[],
): { document: NativeDocument; caret: TextCaret } {
    const block = editableTextBlock(document, { ...edit, text: '' });
    if (!blocks.length) return { document, caret: { blockId: block.id, offset: edit.from } };
    const nextId = allocator(document);
    const clone = (node: NativeNode): NativeNode =>
        identity(
            {
                ...node,
                ...(node.attributes ? { attributes: copyJson(node.attributes) as Attributes } : {}),
                ...(node.marks ? { marks: copyMarks(node.marks) } : {}),
                ...(node.children ? { children: Object.freeze(node.children.map(clone)) } : {}),
            },
            nextId(),
        );
    const inlineBlock = (node: NativeNode): boolean => textBlockKinds.has(node.kind);
    const flatten = (node: NativeNode): string =>
        inlineBlock(node) ? blockText(node) : (node.children ?? []).map(flatten).join('\n');
    if (block.kind === 'codeBlock' || block.kind === 'clauseTitle') {
        const text = blocks.map(flatten).join('\n');
        return {
            document: replaceInlineText(document, { ...edit, text }),
            caret: { blockId: block.id, offset: edit.from + text.length },
        };
    }
    const before = slice(block.children ?? [], 0, edit.from);
    const after = slice(block.children ?? [], edit.to, blockText(block).length);
    const pasted = blocks.map(clone);
    if (pasted.length === 1 && inlineBlock(pasted[0])) {
        const source = pasted[0];
        const target = blockText(block).length ? block : identity(source, block.id);
        return {
            document: update(document, block, [
                Object.freeze({
                    ...target,
                    children: normalize([...before, ...(source.children ?? []), ...after], nextId),
                }),
            ]),
            caret: { blockId: block.id, offset: edit.from + blockText(source).length },
        };
    }
    if (inlineBlock(pasted[0])) {
        const source = pasted[0];
        pasted[0] = Object.freeze({
            ...identity(before.length ? block : source, block.id),
            children: normalize([...before, ...(source.children ?? [])], nextId),
        });
    } else if (before.length) pasted.unshift(Object.freeze({ ...block, children: Object.freeze(before) }));
    const last = pasted.at(-1)!;
    let caret: TextCaret;
    if (inlineBlock(last)) {
        caret = { blockId: last.id, offset: blockText(last).length };
        pasted[pasted.length - 1] = Object.freeze({
            ...last,
            children: normalize([...(last.children ?? []), ...after], nextId),
        });
    } else {
        const tail = identity({ ...block, kind: 'paragraph', children: Object.freeze(after) }, nextId());
        pasted.push(tail);
        caret = { blockId: tail.id, offset: 0 };
    }
    return { document: update(document, block, pasted), caret };
}

export function normalize(nodes: readonly NativeNode[], nextId: () => string): readonly NativeNode[] {
    const output: NativeNode[] = [];
    const ids = new Set<string>();
    const styleKey = (node: NativeNode): string =>
        JSON.stringify([
            node.marks ?? [],
            Object.fromEntries(Object.entries(node.attributes ?? {}).filter(([key]) => key !== 'id')),
        ]);
    for (let node of nodes) {
        if (node.kind === 'text' && !node.text) continue;
        const previous = output[output.length - 1];
        if (previous?.kind === 'text' && node.kind === 'text' && styleKey(previous) === styleKey(node)) {
            output[output.length - 1] = Object.freeze({ ...previous, text: previous.text! + node.text! });
            continue;
        }
        if (ids.has(node.id)) node = identity(node, nextId());
        ids.add(node.id);
        output.push(node);
    }
    return Object.freeze(output);
}

export function update(
    document: NativeDocument,
    target: NativeNode,
    replacements: readonly NativeNode[],
): NativeDocument {
    const visit = (node: NativeNode): NativeNode => {
        if (!node.children) return node;
        let changed = false;
        const children = node.children.flatMap((child) => {
            if (child === target) {
                changed = true;
                return replacements;
            }
            const next = visit(child);
            changed ||= next !== child;
            return [next];
        });
        return changed ? Object.freeze({ ...node, children: Object.freeze(children) }) : node;
    };
    return Object.freeze({
        ...document,
        revision: document.revision + 1,
        root: target === document.root ? replacements[0] : visit(document.root),
    });
}

export function replaceInlineText(document: NativeDocument, edit: InlineEdit): NativeDocument {
    const block = editableTextBlock(document, edit);
    if (edit.from === edit.to && !edit.text) return document;
    const nodes = block.children ?? [];
    const before = slice(nodes, 0, edit.from);
    const after = slice(nodes, edit.to, blockText(block).length);
    const nextId = allocator(document);
    let offset = 0;
    const inherited = nodes.find((node) => {
        const start = offset;
        offset += node.kind === 'text' ? (node.text?.length ?? 0) : 1;
        return (
            node.kind === 'text' &&
            (edit.from === edit.to ? start <= edit.from && offset >= edit.from : start < edit.to && offset > edit.from)
        );
    });
    const insert: NativeNode[] = [];
    const parts = block.kind === 'codeBlock' ? [edit.text] : edit.text.replace(/\r\n?/g, '\n').split('\n');
    parts.forEach((text, index) => {
        if (index) insert.push(Object.freeze({ id: nextId(), kind: 'hardBreak' }));
        if (text)
            insert.push(
                identity(
                    {
                        ...inherited,
                        id: '',
                        kind: 'text',
                        text,
                        ...(edit.marks === undefined ? {} : { marks: copyMarks(edit.marks) }),
                    },
                    nextId(),
                ),
            );
    });
    return update(document, block, [
        Object.freeze({ ...block, children: normalize([...before, ...insert, ...after], nextId) }),
    ]);
}

export function mapInlineSelection(
    document: NativeDocument,
    edit: Omit<InlineEdit, 'text'>,
    transform: (node: NativeNode) => NativeNode,
): NativeDocument {
    const block = editableTextBlock(document, { ...edit, text: '' });
    if (edit.from === edit.to) return document;
    const nodes = block.children ?? [];
    const selected = slice(nodes, edit.from, edit.to);
    const mapped = selected.map((node) => (node.kind === 'text' ? transform(node) : node));
    if (mapped.every((node, index) => node === selected[index])) return document;
    const nextId = allocator(document);
    return update(document, block, [
        Object.freeze({
            ...block,
            children: normalize(
                [...slice(nodes, 0, edit.from), ...mapped, ...slice(nodes, edit.to, blockText(block).length)],
                nextId,
            ),
        }),
    ]);
}

export function replaceBlockNode(
    document: NativeDocument,
    blockId: string,
    transform: (node: NativeNode) => NativeNode,
): NativeDocument {
    const target = findNode(document, blockId);
    if (!target) throw new Error('The document node no longer exists');
    const next = transform(target);
    return next === target ? document : update(document, target, [next]);
}

export function parentOf(document: NativeDocument, id: string): NativeNode | undefined {
    const visit = (node: NativeNode): NativeNode | undefined => {
        if (node.children?.some((child) => child.id === id)) return node;
        for (const child of node.children ?? []) {
            const parent = visit(child);
            if (parent) return parent;
        }
    };
    return visit(document.root);
}

export function splitTextBlock(
    document: NativeDocument,
    edit: Omit<InlineEdit, 'text'>,
): { document: NativeDocument; caret: TextCaret } {
    const block = editableTextBlock(document, { ...edit, text: '' });
    if (!['paragraph', 'heading'].includes(block.kind)) throw new Error('This block cannot be split');
    const nextId = allocator(document);
    const left = Object.freeze({ ...block, children: Object.freeze(slice(block.children ?? [], 0, edit.from)) });
    const used = new Set(left.children.map((node) => node.id));
    const right = identity(
        {
            ...block,
            kind: 'paragraph',
            children: Object.freeze(
                slice(block.children ?? [], edit.to, blockText(block).length).map((node) =>
                    used.has(node.id) ? identity(node, nextId()) : node,
                ),
            ),
        },
        nextId(),
    );
    return { document: update(document, block, [left, right]), caret: { blockId: right.id, offset: 0 } };
}

export function joinPreviousTextBlock(
    document: NativeDocument,
    blockId: string,
): { document: NativeDocument; caret: TextCaret } | null {
    const parent = parentOf(document, blockId);
    if (!parent) return null;
    const index = parent.children!.findIndex((node) => node.id === blockId);
    const block = parent.children![index];
    const previous = parent.children![index - 1];
    if (
        !previous ||
        !['paragraph', 'heading'].includes(previous.kind) ||
        !['paragraph', 'heading'].includes(block.kind)
    )
        return null;
    const caret = { blockId: previous.id, offset: blockText(previous).length };
    const merged = Object.freeze({
        ...previous,
        children: normalize([...(previous.children ?? []), ...(block.children ?? [])], allocator(document)),
    });
    const children = [...parent.children!];
    children.splice(index - 1, 2, merged);
    return {
        document: update(document, parent, [Object.freeze({ ...parent, children: Object.freeze(children) })]),
        caret,
    };
}

export function textDifference(
    before: string,
    after: string,
    selection?: { from: number; to: number },
): { from: number; to: number; text: string } {
    const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
    const left = Array.from(segmenter.segment(before));
    const right = Array.from(segmenter.segment(after));
    let start = 0;
    while (
        start < left.length &&
        start < right.length &&
        left[start].index < (selection?.from ?? Infinity) &&
        left[start].segment === right[start].segment
    )
        start++;
    let end = left.length,
        nextEnd = right.length;
    while (
        end > start &&
        nextEnd > start &&
        left[end - 1].index >= (selection?.to ?? 0) &&
        left[end - 1].segment === right[nextEnd - 1].segment
    ) {
        end--;
        nextEnd--;
    }
    return {
        from: left[start]?.index ?? before.length,
        to: left[end]?.index ?? before.length,
        text: after.slice(right[start]?.index ?? after.length, right[nextEnd]?.index ?? after.length),
    };
}
