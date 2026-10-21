import { SelectionScroller } from '@saad5400/midad/autoscroll';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('native selection scrolling', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0;
    let holder: HTMLDivElement;
    let scroller: SelectionScroller;

    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frames.set(++id, callback);
            return id;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
        holder = document.createElement('div');
        holder.style.overflowY = 'auto';
        Object.defineProperties(holder, { clientHeight: { value: 400 }, scrollHeight: { value: 2000 } });
        vi.spyOn(holder, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 400 } as DOMRect);
        const editor = document.createElement('div');
        holder.append(editor);
        document.body.append(holder);
        scroller = new SelectionScroller(editor);
    });

    afterEach(() => {
        scroller.stop();
        holder.remove();
        frames.clear();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function frame(): void {
        const [id, callback] = frames.entries().next().value!;
        frames.delete(id);
        callback(performance.now());
    }

    it('keeps a single animation active and updates the selection as the viewport moves', () => {
        const update = vi.fn();
        scroller.update(100, 395, update);
        scroller.update(100, 395, update);
        expect(frames.size).toBe(1);
        frame();
        expect(holder.scrollTop).toBeGreaterThan(0);
        expect(update).toHaveBeenCalledOnce();
        expect(frames.size).toBe(1);
        scroller.stop();
        expect(frames.size).toBe(0);
    });

    it('does not keep an animation running away from the viewport edges', () => {
        const update = vi.fn();
        scroller.update(100, 200, update);
        frame();
        expect(holder.scrollTop).toBe(0);
        expect(update).not.toHaveBeenCalled();
        expect(frames.size).toBe(0);
    });

    it('honors cancellation triggered during a selection update', () => {
        scroller.update(100, 395, () => scroller.stop());
        frame();
        expect(frames.size).toBe(0);
    });
});
