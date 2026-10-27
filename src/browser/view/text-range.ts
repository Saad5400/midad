import type { CanvasKit } from 'canvaskit-wasm';
import type { ShapedParagraph } from '../../rendering/text/model.js';

const cache = new WeakMap<ShapedParagraph, Map<string, readonly (readonly number[])[]>>();

export function textRangeRectangles(
    shaped: ShapedParagraph,
    from: number,
    to: number,
    ck: CanvasKit,
): readonly (readonly number[])[] {
    if (from >= to) return [];
    let ranges = cache.get(shaped);
    if (!ranges) cache.set(shaped, (ranges = new Map()));
    const key = `${from}:${to}`;
    const previous = ranges.get(key);
    if (previous) return previous;
    const rectangles = shaped.paragraph
        .getRectsForRange(from, to, ck.RectHeightStyle.Max, ck.RectWidthStyle.Tight)
        .map(({ rect }) => Array.from(rect));
    if (ranges.size >= 4) ranges.delete(ranges.keys().next().value!);
    ranges.set(key, rectangles);
    return rectangles;
}
