import type { PdfReviewPiece } from './anchors.js';

export interface PdfReviewRect {
    left: number;
    top: number;
    width: number;
    height: number;
}
export function reviewRects(
    holder: HTMLElement,
    text: HTMLElement,
    pieces: readonly PdfReviewPiece[],
    scale: number,
): PdfReviewRect[] {
    const rows = text.querySelectorAll('.native-pdf-reading-row');
    const origin = holder.getBoundingClientRect();
    const result: (PdfReviewRect & { row: string; blank: boolean; clip?: PdfReviewPiece['clip'] })[] = [];
    const point = (node: Element, offset: number): { node: Text; offset: number } | undefined => {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let current = walker.nextNode() as Text | null;
        while (current) {
            if (offset <= current.length) return { node: current, offset };
            offset -= current.length;
            const next = walker.nextNode() as Text | null;
            if (!next) return { node: current, offset: current.length };
            current = next;
        }
    };
    for (const piece of pieces) {
        const target =
            piece.row === undefined
                ? text.querySelector(`[data-native-pdf-item="${piece.span}"]`)
                : rows[piece.row]?.querySelectorAll(':scope > .markedContent[id]')[piece.span];
        if (!target) continue;
        const value = target.textContent ?? '';
        if (piece.source !== undefined && piece.source !== value) continue;
        const from = Math.min(piece.from, value.length),
            to = Math.min(piece.to, value.length);
        if (to <= from) continue;
        const start = point(target, from),
            end = point(target, to);
        if (!start || !end) continue;
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        for (const rectangle of range.getClientRects()) {
            const left = Math.max(0, rectangle.left - origin.left, (piece.clip?.x ?? 0) * scale);
            const top = Math.max(0, rectangle.top - origin.top, (piece.clip?.y ?? 0) * scale);
            const right = Math.min(
                origin.width,
                rectangle.right - origin.left,
                piece.clip ? (piece.clip.x + piece.clip.width) * scale : Infinity,
            );
            const bottom = Math.min(
                origin.height,
                rectangle.bottom - origin.top,
                piece.clip ? (piece.clip.y + piece.clip.height) * scale : Infinity,
            );
            if (right > left && bottom > top)
                result.push({
                    left,
                    top,
                    width: right - left,
                    height: bottom - top,
                    row: piece.row === undefined ? `item:${piece.span}` : `row:${piece.row}`,
                    blank: !value.slice(from, to).trim(),
                    clip: piece.clip,
                });
        }
    }
    const groups = new Map<string, typeof result>();
    for (const rectangle of result) {
        const row = groups.get(rectangle.row) ?? [];
        row.push(rectangle);
        groups.set(rectangle.row, row);
    }
    const merged: PdfReviewRect[] = [];
    for (const row of groups.values()) {
        const ink = row.filter((rectangle) => !rectangle.blank);
        const top = Math.min(...(ink.length ? ink : row).map((rectangle) => rectangle.top));
        const bottom = Math.max(...(ink.length ? ink : row).map((rectangle) => rectangle.top + rectangle.height));
        const ordered = row
            .map((rectangle) => {
                const start = Math.max(top, rectangle.clip ? rectangle.clip.y * scale : 0);
                const end = Math.min(
                    bottom,
                    rectangle.clip ? (rectangle.clip.y + rectangle.clip.height) * scale : origin.height,
                );
                return { left: rectangle.left, top: start, width: rectangle.width, height: Math.max(0, end - start) };
            })
            .filter((rectangle) => rectangle.height > 0)
            .sort((a, b) => a.left - b.left);
        for (const rectangle of ordered) {
            const previous = merged.at(-1);
            if (
                previous &&
                Math.abs(previous.top - rectangle.top) < 1 &&
                Math.abs(previous.height - rectangle.height) < 1 &&
                rectangle.left >= previous.left &&
                rectangle.left <= previous.left + previous.width + 1.5
            )
                previous.width =
                    Math.max(previous.left + previous.width, rectangle.left + rectangle.width) - previous.left;
            else merged.push({ ...rectangle });
        }
    }
    return merged;
}
