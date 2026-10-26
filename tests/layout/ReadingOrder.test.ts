import type { ShapedRun } from '@saad5400/midad/rendering';
import { DEFAULT_TEXT_STYLE } from '@saad5400/midad/typography';
import { expect, it } from 'vitest';
import { readingRun } from '../../dist/layout/text-reading.js';

it('preserves logical text order, stable cluster ties and exact boxes for directional and mixed offsets', () => {
    const cases = [
        [],
        [0],
        [0, 1, 2, 3, 4],
        [4, 3, 2, 1, 0],
        [4, 4, 3, 2, 2, 0, 0],
        [2, 2, 2, 2],
        [3, 0, 4, 4, 1],
        ...Array.from({ length: 100 }, (_, seed) =>
            Array.from({ length: 30 }, (_, index) => (seed * 17 + index * 31 + index * index) % 19),
        ),
    ];
    for (const offsets of cases) {
        const run: ShapedRun = {
            fontId: 'test',
            size: 10,
            style: DEFAULT_TEXT_STYLE,
            fauxBold: false,
            fauxItalic: false,
            glyphs: offsets.map((_, index) => index + 1),
            text: offsets.map((_, index) => ['a', '', ' ', 'ي', 'ً', 'B'][index % 6]),
            offsets: [...offsets, 99],
            positions: Array.from({ length: (offsets.length + 1) * 2 }, (_, index) =>
                index % 2 ? 0 : (((index * 131) % 79) - 40) / 1024,
            ),
        };
        const parts = readingRun('paragraph', run, 4, 12, 5);
        expect(
            parts.flatMap((part) => Array.from({ length: part.to - part.from }, (_, index) => part.from + index)),
        ).toEqual(offsets.map((_, index) => index));
        for (const part of parts) {
            const logical = offsets
                .slice(part.from, part.to)
                .map((offset, index) => ({ offset, index: part.from + index }))
                .sort((a, b) => a.offset - b.offset);
            expect(part.order).toEqual([logical[0].offset]);
            expect(part.text).toBe(logical.map(({ index }) => run.text[index]).join(''));
            const positions = Array.from(
                { length: part.to - part.from + 1 },
                (_, index) => run.positions[(part.from + index) * 2],
            );
            expect(part.box).toEqual({
                x: 5 + Math.min(...positions),
                y: 4,
                width: Math.max(...positions) - Math.min(...positions),
                height: 12,
            });
        }
    }
});
