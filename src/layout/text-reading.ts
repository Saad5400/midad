import type { ShapedRun } from '../rendering/text/model.js';
import { point } from '../typography/metrics.js';
import type { TextReading } from './scene.js';

const whitespace = /^\s+$/;

export function readingRun(group: string, run: ShapedRun, top: number, height: number, x = 0): readonly TextReading[] {
    if (!run.glyphs.length) return [];
    if (run.glyphs.length === 1) {
        const left = Math.min(run.positions[0], run.positions[2]),
            right = Math.max(run.positions[0], run.positions[2]);
        return [
            {
                from: 0,
                to: 1,
                group,
                order: [run.offsets[0] ?? 0],
                text: run.text[0] ?? '',
                box: {
                    x: point(left + x),
                    y: point(top),
                    width: point(Math.max(0, right - left)),
                    height: point(height),
                },
            },
        ];
    }
    let first = 0,
        last = run.glyphs.length;
    while (first < last && whitespace.test(run.text[first])) first++;
    while (last > first && whitespace.test(run.text[last - 1])) last--;
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
            let ascending = true,
                descending = true;
            for (let index = from + 1; index < to; index++) {
                if (run.offsets[index] < run.offsets[index - 1]) ascending = false;
                if (run.offsets[index] > run.offsets[index - 1]) descending = false;
            }
            const clusters: number[] = [];
            if (ascending) {
                for (let index = from; index < to; index++) clusters.push(index);
            } else if (descending) {
                for (let end = to; end > from; ) {
                    let start = end - 1;
                    while (start > from && run.offsets[start - 1] === run.offsets[start]) start--;
                    for (let index = start; index < end; index++) clusters.push(index);
                    end = start;
                }
            } else {
                for (let index = from; index < to; index++) clusters.push(index);
                clusters.sort((a, b) => run.offsets[a] - run.offsets[b]);
            }
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
                order: [run.offsets[clusters[0]] ?? 0],
                text: clusters.map((index) => run.text[index]).join(''),
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
