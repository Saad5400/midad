import type { GridRow } from '../editing/table-grid.js';
import { point } from '../typography/metrics.js';
import type { SceneTableRow } from './scene.js';

export function tableRowFragments(
    tableId: string,
    rows: readonly GridRow[],
    offsets: readonly number[],
    from: number,
    to: number,
    width: number,
    rowOffset = 0,
): SceneTableRow[] {
    let low = 0;
    let high = rows.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (offsets[middle + 1] <= from) low = middle + 1;
        else high = middle;
    }
    const fragments: SceneTableRow[] = [];
    for (let index = low; index < rows.length && offsets[index] < to; index++) {
        const row = rows[index];
        const top = Math.max(from, offsets[index]);
        const bottom = Math.min(to, offsets[index + 1]);
        if (bottom > top)
            fragments.push({
                tableId,
                rowId: row.node.id,
                rowIndex: rowOffset + index,
                x: 0,
                y: point(top - from),
                width,
                height: point(bottom - top),
                ends: bottom === offsets[index + 1],
            });
    }
    return fragments;
}
