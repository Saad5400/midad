import { findNode, type Attributes, type NativeDocument, type NativeMark, type NativeNode } from '../document/model.js';
import { chooseFont } from '../typography/fonts.js';
import { blockTextStyle, DEFAULT_TEXT_STYLE, nodeTextStyle, type TextStyle } from '../typography/style.js';
import { blockText, mapInlineSelection, replaceBlockNode, type InlineEdit } from './text.js';

export type TextRange = Omit<InlineEdit, 'text' | 'marks'>;
export type ToggleMark = 'bold' | 'italic' | 'underline' | 'strike' | 'code';
export type FormatCommand =
    | { kind: 'toggle'; mark: ToggleMark; enabled?: boolean }
    | { kind: 'style'; attributes: Attributes }
    | { kind: 'link'; href: string | null }
    | { kind: 'clear' };
export type SelectionStyle = { readonly [K in keyof TextStyle]: TextStyle[K] | undefined };
export interface BlockFormat {
    readonly kind?: 'paragraph' | 'heading' | 'codeBlock';
    readonly level?: number;
    readonly textAlign?: 'left' | 'center' | 'right' | 'justify';
    readonly dir?: 'ltr' | 'rtl';
    readonly indent?: number;
}
const formatMarks = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'textStyle']);
const styleKeys = new Set([
    'fontFamily',
    'fontSize',
    'lineHeight',
    'color',
    'backgroundColor',
    'fontWeight',
    'fontStyle',
]);

function styleMark(marks: readonly NativeMark[], attributes: Attributes): readonly NativeMark[] {
    const existing = marks.find((mark) => mark.kind === 'textStyle');
    const combined = { ...existing?.attributes, ...attributes };
    const entries = Object.entries(combined).filter(([, value]) => value !== null && value !== '');
    return Object.freeze([
        ...marks.filter((mark) => mark.kind !== 'textStyle'),
        ...(entries.length
            ? [Object.freeze({ kind: 'textStyle', attributes: Object.freeze(Object.fromEntries(entries)) })]
            : []),
    ]);
}

export function normalizeLink(href: string): string {
    const text = href.trim();
    if (!text) throw new Error('A link address is required');
    const value = /^[a-z][a-z\d+.-]*:/i.test(text)
        ? text
        : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
          ? `mailto:${text}`
          : /^\+?[\d ()-]{5,}$/.test(text)
            ? `tel:${text.replace(/[ ()-]/g, '')}`
            : `https://${text}`;
    const url = new URL(value);
    if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)) throw new Error('Unsupported link protocol');
    if (url.username || url.password) throw new Error('Link credentials are not supported');
    return url.href;
}

export function changeTextMarks(marks: readonly NativeMark[], command: FormatCommand): readonly NativeMark[] {
    let next: readonly NativeMark[];
    if (command.kind === 'clear') next = marks.filter((mark) => !formatMarks.has(mark.kind));
    else if (command.kind === 'style') {
        if (Object.keys(command.attributes).some((key) => !styleKeys.has(key))) throw new Error('Unknown text style');
        if (
            Object.values(command.attributes).some(
                (value) => value !== null && typeof value !== 'string' && typeof value !== 'number',
            )
        )
            throw new Error('Invalid text style');
        for (const key of ['fontFamily', 'fontStyle', 'color', 'backgroundColor']) {
            if (
                command.attributes[key] !== undefined &&
                command.attributes[key] !== null &&
                typeof command.attributes[key] !== 'string'
            )
                throw new Error('Invalid text style');
        }
        next = styleMark(marks, command.attributes);
        const resolved = nodeTextStyle({ id: '', kind: 'text', marks: next });
        chooseFont(resolved, !command.attributes.fontFamily);
    } else if (command.kind === 'link') {
        next = marks.filter((mark) => mark.kind !== 'link');
        if (command.href)
            next = [
                ...next,
                Object.freeze({ kind: 'link', attributes: Object.freeze({ href: normalizeLink(command.href) }) }),
            ];
    } else {
        const enabled = command.enabled ?? !marks.some((mark) => mark.kind === command.mark);
        next = marks.filter((mark) => mark.kind !== command.mark);
        if (command.mark === 'bold') next = styleMark(next, { fontWeight: enabled ? null : 'normal' });
        if (command.mark === 'italic') next = styleMark(next, { fontStyle: enabled ? null : 'normal' });
        if (enabled) next = [...next, Object.freeze({ kind: command.mark })];
    }
    return JSON.stringify(next) === JSON.stringify(marks) ? marks : Object.freeze(next);
}

export function marksAtCaret(block: NativeNode, offset: number): readonly NativeMark[] {
    let position = 0;
    for (const node of block.children ?? []) {
        const end = position + (node.kind === 'text' ? (node.text?.length ?? 0) : 1);
        if (node.kind === 'text' && offset >= position && offset <= end) return node.marks ?? [];
        position = end;
    }
    return [];
}

export function linkedRangeAtCaret(block: NativeNode, offset: number): { from: number; to: number } | null {
    const href = marksAtCaret(block, offset).find((mark) => mark.kind === 'link')?.attributes?.href;
    if (!href) return null;
    let position = 0;
    let range: { from: number; to: number } | null = null;
    for (const node of block.children ?? []) {
        const end = position + (node.kind === 'text' ? (node.text?.length ?? 0) : 1);
        const linked =
            node.kind === 'text' && node.marks?.some((mark) => mark.kind === 'link' && mark.attributes?.href === href);
        if (linked) range = range ? { from: range.from, to: end } : { from: position, to: end };
        else if (range) {
            if (offset >= range.from && offset <= range.to) return range;
            range = null;
        }
        position = end;
    }
    return range && offset >= range.from && offset <= range.to ? range : null;
}

