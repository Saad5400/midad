import type { Surface } from 'canvaskit-wasm';
import type { NativeTextKernel } from '@saad5400/midad/kernel';
import type { ScenePage } from '@saad5400/midad/layout';
import { paintPage } from '@saad5400/midad/paint';
import { describe, expect, it, vi } from 'vitest';

describe('canvas command cleanup', () => {
    it.each(['glyphs', 'clip', 'image'])('unwinds canvas state and native resources after a %s failure', (kind) => {
        const failure = new Error('Drawing failed');
        let saves = 3;
        const paintDelete = vi.fn(),
            fontDelete = vi.fn();
        const canvas = {
            clear: vi.fn(),
            getSaveCount: () => saves,
            save: () => ++saves,
            scale: vi.fn(),
            restore: () => --saves,
            restoreToCount: vi.fn((value: number) => {
                saves = value;
            }),
            clipRect: vi.fn(() => {
                if (kind === 'clip') throw failure;
            }),
            drawGlyphs: vi.fn(() => {
                if (kind === 'glyphs') throw failure;
            }),
            drawImageRect: vi.fn(() => {
                if (kind === 'image') throw failure;
            }),
        };
        const ck = {
            Paint: class {
                delete = paintDelete;
                setColor() {}
                setAntiAlias() {}
                setStyle() {}
            },
            Font: class {
                delete = fontDelete;
                setHinting() {}
            },
            PaintStyle: { Fill: 0 },
            FontHinting: { None: 0 },
            ClipOp: { Intersect: 0 },
            XYWHRect: vi.fn(),
            Color4f: vi.fn(),
        };
        const kernel = {
            ck,
            font: () => ({ typeface: {} }),
            images: { get: () => ({ image: {}, width: 1, height: 1 }) },
        } as unknown as NativeTextKernel;
        const flush = vi.fn(),
            surface = { getCanvas: () => canvas, flush } as unknown as Surface;
        const page: ScenePage = {
            width: 100,
            height: 100,
            lines: [],
            commands: [
                { kind: 'clipStart', x: 0, y: 0, width: 100, height: 100 },
                ...(kind === 'image'
                    ? [{ kind: 'image' as const, assetId: 'one', x: 0, y: 0, width: 10, height: 10 }]
                    : [
                          {
                              kind: 'glyphs' as const,
                              fontId: 'one',
                              size: 12,
                              glyphs: [1],
                              text: ['x'],
                              positions: [10, 20],
                          },
                      ]),
                { kind: 'clipEnd' },
            ],
        };
        expect(() => paintPage(kernel, surface, page, 2)).toThrow(failure);
        expect(saves).toBe(3);
        expect(paintDelete).toHaveBeenCalledTimes(1);
        expect(fontDelete).toHaveBeenCalledTimes(kind === 'glyphs' ? 1 : 0);
        expect(flush).not.toHaveBeenCalled();
    });
});
