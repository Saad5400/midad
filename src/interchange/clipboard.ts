import { exportDocument, importDocument } from '../document/codec.js';
import {
    copyJson,
    findNode,
    type Attributes,
    type NativeDocument,
    type NativeMark,
    type NativeNode,
} from '../document/model.js';
import { marksAtCaret, normalizeLink } from '../editing/formatting.js';
import { replaceSelection, selectionRanges, type NativeSelection } from '../editing/selection.js';
import { pasteTableCells, selectedTableFragment } from '../editing/tables.js';
import { pasteBlocks, sliceInlineContent, type TextCaret } from '../editing/text.js';
import { inheritedDirection } from '../typography/direction.js';
import { chooseFont } from '../typography/fonts.js';
import {
    DEFAULT_TEXT_STYLE,
    blockTextStyle,
    color,
    lineHeight,
    nodeTextStyle,
    textSize,
    type Color,
} from '../typography/style.js';

export const NATIVE_CLIPBOARD_TYPE = 'application/x-clm-native-fragment+json';
export const NATIVE_WEB_CLIPBOARD_TYPE = `web ${NATIVE_CLIPBOARD_TYPE}`;
export interface NativeFragment {
    readonly blocks: readonly NativeNode[];
    readonly plain?: boolean;
}
export interface ClipboardPayload {
    readonly native: string;
    readonly html: string;
    readonly text: string;
}
const textKinds = new Set(['paragraph', 'heading', 'clauseTitle', 'codeBlock']);
const limit = 2_000_000;
const customBlocks = new Set(['clause', 'clauseTitle', 'clauseBody', 'parallelRow', 'parallelCell', 'tableRowGroup']);

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