export function selectionTextStyle(
    document: NativeDocument,
    range: TextRange,
    storedMarks?: readonly NativeMark[],
): SelectionStyle {
    const block = findNode(document, range.blockId);
    if (!block) return DEFAULT_TEXT_STYLE;
    const base = blockTextStyle(block);
    if (range.from === range.to)
        return nodeTextStyle({ id: '', kind: 'text', marks: storedMarks ?? marksAtCaret(block, range.from) }, base);
    let position = 0;
    const styles: TextStyle[] = [];
    for (const node of block.children ?? []) {
        const end = position + (node.kind === 'text' ? (node.text?.length ?? 0) : 1);
        if (node.kind === 'text' && position < range.to && end > range.from) styles.push(nodeTextStyle(node, base));
        position = end;
    }
    const first = styles[0] ?? base;
    return Object.fromEntries(
        Object.entries(first).map(([key, value]) => [
            key,
            styles.every((style) => JSON.stringify(style[key as keyof TextStyle]) === JSON.stringify(value))
                ? value
                : undefined,
        ]),
    ) as SelectionStyle;
}

export function formatText(document: NativeDocument, range: TextRange, command: FormatCommand): NativeDocument {
    const resolved =
        command.kind === 'toggle' && command.enabled === undefined
            ? {
                  ...command,
                  enabled:
                      command.mark === 'code'
                          ? selectionCodeState(document, range) !== true
                          : selectionTextStyle(document, range)[command.mark] !== true,
              }
            : command;
    return mapInlineSelection(document, range, (node) => {
        const previous = node.marks ?? [];
        const marks = changeTextMarks(previous, resolved);
        return marks === previous ? node : Object.freeze({ ...node, marks });
    });
}

export function selectionCodeState(
    document: NativeDocument,
    range: TextRange,
    storedMarks?: readonly NativeMark[],
): boolean | undefined {
    const block = findNode(document, range.blockId);
    if (!block) return false;
    if (range.from === range.to)
        return (storedMarks ?? marksAtCaret(block, range.from)).some((mark) => mark.kind === 'code');
    let offset = 0;
    const flags: boolean[] = [];
    for (const node of block.children ?? []) {
        const end = offset + (node.kind === 'text' ? (node.text?.length ?? 0) : 1);
        if (node.kind === 'text' && offset < range.to && end > range.from)
            flags.push(node.marks?.some((mark) => mark.kind === 'code') ?? false);
        offset = end;
    }
    return flags.every(Boolean) ? !!flags.length : flags.some(Boolean) ? undefined : false;
}

export function formatBlock(document: NativeDocument, blockId: string, patch: BlockFormat): NativeDocument {
    return replaceBlockNode(document, blockId, (node) => {
        if (Object.keys(patch).some((key) => !['kind', 'level', 'textAlign', 'dir', 'indent'].includes(key)))
            throw new Error('Unknown block format');
        if (patch.dir !== undefined && !['ltr', 'rtl'].includes(patch.dir)) throw new Error('Invalid text direction');
        if (patch.textAlign !== undefined && !['left', 'center', 'right', 'justify'].includes(patch.textAlign))
            throw new Error('Invalid text alignment');
        if (patch.kind !== undefined && !['paragraph', 'heading', 'codeBlock'].includes(patch.kind))
            throw new Error('Invalid block kind');
        if (!['paragraph', 'heading', 'codeBlock', 'clauseTitle'].includes(node.kind))
            throw new Error('This node is not a text block');
        if (patch.kind && node.kind === 'clauseTitle')
            throw new Error('A clause title cannot change its structural kind');
        if (patch.level !== undefined && (!Number.isSafeInteger(patch.level) || patch.level < 1 || patch.level > 6))
            throw new Error('Invalid heading level');
        if (
            patch.indent !== undefined &&
            (!Number.isSafeInteger(patch.indent) || patch.indent < 0 || patch.indent > 20)
        )
            throw new Error('Invalid paragraph indentation');
        const kind = patch.kind ?? node.kind;
        if (kind === 'codeBlock' && node.children?.some((child) => child.kind !== 'text'))
            throw new Error('Code blocks can contain only text');
        const attributes = {
            ...node.attributes,
            ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
        } as Record<string, import('../document/model.js').Json>;
        if (patch.dir !== undefined) attributes.dirLocked = true;
        delete attributes.kind;
        if (kind !== 'heading') delete attributes.level;
        else attributes.level = patch.level ?? Number(node.attributes?.level ?? 1);
        let children = node.children;
        if (patch.kind) {
            const size = blockTextStyle({ ...node, kind, attributes }).size / 0.75;
            children = children?.map((child) =>
                child.kind !== 'text'
                    ? child
                    : Object.freeze({
                          ...child,
                          marks: changeTextMarks(child.marks ?? [], {
                              kind: 'style',
                              attributes: { fontSize: `${size}px` },
                          }),
                      }),
            );
        }
        const next = Object.freeze({
            ...node,
            kind,
            attributes: Object.freeze(attributes),
            ...(children ? { children: Object.freeze(children) } : {}),
        });
        return JSON.stringify(next) === JSON.stringify(node) ? node : next;
    });
}

export function wholeBlockRange(document: NativeDocument, blockId: string): TextRange {
    const block = findNode(document, blockId);
    if (!block) throw new Error('The text block no longer exists');
    return { blockId, from: 0, to: blockText(block).length, expectedRevision: document.revision };
}
