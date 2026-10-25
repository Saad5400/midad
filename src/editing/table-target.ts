import { findNode, type NativeDocument } from '../document/model.js';
import { tableGrid } from './table-grid.js';
export interface TableTarget {
    tableId: string;
    cellId: string;
    rowId?: string;
}

export function resolveTableTarget(document: NativeDocument, target: TableTarget) {
    const table = findNode(document, target.tableId);
    if (table?.kind !== 'table') throw new Error('The table no longer exists');
    const grid = tableGrid(table);
    const cell = grid.cells.find((cell) => cell.node.id === target.cellId);
    const rowIndex = target.rowId ? grid.rows.findIndex((row) => row.node.id === target.rowId) : cell?.row;
    if (!cell || rowIndex === undefined || rowIndex < 0) throw new Error('The table selection changed');
    return { grid, cell, rowIndex, colIndex: cell.column };
}
