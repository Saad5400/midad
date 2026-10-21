import { blockGutterPosition, columnGutterSide } from '@saad5400/midad/browser';
import { describe, expect, it } from 'vitest';

const bounds = { left: 0, top: 0, right: 500, bottom: 500 };
describe('block control placement', () => {
    it.each(['ltr', 'rtl'] as const)('uses the outer %s gutter when there is room', (direction) => {
        const placed = blockGutterPosition({ left: 100, right: 400, top: 100, bottom: 200 }, bounds, direction);
        expect(placed).toMatchObject({
            left: direction === 'ltr' ? 38 : 406,
            width: 56,
            height: 28,
            vertical: false,
            visible: true,
        });
    });
    it.each(['ltr', 'rtl'] as const)('stacks controls in a narrow %s gutter', (direction) => {
        const placed = blockGutterPosition({ left: 40, right: 460, top: 100, bottom: 200 }, bounds, direction);
        expect(placed).toMatchObject({
            left: direction === 'ltr' ? 4 : 466,
            width: 30,
            height: 52,
            vertical: true,
            visible: true,
        });
    });
    it('moves above or below full-width blocks and hides rather than covering their text', () => {
        const block = { left: 10, right: 490, top: 100, bottom: 200 };
        expect(blockGutterPosition(block, bounds, 'ltr')).toMatchObject({ top: 66, visible: true });
        expect(blockGutterPosition({ ...block, top: 0 }, bounds, 'ltr')).toMatchObject({ top: 206, visible: true });
        expect(blockGutterPosition({ ...block, top: 0, bottom: 490 }, bounds, 'ltr').visible).toBe(false);
        expect(blockGutterPosition({ ...block, top: 600, bottom: 700 }, bounds, 'ltr').visible).toBe(false);
    });
    it('chooses the outer edge of each language column and uses the row direction for middle columns', () => {
        const columns = [
            { id: 'right', x: 330, width: 160 },
            { id: 'middle', x: 170, width: 150 },
            { id: 'left', x: 10, width: 150 },
        ];
        expect(columnGutterSide(columns, 'left', 'rtl')).toEqual({ direction: 'ltr', column: columns[2] });
        expect(columnGutterSide(columns, 'right', 'ltr')).toEqual({ direction: 'rtl', column: columns[0] });
        expect(columnGutterSide(columns, 'middle', 'rtl')).toEqual({ direction: 'rtl', column: undefined });
        expect(columnGutterSide([], 'missing', 'ltr')).toEqual({ direction: 'ltr', column: undefined });
    });
});