const escape = (text: string): string =>
    text.replace(
        /[&<>"']/g,
        (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    );
function safeLink(value: unknown): string | undefined {
    if (typeof value !== 'string') return;
    try {
        return normalizeLink(value);
    } catch {
        return;
    }
}

export function fragmentHtml(fragment: NativeFragment, direction: 'rtl' | 'ltr' = 'rtl', metadata = true): string {
    const cssColor = (color: Color): string =>
        `rgba(${color
            .slice(0, 3)
            .map((value) => value * 255)
            .join(',')},${color[3]})`;
    const render = (node: NativeNode, inherited = DEFAULT_TEXT_STYLE, parentDirection = direction): string => {
        const base = blockTextStyle(node, inherited);
        const resolvedDirection = inheritedDirection(node, parentDirection);
        let body = (node.children ?? []).map((child) => render(child, base, resolvedDirection)).join('');
        if (node.kind === 'text') {
            const style = nodeTextStyle(node, inherited);
            chooseFont(style);
            const styles = [
                `font-family:${style.family}`,
                `font-size:${style.size}pt`,
                `font-weight:${style.bold ? 'bold' : 'normal'}`,
                `font-style:${style.italic ? 'italic' : 'normal'}`,
                `color:${cssColor(style.color)}`,
                ...(style.background ? [`background-color:${cssColor(style.background)}`] : []),
                ...(style.lineHeight ? [`line-height:${style.lineHeight}`] : []),
            ];
            const decoration = [...(style.underline ? ['underline'] : []), ...(style.strike ? ['line-through'] : [])];
            if (decoration.length) styles.push(`text-decoration:${decoration.join(' ')}`);
            body = `<span style="${escape(styles.join(';'))}">${escape(node.text ?? '')}</span>`;
            if (style.bold) body = `<strong>${body}</strong>`;
            if (style.italic) body = `<em>${body}</em>`;
            if (node.marks?.some((mark) => mark.kind === 'code')) body = `<code>${body}</code>`;
            const href = safeLink(style.href);
            return href ? `<a href="${escape(href)}">${body}</a>` : body;
        }
        if (node.kind === 'hardBreak') return '<br>';
        if (node.kind === 'horizontalRule') return '<hr>';
        if (node.kind === 'variable')
            return `<span data-clm-variable="${escape(JSON.stringify(node.attributes ?? {}))}">${escape(typeof node.attributes?.value === 'string' ? node.attributes.value : '\uFFFC')}</span>`;
        if (node.kind === 'image')
            return `<img data-clm-image="${escape(JSON.stringify(node.attributes ?? {}))}" alt="${escape(typeof node.attributes?.alt === 'string' ? node.attributes.alt : '')}">`;
        const tags: Record<string, string> = {
            paragraph: 'p',
            heading: `h${Math.min(6, Math.max(1, Number(node.attributes?.level ?? 1)))}`,
            clauseTitle: 'h2',
            codeBlock: 'pre',
            blockquote: 'blockquote',
            orderedList: 'ol',
            bulletList: 'ul',
            listItem: 'li',
            table: 'table',
            tableRow: 'tr',
            tableRowGroup: 'tbody',
            tableCell: 'td',
            tableHeader: 'th',
        };
        const tag = tags[node.kind] ?? 'div';
        const attributes: string[] = [];
        if (metadata && customBlocks.has(node.kind)) attributes.push(`data-clm-kind="${node.kind}"`);
        if (metadata && node.attributes) attributes.push(`data-clm-attrs="${escape(JSON.stringify(node.attributes))}"`);
        attributes.push(`dir="${resolvedDirection}"`);
        const blockStyles = [];
        if (['left', 'right', 'center', 'justify'].includes(String(node.attributes?.textAlign)))
            blockStyles.push(`text-align:${node.attributes!.textAlign}`);
        else if (!metadata && ['paragraph', 'heading', 'codeBlock'].includes(node.kind))
            blockStyles.push(`text-align:${resolvedDirection === 'rtl' ? 'right' : 'left'}`);
        if (Number.isFinite(Number(node.attributes?.indent)) && Number(node.attributes?.indent) > 0) {
            const indent = Math.min(20, Number(node.attributes?.indent)) * 18;
            blockStyles.push(`margin-inline-start:${indent}pt`);
            if (!metadata) blockStyles.push(`margin-${resolvedDirection === 'rtl' ? 'right' : 'left'}:${indent}pt`);
        }
        if (blockStyles.length) attributes.push(`style="${blockStyles.join(';')}"`);
        for (const key of tag === 'ol' ? ['start'] : ['td', 'th'].includes(tag) ? ['colspan', 'rowspan'] : []) {
            const value = Number(node.attributes?.[key]);
            if (Number.isSafeInteger(value) && value > 0) attributes.push(`${key}="${value}"`);
        }
        return `<${tag}${attributes.length ? ` ${attributes.join(' ')}` : ''}>${body}</${tag}>`;
    };
    return fragment.blocks.map((node) => render(node)).join('');
}

function fragmentText(fragment: NativeFragment): string {
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

export function clipboardPayload(document: NativeDocument, selection: NativeSelection): ClipboardPayload {
    const fragment = selectionFragment(document, selection);
    const content = exportDocument({
        ...document,
        root: { id: 'clipboard', kind: 'doc', children: fragment.blocks },
    });
    return {
        native: JSON.stringify({ version: 1, content }),
        html: fragmentHtml(fragment, inheritedDirection(document.root, 'rtl')),
        text: fragmentText(fragment),
    };
}

export function parseNativeFragment(source: string): NativeFragment {
    if (source.length > limit) throw new Error('The clipboard content is too large');
    const value = JSON.parse(source);
    if (value?.version !== 1 || !value.content) throw new Error('Unsupported clipboard format');
    let count = 0;
    const check = (node: { content?: unknown[] }, depth: number): void => {
        if (++count > 10000 || depth > 64 || !node || typeof node !== 'object')
            throw new Error('The clipboard structure is too large');
        if (Array.isArray(node.content)) node.content.forEach((child) => check(child as typeof node, depth + 1));
    };
    check(value.content, 0);
    return { blocks: importDocument(value.content, 'clipboard').root.children ?? [] };
}

export function plainTextFragment(text: string): NativeFragment {
    if (text.length > limit) throw new Error('The clipboard content is too large');
    if (!text) return { blocks: [], plain: true };
    return {
        plain: true,
        blocks: text
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map((text, index) => ({
                id: `clipboard:p:${index}`,
                kind: 'paragraph',
                children: text ? [{ id: `clipboard:t:${index}`, kind: 'text', text }] : [],
            })),
    };
}

export function parseHtmlFragment(source: string): NativeFragment {
    if (source.length > limit) throw new Error('The clipboard content is too large');
    const parsed = document.createElement('template');
    parsed.innerHTML = source;
    const metadata = (element: HTMLElement, key = 'data-clm-attrs'): Attributes => {
        const raw = element.getAttribute(key);
        if (!raw || raw.length > limit) return {};
        try {
            const value = copyJson(JSON.parse(raw));
            return value && typeof value === 'object' && !Array.isArray(value) ? (value as Attributes) : {};
        } catch {
            return {};
        }
    };
    const scope = (attrs: Attributes): Attributes =>
        Object.fromEntries(Object.entries(attrs).filter(([key]) => ['dir', 'textAlign'].includes(key)));
    const ignored = new Set([
        'SCRIPT',
        'STYLE',
        'IFRAME',
        'OBJECT',
        'EMBED',
        'SVG',
        'MATH',
        'META',
        'LINK',
        'TEMPLATE',
        'NOSCRIPT',
    ]);
    let sequence = 0;
    const preserved = new WeakSet<NativeNode>();
    function cleanInline(children: readonly NativeNode[]): NativeNode[] {
        const output: NativeNode[] = [];
        for (let child of children) {
            if (child.kind === 'text' && !preserved.has(child)) {
                let text = child.text ?? '';
                const previous = output.at(-1);
                if (
                    !previous ||
                    previous.kind === 'hardBreak' ||
                    (previous.kind === 'text' && previous.text?.endsWith(' '))
                )
                    text = text.replace(/^ +/, '');
                if (!text) continue;
                if (text !== child.text) child = { ...child, text };
            }
            output.push(child);
        }
        const last = output.at(-1);
        if (last?.kind === 'text' && !preserved.has(last)) {
            const text = last.text!.replace(/ +$/, '');
            if (text) output[output.length - 1] = { ...last, text };
            else output.pop();
        }
        return output;
    }
    const node = (kind: string, children?: readonly NativeNode[], attributes?: Attributes): NativeNode => {
        if (++sequence > 10000) throw new Error('The clipboard structure is too large');
        return {
            id: `clipboard:${sequence}`,
            kind,
            ...(children
                ? { children: ['paragraph', 'heading'].includes(kind) ? cleanInline(children) : children }
                : {}),
            ...(attributes && Object.keys(attributes).length ? { attributes } : {}),
        };
    };
    const marks = (element: HTMLElement, inherited: readonly NativeMark[]): readonly NativeMark[] => {
        const output = [...inherited];
        const tag = {
            B: 'bold',
            STRONG: 'bold',
            I: 'italic',
            EM: 'italic',
            U: 'underline',
            S: 'strike',
            STRIKE: 'strike',
            DEL: 'strike',
            CODE: 'code',
            TH: 'bold',
        }[element.tagName];
        if (tag) output.push({ kind: tag });
        const href = element.tagName === 'A' ? safeLink(element.getAttribute('href')) : undefined;
        if (href) output.push({ kind: 'link', attributes: { href } });
        const style = element.style,
            attrs: Record<string, string> = {};
        if (style.fontFamily) {
            const family = style.fontFamily
                .split(',')[0]
                .trim()
                .replace(/^["']|["']$/g, '');
            try {
                chooseFont({ ...DEFAULT_TEXT_STYLE, family });
                attrs.fontFamily = family;
            } catch {
                attrs.fontFamily = DEFAULT_TEXT_STYLE.family;
            }
        }
        if (style.fontSize) {
            try {
                textSize(style.fontSize, DEFAULT_TEXT_STYLE.size);
                attrs.fontSize = style.fontSize;
            } catch {
                /* Invalid imported size. */
            }
        }
        for (const key of ['color', 'backgroundColor'] as const)
            if (style[key]) {
                try {
                    color(style[key]);
                    attrs[key] = style[key];
                } catch {
                    /* Invalid imported color. */
                }
            }
        if (/^(normal|bold|[1-9]00)$/.test(style.fontWeight)) attrs.fontWeight = style.fontWeight;
        if (['normal', 'italic'].includes(style.fontStyle)) attrs.fontStyle = style.fontStyle;
        if (style.lineHeight) {
            try {
                lineHeight(style.lineHeight, DEFAULT_TEXT_STYLE.size);
                attrs.lineHeight = style.lineHeight;
            } catch {
                /* Invalid imported spacing. */
            }
        }
        const decoration = style.textDecorationLine || style.textDecoration;
        if (decoration.includes('underline')) output.push({ kind: 'underline' });
        if (decoration.includes('line-through')) output.push({ kind: 'strike' });
        if (Object.keys(attrs).length) output.push({ kind: 'textStyle', attributes: attrs });
        return output;
    };
    const inline = (source: Node, inherited: readonly NativeMark[], depth: number): NativeNode[] => {
        if (depth > 64) throw new Error('The clipboard structure is too large');
        if (source.nodeType === 3) {
            let preserve = false;
            for (let parent = source.parentElement; parent; parent = parent.parentElement) {
                const space = parent.style.whiteSpace;
                if (space) {
                    preserve = space.includes('pre') || space === 'break-spaces';
                    break;
                }
            }
            const text = preserve ? source.textContent : source.textContent?.replace(/[\t\n\r\f ]+/g, ' ');
            if (!text) return [];
            const child: NativeNode = { ...node('text'), text, ...(inherited.length ? { marks: inherited } : {}) };
            if (preserve) preserved.add(child);
            return [child];
        }
        if (source.nodeType !== 1) return [];
        const element = source as HTMLElement;
        if (ignored.has(element.tagName)) return [];
        if (element.tagName === 'SPAN' && element.hasAttribute('data-clm-variable')) {
            const attrs = metadata(element, 'data-clm-variable');
            return [
                node(
                    'variable',
                    undefined,
                    typeof attrs.value === 'string' ? { ...attrs, value: element.textContent ?? '' } : attrs,
                ),
            ];
        }
        if (element.tagName === 'BR') return [node('hardBreak')];
        if (element.tagName === 'IMG')
            return element.hasAttribute('data-clm-image')
                ? [node('image', undefined, metadata(element, 'data-clm-image'))]
                : [];
        return Array.from(element.childNodes).flatMap((child) => inline(child, marks(element, inherited), depth + 1));
    };
    const blockTags = /^(P|DIV|H[1-6]|PRE|BLOCKQUOTE|UL|OL|LI|TABLE|HR|SECTION|ARTICLE)$/;
    const attributes = (element: HTMLElement, inherited: Attributes): Attributes => {
        const attrs = { ...scope(inherited), ...metadata(element) };
        const direction = element.getAttribute('dir') || element.style.direction;
        if (direction === 'rtl' || direction === 'ltr') attrs.dir = direction;
        if (['left', 'right', 'center', 'justify'].includes(element.style.textAlign))
            attrs.textAlign = element.style.textAlign;
        return attrs;
    };
    const blocks = (
        parent: HTMLElement | DocumentFragment,
        inherited: readonly NativeMark[],
        attrs: Attributes,
        depth: number,
    ): NativeNode[] => {
        if (depth > 64) throw new Error('The clipboard structure is too large');
        attrs = scope(attrs);
        const output: NativeNode[] = [];
        let pending: NativeNode[] = [];
        const flush = (): void => {
            if (pending.some((entry) => entry.kind !== 'text' || /[^ ]/.test(entry.text ?? '')))
                output.push(node('paragraph', pending, attrs));
            pending = [];
        };
        for (const child of Array.from(parent.childNodes)) {
            if (child.nodeType !== 1 || !blockTags.test((child as HTMLElement).tagName)) {
                pending.push(...inline(child, inherited, depth + 1));
                continue;
            }
            flush();
            const element = child as HTMLElement,
                tag = element.tagName,
                nextAttrs = attributes(element, attrs),
                nextMarks = marks(element, inherited);
            if (ignored.has(tag)) continue;
            const custom = element.getAttribute('data-clm-kind');
            if (custom && customBlocks.has(custom))
                output.push(
                    node(
                        custom,
                        textKinds.has(custom)
                            ? Array.from(element.childNodes).flatMap((child) => inline(child, nextMarks, depth + 1))
                            : blocks(element, nextMarks, nextAttrs, depth + 1),
                        nextAttrs,
                    ),
                );
            else if (tag === 'HR') output.push(node('horizontalRule'));
            else if (tag === 'TABLE') {
                const row = (element: HTMLElement): NativeNode => {
                    const rowAttrs = attributes(element, nextAttrs),
                        rowMarks = marks(element, nextMarks);
                    const cells = Array.from(element.children)
                        .filter((cell) => ['TD', 'TH'].includes(cell.tagName))
                        .map((cell) => {
                            const cellAttrs = { ...attributes(cell as HTMLElement, rowAttrs) };
                            for (const key of ['colspan', 'rowspan']) {
                                const value = Number(cell.getAttribute(key));
                                if (Number.isSafeInteger(value) && value > 0 && value <= 1000) cellAttrs[key] = value;
                            }
                            const content = blocks(
                                cell as HTMLElement,
                                marks(cell as HTMLElement, rowMarks),
                                cellAttrs,
                                depth + 1,
                            );
                            return node(
                                cell.tagName === 'TH' ? 'tableHeader' : 'tableCell',
                                content.length ? content : [node('paragraph')],
                                cellAttrs,
                            );
                        });
                    return node('tableRow', cells, rowAttrs);
                };
                const rows = Array.from(element.children).flatMap((child) => {
                    if (child.tagName === 'TR') return [row(child as HTMLElement)];
                    if (!['THEAD', 'TBODY', 'TFOOT'].includes(child.tagName)) return [];
                    const children = Array.from(child.children)
                        .filter((child) => child.tagName === 'TR')
                        .map((child) => row(child as HTMLElement));
                    return child.getAttribute('data-clm-kind') === 'tableRowGroup'
                        ? [node('tableRowGroup', children, attributes(child as HTMLElement, nextAttrs))]
                        : children;
                });
                if (rows.length) output.push(node('table', rows, nextAttrs));
            } else if (tag === 'UL' || tag === 'OL') {
                const start = Number(element.getAttribute('start'));
                output.push(
                    node(
                        tag === 'OL' ? 'orderedList' : 'bulletList',
                        Array.from(element.children)
                            .filter((child) => child.tagName === 'LI')
                            .map((item) =>
                                node(
                                    'listItem',
                                    blocks(
                                        item as HTMLElement,
                                        marks(item as HTMLElement, nextMarks),
                                        attributes(item as HTMLElement, nextAttrs),
                                        depth + 1,
                                    ),
                                    attributes(item as HTMLElement, nextAttrs),
                                ),
                            ),
                        tag === 'OL' && Number.isSafeInteger(start) && start > 0 ? { ...nextAttrs, start } : nextAttrs,
                    ),
                );
            } else if (tag === 'BLOCKQUOTE')
                output.push(node('blockquote', blocks(element, nextMarks, nextAttrs, depth + 1), nextAttrs));
            else if (tag === 'PRE')
                output.push(
                    node(
                        'codeBlock',
                        element.textContent ? [{ ...node('text'), text: element.textContent }] : [],
                        nextAttrs,
                    ),
                );
            else if (/^H[1-6]$/.test(tag))
                output.push(
                    node(
                        'heading',
                        Array.from(element.childNodes).flatMap((child) => inline(child, nextMarks, depth + 1)),
                        { ...nextAttrs, level: Number(tag[1]) },
                    ),
                );
            else if (tag === 'P' || !Array.from(element.children).some((child) => blockTags.test(child.tagName)))
                output.push(
                    node(
                        'paragraph',
                        Array.from(element.childNodes).flatMap((child) => inline(child, nextMarks, depth + 1)),
                        nextAttrs,
                    ),
                );
            else output.push(...blocks(element, nextMarks, nextAttrs, depth + 1));
        }
        flush();
        return output;
    };
    return { blocks: blocks(parsed.content, [], {}, 0) };
}

export function readClipboard(get: (type: string) => string, plain = false): NativeFragment {
    if (!plain) {
        const native = get(NATIVE_CLIPBOARD_TYPE) || get(NATIVE_WEB_CLIPBOARD_TYPE);
        if (native) {
            try {
                return parseNativeFragment(native);
            } catch {
                /* Fall back to standard clipboard formats. */
            }
        }
        const html = get('text/html');
        if (html) {
            const fragment = parseHtmlFragment(html);
            if (fragment.blocks.length) return fragment;
        }
    }
    return plainTextFragment(get('text/plain'));
}

export function pasteFragment(
    document: NativeDocument,
    selection: NativeSelection,
    fragment: NativeFragment,
): { document: NativeDocument; caret: TextCaret } {
    if (!fragment.blocks.length) return { document, caret: selection.focus };
    if (selection.cells) return pasteTableCells(document, selection.cells, fragment.blocks, fragment.plain);
    const ranges = selectionRanges(document, selection);
    let base = document,
        caret = { blockId: ranges[0].blockId, offset: ranges[0].from };
    if (selection.cells || selection.scopeId || ranges.length > 1)
        ({ document: base, caret } = replaceSelection(document, selection, ''));
    const inherited = fragment.plain ? marksAtCaret(findNode(document, ranges[0].blockId)!, ranges[0].from) : undefined;
    const inherit = (node: NativeNode): NativeNode =>
        node.kind === 'text'
            ? { ...node, marks: inherited }
            : node.children
              ? { ...node, children: node.children.map(inherit) }
              : node;
    const blocks = inherited ? fragment.blocks.map(inherit) : fragment.blocks;
    const result = pasteBlocks(
        base,
        {
            blockId: caret.blockId,
            from: caret.offset,
            to: base === document ? ranges[0].to : caret.offset,
            expectedRevision: base.revision,
        },
        blocks,
    );
    return { ...result, document: Object.freeze({ ...result.document, revision: document.revision + 1 }) };
}
