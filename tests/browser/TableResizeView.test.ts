import { TableResizeView, type TableResizeFrame } from '@saad5400/midad/browser/view';
import type { SceneCell, SceneTableRow } from '@saad5400/midad/layout';
import { afterEach, expect, it, vi } from 'vitest';

const views: TableResizeView[] = [];
afterEach(() => {
    views.splice(0).forEach((view) => view.dispose());
    document.body.replaceChildren();
});
function open(rtl = false, scale = 1) {
    const host = document.createElement('div');
    host.style.position = 'relative';
    document.body.append(host);
    const cells: SceneCell[] = [0, 1].map((index) => ({
        tableId: 'table',
        cellId: `cell-${index}`,
        tableX: 20,
        x: 20 + index * 100,
        y: 40,
        width: 100,
        height: 48,
        direction: rtl ? 'rtl' : 'ltr',
        columnEdges: [0, 100, 200],
        minimumColumnWidths: [30, 40],
    }));
    const rows: SceneTableRow[] = [
        { tableId: 'table', rowId: 'row', rowIndex: 0, x: 20, y: 40, width: 200, height: 48, ends: true },
    ];
    const frame: TableResizeFrame = {
        cells,
        rows,
        rowHeights: {},
        tableId: 'table',
        scale,
        labels: { resizeColumn: 'Column {column}', resizeRow: 'Row {row}' },
    };
    const resize = vi.fn(),
        resizeRow = vi.fn(),
        view = new TableResizeView(host, frame, { resize, resizeRow });
    views.push(view);
    const column = host.querySelector<HTMLElement>('.native-column-handle')!,
        row = host.querySelector<HTMLElement>('.native-row-handle')!;
    for (const element of [column, row]) {
        let pointer: number | undefined;
        element.setPointerCapture = vi.fn((id) => {
            pointer = id;
        });
        element.hasPointerCapture = vi.fn((id) => pointer === id);
        element.releasePointerCapture = vi.fn((id) => {
            if (pointer === id) pointer = undefined;
        });
    }
    return { host, frame, resize, resizeRow, view, column, row };
}
function pointer(element: HTMLElement, type: string, options: PointerEventInit = {}) {
    const event = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        isPrimary: true,
        pointerId: 1,
        button: 0,
        ...options,
    });
    element.dispatchEvent(event);
    return event;
}
function key(element: HTMLElement, key: string, options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
    element.dispatchEvent(event);
    return event;
}
it('mounts usable labeled controls and default visuals without a framework or application CSS', () => {
    const { host, column, row } = open();
    expect(host.querySelector('style')?.textContent).toContain('touch-action:none');
    expect(column.getAttribute('aria-orientation')).toBe('vertical');
    expect(column.getAttribute('aria-label')).toBe('Column 1');
    expect(column.getAttribute('aria-valuemin')).toBe('15');
    expect(column.getAttribute('aria-valuemax')).toBe('80');
    expect(column.getAttribute('aria-valuenow')).toBe('50');
    expect(column.style.left).toBe('112px');
    expect(row.getAttribute('aria-label')).toBe('Row 1');
    expect(row.getAttribute('aria-valuenow')).toBe('64');
    expect(row.style.top).toBe('80px');
});
it.each([false, true])('commits scaled column mouse/pen/touch movement once with RTL=%s', (rtl) => {
    const { view, frame, column, resize } = open(rtl, 0.5);
    for (const pointerType of ['mouse', 'pen', 'touch']) {
        pointer(column, 'pointerdown', { clientX: 100, pointerType });
        expect(document.activeElement).toBe(column);
        expect(column.classList.contains('is-dragging')).toBe(true);
        pointer(column, 'pointermove', { clientX: 115, pointerType });
        expect(resize).toHaveBeenCalledTimes(['mouse', 'pen', 'touch'].indexOf(pointerType));
        pointer(column, 'pointerup', { clientX: 115, pointerType });
        expect(resize).toHaveBeenLastCalledWith('table', 1, rtl ? -30 : 30, 200);
        pointer(column, 'pointerup', { clientX: 115, pointerType });
        expect(column.releasePointerCapture).toHaveBeenCalledWith(1);
        view.update(frame);
    }
    expect(resize).toHaveBeenCalledTimes(3);
});
it('respects both columns’ content minimums for pointer and keyboard adjustments', () => {
    const { column, resize } = open();
    pointer(column, 'pointerdown', { clientX: 0 });
    pointer(column, 'pointerup', { clientX: 1000 });
    expect(resize).toHaveBeenLastCalledWith('table', 1, 60, 200);
    key(column, 'Home');
    expect(resize).toHaveBeenLastCalledWith('table', 1, -70, 200);
    key(column, 'ArrowLeft', { shiftKey: true });
    expect(resize).toHaveBeenLastCalledWith('table', 1, -10, 200);
    expect(key(column, 'ArrowRight').defaultPrevented).toBe(true);
    expect(resize).toHaveBeenLastCalledWith('table', 1, 2, 200);
});
it('uses physical left/right keys correctly in RTL', () => {
    const { column, resize } = open(true);
    key(column, 'ArrowLeft');
    expect(resize).toHaveBeenLastCalledWith('table', 1, 2, 200);
    key(column, 'ArrowRight');
    expect(resize).toHaveBeenLastCalledWith('table', 1, -2, 200);
});
it('commits row heights in scene units, bounds them and resets automatic height with Home', () => {
    const { row, resizeRow } = open(false, 0.5);
    pointer(row, 'pointerdown', { clientY: 0 });
    pointer(row, 'pointerup', { clientY: 10 });
    expect(resizeRow).toHaveBeenLastCalledWith('table', 'row', 68);
    key(row, 'ArrowDown', { shiftKey: true });
    expect(resizeRow).toHaveBeenLastCalledWith('table', 'row', 58);
    key(row, 'Home');
    expect(resizeRow).toHaveBeenLastCalledWith('table', 'row', null);
    pointer(row, 'pointerdown', { clientY: 0 });
    pointer(row, 'pointerup', { clientY: -1000 });
    expect(resizeRow).toHaveBeenLastCalledWith('table', 'row', 12);
    pointer(row, 'pointerdown', { clientY: 0 });
    pointer(row, 'pointerup', { clientY: 100000 });
    expect(resizeRow).toHaveBeenLastCalledWith('table', 'row', 75000);
});
it.each(['pointercancel', 'lostpointercapture', 'Escape'])('cancels both row and column movement on %s', (reason) => {
    const { row, column, resize, resizeRow } = open();
    for (const element of [row, column]) {
        pointer(element, 'pointerdown', { clientX: 10, clientY: 10 });
        pointer(element, 'pointermove', { clientX: 30, clientY: 30 });
        if (reason === 'Escape') expect(key(element, 'Escape').defaultPrevented).toBe(true);
        else pointer(element, reason);
        expect(element.classList.contains('is-dragging')).toBe(false);
        pointer(element, 'pointerup', { clientX: 30, clientY: 30 });
    }
    expect(resize).not.toHaveBeenCalled();
    expect(resizeRow).not.toHaveBeenCalled();
});
it.each(['cells', 'rows', 'rowHeights', 'tableId', 'scale', 'disabled'] as const)(
    'cancels stale gestures when %s changes',
    (setting) => {
        const { view, frame, row, resizeRow } = open();
        pointer(row, 'pointerdown', { clientY: 10 });
        pointer(row, 'pointermove', { clientY: 30 });
        const changes = {
            cells: [...frame.cells],
            rows: [...frame.rows],
            rowHeights: { row: 70 },
            tableId: 'other',
            scale: 2,
            disabled: true,
        };
        view.update({ ...frame, [setting]: changes[setting] });
        pointer(row, 'pointerup', { clientY: 30 });
        expect(resizeRow).not.toHaveBeenCalled();
        expect(row.releasePointerCapture).toHaveBeenCalledWith(1);
    },
);
it('retains focused controls through accepted model updates and locale changes', () => {
    const { view, frame, row, column } = open();
    column.focus();
    view.update({
        ...frame,
        cells: [...frame.cells],
        labels: { resizeColumn: 'عمود {column}', resizeRow: 'صف {row}' },
    });
    expect(document.activeElement).toBe(column);
    expect(column.getAttribute('aria-label')).toBe('عمود 1');
    view.update({ ...frame, rowHeights: { row: 60 } });
    expect(row.getAttribute('aria-valuenow')).toBe('80');
});
it('ignores unrelated pointers, non-primary buttons and composing keyboard events', () => {
    const { column, resize } = open();
    pointer(column, 'pointerdown', { isPrimary: false });
    pointer(column, 'pointerup', { clientX: 50 });
    pointer(column, 'pointerdown', { button: 2 });
    pointer(column, 'pointerup', { clientX: 50 });
    pointer(column, 'pointerdown', { clientX: 0 });
    pointer(column, 'pointermove', { pointerId: 2, clientX: 40 });
    pointer(column, 'pointerup', { pointerId: 2, clientX: 40 });
    pointer(column, 'pointercancel');
    key(column, 'ArrowLeft', { isComposing: true });
    expect(resize).not.toHaveBeenCalled();
});
it('only exposes a row end on its ending physical page', () => {
    const { view, frame, host } = open();
    view.update({ ...frame, rows: frame.rows.map((row) => ({ ...row, ends: false })) });
    expect(host.querySelector('.native-row-handle')).toBeNull();
    expect(host.querySelector('.native-column-handle')).not.toBeNull();
});
it('lets a keyboard command replace an unfinished pointer drag without a later second commit', () => {
    const { row, resizeRow } = open();
    pointer(row, 'pointerdown', { clientY: 0 });
    pointer(row, 'pointermove', { clientY: 40 });
    key(row, 'ArrowDown');
    pointer(row, 'pointerup', { clientY: 40 });
    expect(resizeRow).toHaveBeenCalledExactlyOnceWith('table', 'row', 50);
});
it('removes invalid and disposed views without late commands or leaked capture', () => {
    const { view, frame, row, column, host, resize, resizeRow } = open();
    pointer(row, 'pointerdown', { clientY: 0 });
    view.update({ ...frame, scale: 0 });
    expect(host.querySelector('[role=separator]')).toBeNull();
    key(column, 'ArrowLeft');
    pointer(row, 'pointerdown', { clientY: 0 });
    pointer(row, 'pointerup', { clientY: 100 });
    expect(resize).not.toHaveBeenCalled();
    expect(resizeRow).not.toHaveBeenCalled();
    view.update(frame);
    view.dispose();
    view.dispose();
    pointer(row, 'pointerup', { clientY: 100 });
    key(column, 'ArrowLeft');
    expect(host.childElementCount).toBe(0);
    expect(resize).not.toHaveBeenCalled();
    expect(resizeRow).not.toHaveBeenCalled();
});
