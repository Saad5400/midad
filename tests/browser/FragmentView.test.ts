import { describe, expect, it } from 'vitest';
import { fragmentPageHeight } from '@saad5400/midad/browser/view';
import type { ScenePage } from '@saad5400/midad/layout';
const page = (values: Partial<ScenePage> = {}): ScenePage =>
    ({ number: 1, width: 600, height: 800, commands: [], lines: [], ...values }) as ScenePage;
describe('embedded page viewport', () => {
    it('fits empty fragments and clamps full pages', () => {
        expect(fragmentPageHeight(page(), 2)).toBe(300);
        expect(
            fragmentPageHeight(
                page({ commands: [{ kind: 'rect', x: 0, y: 790, width: 10, height: 10, color: [0, 0, 0, 1] }] }),
                1,
            ),
        ).toBe(800);
    });
    it('includes table/image borders and text while ignoring clip rectangles and footer glyphs', () => {
        expect(
            fragmentPageHeight(
                page({
                    lines: [{ top: 100, height: 40 }] as ScenePage['lines'],
                    commands: [
                        { kind: 'clipStart', x: 0, y: 0, width: 600, height: 800 },
                        { kind: 'line', x: 0, y: 170, toX: 500, toY: 180, width: 1, color: [0, 0, 0, 1] },
                        { glyphs: [1], positions: [20, 780], text: ['1'], size: 10, fontId: 'font' },
                    ],
                }),
                1,
            ),
        ).toBe(204);
    });
    it.each([0, -1, Infinity, NaN])('rejects an invalid scale %s', (scale) => {
        expect(() => fragmentPageHeight(page(), scale)).toThrow();
    });
});
