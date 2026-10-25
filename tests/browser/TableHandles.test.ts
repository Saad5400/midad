import { tableHandleBoxes } from '@saad5400/midad/browser/view';
import { expect, it } from 'vitest';

const options = {
    table: { left: 100, top: 100, width: 500, height: 1000 },
    row: { left: 100, top: 100, width: 500, height: 1000 },
    cell: { left: 100, top: 100, width: 250, height: 1000 },
    viewport: { left: 0, top: 150, right: 800, bottom: 750 },
    rtl: false,
    lastRow: true,
    lastColumn: true,
};
it('matches the original compact grips while clamping long rows to the visible viewport', () => {
    const boxes = tableHandleBoxes(options);
    expect(boxes.row).toEqual({ left: 84, top: 390, width: 12, height: 120 });
    expect(boxes.table).toEqual({ left: 80, top: 80, width: 16, height: 16 });
    expect(boxes.addColumn?.height).toBe(200);
    expect(boxes.addRow?.width).toBe(200);
});
it('mirrors side grips for RTL without reversing logical row positions', () => {
    const boxes = tableHandleBoxes({ ...options, rtl: true });
    expect(boxes.row.left).toBe(604);
    expect(boxes.addColumn?.left).toBe(84);
    expect(boxes.column.left).toBe(tableHandleBoxes(options).column.left);
});
it('keeps an expanded cell grip centered on the selection edge', () => {
    const selection = { left: 100, top: 200, width: 250, height: 60 };
    const resting = tableHandleBoxes({ ...options, selection });
    const expanded = tableHandleBoxes({ ...options, selection, expanded: true });
    expect(resting.cell!.left + resting.cell!.width / 2).toBe(expanded.cell!.left + expanded.cell!.width / 2);
    expect(resting.cell!.top + resting.cell!.height / 2).toBe(230);
});
