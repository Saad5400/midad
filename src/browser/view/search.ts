import type { CanvasKit } from 'canvaskit-wasm';
import type { TextMatch } from '../../editing/search.js';
import type { DocumentScene } from '../../layout/scene.js';

export interface SearchRectangle {
    readonly pageIndex: number;
    readonly matchIndex: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export function searchRectangles(
    scene: DocumentScene,
    matches: readonly TextMatch[],
    ck: CanvasKit,
    pages?: ReadonlySet<number>,
): readonly SearchRectangle[] {
    const byBlock = new Map<string, Array<{ match: TextMatch; index: number; end: number }>>();
    matches.forEach((match, index) => {
        const entries = byBlock.get(match.blockId) ?? [];
        entries.push({ match, index, end: match.to });
        byBlock.set(match.blockId, entries);
    });
    for (const entries of byBlock.values()) {
        entries.sort((a, b) => a.match.from - b.match.from || a.match.to - b.match.to);
        let end = 0;
        for (const entry of entries) {
            end = Math.max(end, entry.match.to);
            entry.end = end;
        }
    }
    const rectangles: SearchRectangle[] = [];
    scene.pages.forEach((page, pageIndex) => {
        if (pages && !pages.has(pageIndex)) return;
        for (const line of page.lines) {
            const found = byBlock.get(line.paragraphId);
            if (!found) continue;
            const shaped = line.shaped;
            const row = shaped.lines.find((row) => row.top === line.originalTop);
            if (!row) continue;
            const first = shaped.sources[0];
            const prefix =
                (first?.nodeId === line.paragraphId && !first.editable ? first.to : 0) - (line.fragmentFrom ?? 0);
            let low = 0,
                high = found.length;
            while (low < high) {
                const middle = (low + high) >>> 1;
                if (found[middle].end + prefix <= row.start) low = middle + 1;
                else high = middle;
            }
            for (let cursor = low; cursor < found.length && found[cursor].match.from + prefix < row.end; cursor++) {
                const { match, index } = found[cursor];
                const from = Math.max(row.start, match.from + prefix),
                    to = Math.min(row.end, match.to + prefix);
                if (from >= to) continue;
                for (const { rect } of shaped.paragraph.getRectsForRange(
                    from,
                    to,
                    ck.RectHeightStyle.Max,
                    ck.RectWidthStyle.Tight,
                ))
                    rectangles.push({
                        pageIndex,
                        matchIndex: index,
                        x: (line.left ?? 0) + rect[0],
                        y: line.top + rect[1] - line.originalTop,
                        width: rect[2] - rect[0],
                        height: rect[3] - rect[1],
                    });
            }
        }
    });
    return rectangles;
}
