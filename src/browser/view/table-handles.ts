import type { NativeDocument } from '../../document/model.js';
import type { NativeSelection } from '../../editing/selection.js';
import { tableRectangle } from '../../editing/table-grid.js';
import { resolveTableTarget, type TableTarget } from '../../editing/table-target.js';
import type { ScenePage } from '../../layout/scene.js';

export interface TableControlRect {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

export function tableControlFrame(options: {
    document: NativeDocument;
    page: ScenePage;
    target: TableTarget;
    bounds: TableControlRect;
    viewport: { left: number; top: number; right: number; bottom: number };
    selection: NativeSelection | null;
}) {
    const { document, page, target, bounds, viewport } = options;
    const model = resolveTableTarget(document, target);
    const cell = page.cells?.find((cell) => cell.tableId === target.tableId && cell.cellId === target.cellId);
    if (!cell || bounds.width <= 0 || bounds.height <= 0) return undefined;
    const sx = bounds.width / page.width,
        sy = bounds.height / page.height;
    const rect = (box: { x: number; y: number; width: number; height: number }): TableControlRect => ({
        left: bounds.left + box.x * sx,
        top: bounds.top + box.y * sy,
        width: box.width * sx,
        height: box.height * sy,
    });
    const cells = page.cells!.filter((cell) => cell.tableId === target.tableId);
    const table = rect({
        x: cell.tableX,
        y: Math.min(...cells.map((cell) => cell.y)),
        width: cell.columnEdges.at(-1)!,
        height: Math.max(...cells.map((cell) => cell.y + cell.height)) - Math.min(...cells.map((cell) => cell.y)),
    });
    if (
        table.top + table.height <= viewport.top ||
        table.top >= viewport.bottom ||
        table.left + table.width <= viewport.left ||
        table.left >= viewport.right
    )
        return undefined;
    const rowId = model.grid.rows[model.rowIndex].node.id;
    const row = page.tableRows?.find((row) => row.rowId === rowId) ?? cell;
    let selection: TableControlRect | undefined;
    const selected =
        options.selection?.cells?.tableId === target.tableId
            ? tableRectangle(document, options.selection.cells)
            : undefined;
    if (selected) {
        const ids = new Set(selected.cells.map((cell) => cell.node.id)),
            entries = cells.filter((cell) => ids.has(cell.cellId));
        if (entries.length)
            selection = rect({
                x: Math.min(...entries.map((cell) => cell.x)),
                y: Math.min(...entries.map((cell) => cell.y)),
                width:
                    Math.max(...entries.map((cell) => cell.x + cell.width)) -
                    Math.min(...entries.map((cell) => cell.x)),
                height:
                    Math.max(...entries.map((cell) => cell.y + cell.height)) -
                    Math.min(...entries.map((cell) => cell.y)),
            });
    }
    let gripRight = cell.direction !== 'rtl';
    if (selection && options.selection?.cells) {
        const head = cells.find((cell) => cell.cellId === options.selection!.cells!.focusId);
        if (head) {
            const middle = rect(head).left + rect(head).width / 2,
                center = selection.left + selection.width / 2;
            if (middle > center + 1) gripRight = true;
            else if (middle < center - 1) gripRight = false;
        }
    }
    return {
        table,
        row: rect(row),
        cell: rect(cell),
        viewport,
        selection,
        gripRight,
        rtl: cell.direction === 'rtl',
        lastRow: model.rowIndex === model.grid.rows.length - 1 && 'ends' in row && row.ends === true,
        lastColumn: model.cell.column + model.cell.colspan === model.grid.columns,
    };
}
export function tableHandleBoxes(options: {
    table: TableControlRect;
    row: TableControlRect;
    cell: TableControlRect;
    viewport: { left: number; top: number; right: number; bottom: number };
    rtl: boolean;
    lastRow: boolean;
    lastColumn: boolean;
    selection?: TableControlRect;
    gripRight?: boolean;
    expanded?: boolean;
}) {
    const { table, row, cell, viewport, rtl } = options;
    const span = (start: number, length: number, minimum: number, maximum: number, cap: number) => {
        const visibleStart = Math.max(start, minimum);
        const visible = Math.max(0, Math.min(start + length, maximum) - visibleStart);
        const size = Math.min(visible * 0.8, cap);
        return { start: visibleStart + (visible - size) / 2, size };
    };
    const horizontal = (left: number, top: number, width: number, cap = 120): TableControlRect => {
        const visible = span(left, width, viewport.left, viewport.right, cap);
        return { left: visible.start, top, width: visible.size, height: 12 };
    };
    const vertical = (left: number, top: number, height: number, cap = 120): TableControlRect => {
        const visible = span(top, height, viewport.top, viewport.bottom, cap);
        return { left, top: visible.start, width: 12, height: visible.size };
    };
    const selection = options.selection;
    const size = options.expanded ? 22 : 12;
    const gripRight = options.gripRight ?? !rtl;
    return {
        row: vertical(rtl ? table.left + table.width + 4 : table.left - 16, row.top, row.height),
        column: horizontal(cell.left, table.top - 16, cell.width),
        table: {
            left: rtl ? table.left + table.width + 4 : table.left - 20,
            top: table.top - 20,
            width: 16,
            height: 16,
        },
        addRow: options.lastRow ? horizontal(table.left, table.top + table.height + 4, table.width, 200) : undefined,
        addColumn: options.lastColumn
            ? vertical(rtl ? table.left - 16 : table.left + table.width + 4, table.top, table.height, 200)
            : undefined,
        cell: selection
            ? {
                  left: selection.left + (gripRight ? selection.width - 1 : 1) - size / 2,
                  top: selection.top + selection.height / 2 - size / 2,
                  width: size,
                  height: size,
              }
            : undefined,
    };
}
