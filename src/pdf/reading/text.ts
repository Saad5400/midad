import type { PDFPageProxy } from 'pdfjs-dist';
type TextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>;

export interface PdfReadingSpan {
    id: string;
    text: string;
    box: number[];
}
export interface PdfPageText {
    content: TextContent;
    rows: readonly (readonly PdfReadingSpan[])[];
    text: string;
}
interface TreeNode {
    role?: string;
    type?: string;
    id?: string;
    alt?: string;
    bbox?: number[];
    children?: TreeNode[];
}
export async function pdfPageText(page: PDFPageProxy, tagged: boolean): Promise<PdfPageText> {
    const content = await page.getTextContent({ includeMarkedContent: tagged, disableNormalization: tagged });
    if (!tagged)
        return {
            content,
            rows: [],
            text: content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''),
        };
    const tree = (await page.getStructTree()) as TreeNode | null;
    const rows: PdfReadingSpan[][] = [];
    const visit = (node: TreeNode, row?: PdfReadingSpan[]): void => {
        if (node.role === 'P') {
            row = [];
            rows.push(row);
        }
        if (node.role === 'Span' && typeof node.alt === 'string' && node.bbox?.length === 4) {
            for (const child of node.children ?? []) {
                if (child.type === 'content' && child.id) row?.push({ id: child.id, text: node.alt, box: node.bbox });
            }
            return;
        }
        node.children?.forEach((child) => visit(child, row));
    };
    if (tree) visit(tree);
    if (!rows.length && content.items.some((item) => 'str' in item && item.str.trim()))
        throw new Error('The PDF reading structure is missing');
    return { content, rows, text: rows.map((row) => row.map((span) => span.text).join('')).join('\n') };
}

export function applyPdfReading(
    container: HTMLElement,
    data: PdfPageText,
    viewport: ReturnType<PDFPageProxy['getViewport']>,
): void {
    if (!data.rows.length) return;
    const marked = new Map(
        [...container.querySelectorAll<HTMLElement>('.markedContent[id]')].map((node) => [node.id, node]),
    );
    const fragment = document.createDocumentFragment();
    const moved = new Set<Node>();
    const measure = document.createElement('canvas').getContext('2d');
    if (measure) measure.direction = 'ltr';
    for (const row of data.rows) {
        const group = document.createElement('div');
        group.className = 'markedContent native-pdf-reading-row';
        for (const span of row) {
            const node = marked.get(span.id);
            if (!node) throw new Error('The PDF text selection structure is incomplete');
            if (/^\s+$/.test(span.text)) {
                const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(span.box);
                const space = document.createElement('span');
                space.textContent = span.text;
                space.className = 'native-pdf-space';
                Object.assign(space.style, {
                    left: `${Math.min(x1, x2)}px`,
                    top: `${Math.min(y1, y2)}px`,
                    width: `${Math.abs(x2 - x1)}px`,
                    height: `${Math.abs(y2 - y1)}px`,
                    fontSize: `${Math.abs(y2 - y1)}px`,
                    transform: 'none',
                });
                node.replaceChildren(space);
            } else {
                while (node.firstChild && !node.firstChild.textContent?.trim()) node.firstChild.remove();
                while (node.lastChild && !node.lastChild.textContent?.trim()) node.lastChild.remove();
                if (node.textContent !== span.text) {
                    const target = node.querySelector<HTMLElement>('span:not(.markedContent)');
                    if (!target || !measure) throw new Error('The PDF text selection could not be aligned');
                    const [x1, , x2] = viewport.convertToViewportRectangle(span.box);
                    const minimum = Number(container.style.getPropertyValue('--min-font-size')) || 1;
                    const fontHeight = parseFloat(target.style.getPropertyValue('--font-height'));
                    if (!Number.isFinite(fontHeight) || fontHeight <= 0)
                        throw new Error('The PDF font metrics are missing');
                    const size = fontHeight * viewport.scale * viewport.userUnit * minimum;
                    measure.font = `${size}px ${target.style.fontFamily || 'sans-serif'}`;
                    const width = measure.measureText(span.text).width;
                    target.textContent = span.text;
                    target.style.left = `${Math.min(x1, x2)}px`;
                    target.style.setProperty(
                        '--scale-x',
                        String(width > 0 ? (Math.abs(x2 - x1) * minimum) / width : 1),
                    );
                    node.replaceChildren(target);
                }
            }
            moved.add(node);
            group.append(node);
        }
        group.append(document.createElement('br'));
        fragment.append(group);
    }
    fragment.append(...[...container.childNodes].filter((node) => !moved.has(node)));
    container.replaceChildren(fragment);
}
