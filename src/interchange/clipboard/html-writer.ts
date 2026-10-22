import type { NativeNode } from '../../document/model.js';
import { inheritedDirection } from '../../typography/direction.js';
import { chooseFont } from '../../typography/fonts.js';
import { DEFAULT_TEXT_STYLE, blockTextStyle, nodeTextStyle, type Color } from '../../typography/style.js';
import { customBlocks, type NativeFragment } from './model.js';
import { safeLink } from './html-policy.js';

const escape = (text: string): string =>
    text.replace(
        /[&<>"']/g,
        (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    );
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
