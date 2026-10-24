import { describe, expect, it } from 'vitest';
import { fitWidths } from '../../src/layout/intrinsic.js';

describe('content constrained column widths', () => {
    it('preserves requested proportions when the content already fits', () => {
        expect(fitWidths(360, [1, 2], [40, 70])).toEqual([120, 240]);
        expect(fitWidths(360, [2, 1], [70, 40])).toEqual([240, 120]);
    });
    it('redistributes only enough room to fit an otherwise overflowing column', () => {
        expect(fitWidths(200, [1, 3], [70, 50])).toEqual([70, 130]);
        expect(fitWidths(200, [3, 1], [50, 70])).toEqual([130, 70]);
    });
    it('keeps finite widths within the available area over varied feasible constraints', () => {
        let seed = 5400;
        const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
        for (let iteration = 0; iteration < 200; iteration++) {
            const count = 2 + (next() % 7);
            const weights = Array.from({ length: count }, () => 1 + (next() % 10));
            const minimum = Array.from({ length: count }, () => 5 + (next() % 35));
            const widths = fitWidths(450, weights, minimum);
            expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(450, 8);
            for (const [index, width] of widths.entries()) {
                expect(Number.isFinite(width)).toBe(true);
                expect(width + 1e-8).toBeGreaterThanOrEqual(minimum[index]);
            }
        }
    });
});
