import type { NativeDocument, NativeNode } from '../document/model.js';
import { point } from '../typography/metrics.js';
import { tableGrid } from './table-grid.js';
import { nodePath, update } from './text.js';

export function tableRowMinimum(row: NativeNode): number {
    const height = row.attributes?.rowHeight;
    if (height === undefined || height === null) return 12;
    if (typeof height !== 'number' || !Number.isFinite(height) || height < 0 || height > 100000)
        throw new Error('Invalid table row height');
    return Math.max(12, point(height * 0.75));
}

export function setTableRowHeight(
    document: NativeDocument,
    tableId: string,
    rowId: string,
    heightPx: number | null,
): NativeDocument {
    const table = nodePath(document, tableId).at(-1);
    if (table?.kind !== 'table') throw new Error('The table no longer exists');
    if (table.attributes?.locked === true) throw new Error('The table structure is locked');
    const row = tableGrid(table).rows.find((row) => row.node.id === rowId)?.node;
    if (!row) throw new Error('The table row no longer exists');
    const attributes = { ...row.attributes };
    if (heightPx === null) delete attributes.rowHeight;
    else attributes.rowHeight = heightPx;
    const next = Object.freeze({ ...row, attributes: Object.freeze(attributes) });
    tableRowMinimum(next);
    if (next.attributes.rowHeight === row.attributes?.rowHeight) return document;
    return update(document, row, [next]);
}
