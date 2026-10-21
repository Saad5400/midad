import { ViewportReadiness } from '@saad5400/midad/browser/viewport-readiness';
import type { PageViewState } from '@saad5400/midad/browser/page-view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let frames: Map<number, FrameRequestCallback>, serial: number;
const state = (paintedRevision?: number, visible = true): PageViewState => ({
    near: true,
    visible,
    failed: false,
    paintedRevision,
});
function tick(): void {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
}
beforeEach(() => {
    frames = new Map();
    serial = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.set(++serial, callback);
        return serial;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());
describe('first visible viewport readiness', () => {
    it('waits for current painted content and accepts a later page without painting the first page', async () => {
        const committed = vi.fn(),
            view = new ViewportReadiness({ revision: () => 2, committed });
        view.update(0, state(2, false));
        tick();
        view.update(7, state(1));
        tick();
        expect(committed).not.toHaveBeenCalled();
        view.update(7, state(2));
        tick();
        await view.ready;
        expect(committed).toHaveBeenCalledTimes(1);
        expect(committed).toHaveBeenCalledWith(7);
        view.update(8, state(2));
        tick();
        expect(committed).toHaveBeenCalledTimes(1);
    });
    it('rechecks visibility and revision after the frame boundary', async () => {
        let revision = 1;
        const committed = vi.fn(),
            view = new ViewportReadiness({ revision: () => revision, committed });
        view.update(2, state(1));
        view.update(2, state(1, false));
        tick();
        expect(committed).not.toHaveBeenCalled();
        view.update(3, state(1));
        revision = 2;
        tick();
        expect(committed).not.toHaveBeenCalled();
        view.update(3, state(2));
        tick();
        await view.ready;
        expect(committed).toHaveBeenCalledTimes(1);
    });
    it('rejects a failed viewport and cancels readiness when the editor closes', async () => {
        const committed = vi.fn(),
            failed = new ViewportReadiness({ revision: () => 1, committed });
        failed.update(4, state(1));
        failed.fail(new Error('Canvas failed'));
        tick();
        await expect(failed.ready).rejects.toThrow('Canvas failed');
        const closed = new ViewportReadiness({ revision: () => 1, committed });
        closed.update(5, state(1));
        closed.dispose();
        tick();
        await expect(closed.ready).rejects.toThrow('editor closed');
        expect(committed).not.toHaveBeenCalled();
    });
});
