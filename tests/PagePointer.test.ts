import { PagePointerController, type PagePointerPoint } from '@saad5400/midad/browser/page-pointer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('framework-independent page pointer controller', () => {
    let controller: PagePointerController;
    let element: HTMLElement;
    let points: PagePointerPoint[];
    let selectingCells: boolean;
    let now: number;
    const pointer = (type: string, options: PointerEventInit = {}) =>
        new PointerEvent(type, {
            pointerId: 1,
            isPrimary: true,
            pointerType: 'touch',
            clientX: 110,
            clientY: 220,
            ...options,
        });
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        element = document.createElement('article');
        element.setPointerCapture = vi.fn();
        vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 500, 700));
        points = [];
        selectingCells = false;
        controller = new PagePointerController({
            element: () => element,
            scale: () => 2,
            selectingCells: () => selectingCells,
            onPoint: (point) => points.push(point),
            onFinish: vi.fn(),
        });
    });
    afterEach(() => {
        controller.pointerCancel();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });
    it('retains mouse click counts, scaled positions, shift selection and captured dragging', () => {
        controller.pointerDown(pointer('pointerdown', { pointerType: 'mouse' }));
        controller.mouseDown(new MouseEvent('mousedown', { detail: 2, clientX: 110, clientY: 220, shiftKey: true }));
        expect(points[0]).toMatchObject({ clicks: 2, x: 50, y: 100, shift: true, extend: false, pointerType: 'mouse' });
        controller.pointerMove(pointer('pointermove', { pointerType: 'mouse', buttons: 1 }));
        expect(points.at(-1)?.extend).toBe(true);
        expect(element.setPointerCapture).toHaveBeenCalledWith(1);
    });
    it('distinguishes touch taps, double taps and synthetic mouse events', () => {
        for (let index = 0; index < 2; index++) {
            controller.pointerDown(pointer('pointerdown'));
            controller.pointerUp(pointer('pointerup'));
            now += 100;
        }
        expect(points.map((point) => point.clicks)).toEqual([1, 2]);
        controller.mouseDown(new MouseEvent('mousedown'));
        expect(points).toHaveLength(2);
    });
    it('selects a word on long press and cancels it when scrolling or unmounting', () => {
        controller.pointerDown(pointer('pointerdown'));
        vi.advanceTimersByTime(450);
        expect(points[0]).toMatchObject({ clicks: 2, held: true, pointerType: 'touch' });
        controller.pointerUp(pointer('pointerup'));
        expect(points).toHaveLength(1);
        controller.pointerDown(pointer('pointerdown'));
        controller.pointerMove(pointer('pointermove', { clientY: 250 }));
        vi.advanceTimersByTime(500);
        expect(points).toHaveLength(1);
        controller.pointerDown(pointer('pointerdown'));
        controller.pointerCancel();
        vi.advanceTimersByTime(500);
        expect(points).toHaveLength(1);
    });
    it('captures touch table selection and ignores secondary pointers', () => {
        selectingCells = true;
        controller.pointerDown(pointer('pointerdown'));
        controller.pointerMove(pointer('pointermove', { clientY: 250 }));
        expect(points.map((point) => point.extend)).toEqual([false, true]);
        controller.pointerDown(pointer('pointerdown', { pointerId: 2, isPrimary: false }));
        controller.pointerMove(pointer('pointermove', { clientY: 280 }));
        expect(points).toHaveLength(2);
    });
    it('handles pen input without waiting for a compatibility mouse event', () => {
        controller.pointerDown(pointer('pointerdown', { pointerType: 'pen' }));
        expect(points[0]).toMatchObject({ clicks: 1, pointerType: 'pen', extend: false });
    });
});
