import { PageCanvasController, type PageCanvasTarget } from '@saad5400/midad/browser';
import { PageView, type PageViewState } from '@saad5400/midad/browser';
import type { NativeTextKernel } from '@saad5400/midad/rendering';
import { afterEach, describe, expect, it, vi } from 'vitest';

const paint = vi.hoisted(() => vi.fn());
vi.mock('@saad5400/midad/paint', () => ({ paintPage: paint }));
afterEach(() => {
    paint.mockReset();
    vi.unstubAllGlobals();
});

function fixture() {
    const dispose = vi.fn(),
        surface = vi.fn(() => ({ dispose }));
    const target: PageCanvasTarget = {
        canvas: document.createElement('canvas'),
        kernel: { surface } as unknown as NativeTextKernel,
        page: { width: 600, height: 840, lines: [], commands: [] },
        revision: 1,
        scale: 1,
        pixelRatio: 1,
    };
    return { target, dispose, surface };
}
describe('standalone canvas lifecycle', () => {
    it('reuses unchanged surfaces and reallocates for a changed canvas, kernel, scale or pixel ratio', () => {
        const { target, dispose, surface } = fixture();
        const view = new PageCanvasController();
        view.paint(target);
        expect(view.paintedRevision).toBe(1);
        view.paint({ ...target, revision: 2 });
        expect(surface).toHaveBeenCalledTimes(1);
        view.paint({ ...target, scale: 2 });
        expect(surface).toHaveBeenCalledTimes(2);
        expect(target.canvas.width).toBe(1200);
        view.paint({ ...target, pixelRatio: 2 });
        expect(surface).toHaveBeenCalledTimes(2);
        const next = document.createElement('canvas');
        view.paint({ ...target, canvas: next, pixelRatio: 2 });
        expect(surface).toHaveBeenCalledTimes(3);
        expect(target.canvas.width).toBe(0);
        const other = fixture();
        view.paint({ ...other.target, canvas: next, pixelRatio: 2 });
        expect(other.surface).toHaveBeenCalledTimes(1);
        expect(dispose).toHaveBeenCalledTimes(3);
        view.dispose();
    });
    it('clears failed pixels, preserves the painting failure and recovers even when disposal throws', () => {
        const { target, dispose } = fixture();
        const view = new PageCanvasController();
        view.paint(target);
        const failure = new Error('Glyph paint failed');
        paint.mockImplementationOnce(() => {
            throw failure;
        });
        dispose.mockImplementationOnce(() => {
            throw new Error('Cleanup failed');
        });
        expect(() => view.paint({ ...target, revision: 2 })).toThrow(failure);
        expect(view.paintedRevision).toBeUndefined();
        expect(target.canvas.width).toBe(0);
        view.paint({ ...target, revision: 3 });
        expect(view.paintedRevision).toBe(3);
        view.dispose();
        view.dispose();
    });
    it('bounds backing storage and rejects invalid geometry without leaving stale pixels', () => {
        const { target } = fixture();
        const view = new PageCanvasController();
        view.paint({ ...target, scale: 4, pixelRatio: 8 });
        expect(target.canvas.width * target.canvas.height).toBeLessThan(12_010_000);
        expect(() => view.paint({ ...target, scale: NaN })).toThrow('Invalid canvas scale');
        expect(target.canvas.width).toBe(0);
        expect(view.paintedRevision).toBeUndefined();
    });
});

describe('framework-independent page view', () => {
    function open() {
        const observers: Array<{
            callback: IntersectionObserverCallback;
            disconnect: ReturnType<typeof vi.fn>;
            options?: IntersectionObserverInit;
        }> = [];
        vi.stubGlobal(
            'IntersectionObserver',
            class {
                disconnect = vi.fn();
                constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
                    observers.push({ callback, options, disconnect: this.disconnect });
                }
                observe() {}
            },
        );
        const host = document.createElement('div');
        const { target, surface, dispose } = fixture();
        const states: PageViewState[] = [],
            painted = vi.fn(),
            error = vi.fn();
        const view = new PageView(
            host,
            { ...target, label: 'Page 8' },
            { state: (state) => states.push(state), painted, error },
        );
        const intersect = (index: number, visible: boolean) =>
            observers[index].callback(
                [{ isIntersecting: visible, intersectionRatio: visible ? 1 : 0 } as IntersectionObserverEntry],
                {} as IntersectionObserver,
            );
        return { host, target, surface, dispose, states, painted, error, view, observers, intersect };
    }
    it('distinguishes overscan painting from the visible viewport and coalesces updates to the latest revision', async () => {
        const f = open();
        try {
            expect(f.host.style.width).toBe('600px');
            expect(f.host.style.height).toBe('840px');
            f.intersect(0, true);
            f.view.update({ ...f.target, revision: 2 });
            f.view.update({ ...f.target, revision: 3 });
            await Promise.resolve();
            expect(f.painted).toHaveBeenCalledTimes(1);
            expect(f.states.at(-1)).toMatchObject({ near: true, visible: false, paintedRevision: 3, failed: false });
            expect(f.host.querySelector('canvas')?.getAttribute('data-painted-revision')).toBe('3');
            f.observers[1].callback(
                [{ isIntersecting: true, intersectionRatio: 0 } as IntersectionObserverEntry],
                {} as IntersectionObserver,
            );
            expect(f.states.at(-1)?.visible).toBe(false);
            f.intersect(1, true);
            expect(f.states.at(-1)?.visible).toBe(true);
            expect(f.painted).toHaveBeenCalledTimes(1);
        } finally {
            f.view.dispose();
        }
    });
    it('virtualizes distant canvases, cancels pending work and releases observers and backing storage', async () => {
        const f = open();
        f.intersect(0, true);
        await Promise.resolve();
        const canvas = f.host.querySelector('canvas')!;
        f.intersect(0, false);
        await Promise.resolve();
        expect(f.host.querySelector('canvas')).toBeNull();
        expect(canvas.width).toBe(0);
        expect(f.dispose).toHaveBeenCalledTimes(1);
        f.intersect(0, true);
        f.view.dispose();
        await Promise.resolve();
        expect(f.surface).toHaveBeenCalledTimes(1);
        expect(f.observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true);
    });
    it('invalidates a failed revision and retries through a normal resize without stale interaction state', async () => {
        const f = open();
        try {
            f.intersect(0, true);
            await Promise.resolve();
            const failure = new Error('Paint failed');
            paint.mockImplementationOnce(() => {
                throw failure;
            });
            f.view.update({ ...f.target, revision: 2 });
            expect(f.states.at(-1)?.paintedRevision).toBeUndefined();
            await Promise.resolve();
            expect(f.states.at(-1)).toMatchObject({ failed: true, paintedRevision: undefined });
            expect(f.error).toHaveBeenCalledWith(failure);
            expect(f.host.querySelector('canvas')?.style.opacity).toBe('0');
            window.dispatchEvent(new Event('resize'));
            await Promise.resolve();
            expect(f.states.at(-1)).toMatchObject({ failed: false, paintedRevision: 2 });
        } finally {
            f.view.dispose();
        }
    });
});
