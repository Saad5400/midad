import { viewZoom } from '@saad5400/midad/browser';
import { describe, expect, it } from 'vitest';

describe('native view zoom', () => {
    const page = { width: 600, height: 800 };
    it('fits narrow displays automatically without enlarging documents on desktop', () => {
        expect(viewZoom('auto', page, { width: 320, height: 600 })).toBe(0.4);
        expect(viewZoom('auto', page, { width: 1600, height: 1200 })).toBe(1);
    });
    it('fits width or the complete page while preserving its aspect ratio', () => {
        expect(viewZoom('width', page, { width: 1600, height: 600 })).toBe(2);
        expect(viewZoom('page', page, { width: 1600, height: 600 })).toBeCloseTo(0.5625, 10);
    });
    it('bounds explicit zoom and ignores invalid control values', () => {
        expect(viewZoom('50', page, { width: 320, height: 600 })).toBe(0.5);
        expect(viewZoom('1000', page, { width: 320, height: 600 })).toBe(4);
        expect(viewZoom('0', page, { width: 320, height: 600 })).toBe(0.1);
        expect(viewZoom('invalid', page, { width: 320, height: 600 })).toBe(1);
    });
});
