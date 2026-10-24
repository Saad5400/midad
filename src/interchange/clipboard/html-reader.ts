import { copyJson, type Attributes, type NativeMark, type NativeNode } from '../../document/model.js';
import { chooseFont } from '../../typography/fonts.js';
import { DEFAULT_TEXT_STYLE, color, lineHeight, textSize } from '../../typography/style.js';
import { safeLink } from './html-policy.js';
import { customBlocks, limit, textKinds, type NativeFragment } from './model.js';

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
    const blockSelector = 'p,div,h1,h2,h3,h4,h5,h6,pre,blockquote,ul,ol,li,table,hr,section,article';
    const attributes = (element: HTMLElement, inherited: Attributes): Attributes => {
        const attrs = { ...scope(inherited), ...metadata(element) };
        const direction = (element.getAttribute('dir') || element.style.direction).trim().toLowerCase();
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
            const element = child.nodeType === 1 ? (child as HTMLElement) : undefined;
            if (element && ignored.has(element.tagName)) continue;
            const nestedBlocks = element?.querySelector(blockSelector);
            if (!element || (!blockTags.test(element.tagName) && !nestedBlocks)) {
                pending.push(...inline(child, inherited, depth + 1));
                continue;
            }
            flush();
            const tag = element.tagName,
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
            else if (tag === 'P' || !nestedBlocks)
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
