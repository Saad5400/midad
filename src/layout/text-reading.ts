import { point, type ShapedRun } from '../rendering/kernel.js';
import type { TextReading } from './scene.js';

export function readingRun(group: string, run: ShapedRun, top: number, height: number, x = 0): readonly TextReading[] {
    const space = (index: number) => /^\s+$/.test(run.text[index]);
    let first = 0,
        last = run.glyphs.length;
    while (first < last && space(first)) first++;
    while (last > first && space(last - 1)) last--;
    const ranges =
        first === run.glyphs.length
            ? [[0, first]]
            : [
                  [0, first],
                  [first, last],
                  [last, run.glyphs.length],
              ];
    return ranges
        .filter(([from, to]) => to > from)
        .map(([from, to]) => {
            const clusters = run.text
                .slice(from, to)
                .map((text, index) => ({ text, offset: run.offsets[from + index] }));
            clusters.sort((a, b) => a.offset - b.offset);
            let left = Infinity,
                right = -Infinity;
            for (let index = from * 2; index <= to * 2; index += 2) {
                left = Math.min(left, run.positions[index]);
                right = Math.max(right, run.positions[index]);
            }
            return {
                from,
                to,
                group,
                order: [clusters[0]?.offset ?? 0],
                text: clusters.map((entry) => entry.text).join(''),
                box: {
                    x: point(left + x),
                    y: point(top),
                    width: point(Math.max(0, right - left)),
                    height: point(height),
                },
            };
        });
}

export function compareReading(a: readonly number[], b: readonly number[]): number {
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
        const difference = (a[index] ?? 0) - (b[index] ?? 0);
        if (difference) return difference;
    }
    return 0;
}
