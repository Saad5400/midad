import { findNode, type NativeDocument, type NativeNode } from './document.js';

export interface GridRow {
    node: NativeNode;
    parentId: string;
}
export interface GridCell {
    node: NativeNode;
    row: number;
    column: number;
    rowspan: number;
    colspan: number;
}
export interface TableGrid {
    table: NativeNode;
    rows: readonly GridRow[];
    cells: readonly GridCell[];
    columns: number;
}
export interface TableCellSelection {
    tableId: string;
    anchorId: string;
    focusId: string;
}
export interface TableRectangle {
    grid: TableGrid;
    cells: readonly GridCell[];
    top: number;
    left: number;
    bottom: number;
    right: number;
}

export function tableGrid(table: NativeNode): TableGrid {
    const rows = (table.children ?? []).flatMap((node) =>
        node.kind === 'tableRowGroup'
            ? (node.children ?? []).map((row) => ({ node: row, parentId: node.id }))
            : [{ node, parentId: table.id }],
    );
    const occupied: boolean[][] = rows.map(() => []),
        cells: GridCell[] = [];
    let columns = 0;
    rows.forEach(({ node }, row) => {
        let column = 0;
        for (const cell of node.children ?? []) {
            if (cell.attributes?.rmMergedTo) continue;
            while (occupied[row][column]) column++;
            const span = (key: 'colspan' | 'rowspan'): number => {
                const value = Number(
                    cell.attributes?.[
                        cell.attributes?.rmMergeOrigin ? (key === 'colspan' ? 'rmColspan' : 'rmRowspan') : key
                    ] ?? 1,
                );
                return Number.isFinite(value)
                    ? Math.max(1, Math.min(key === 'colspan' ? 100 : rows.length - row, Math.floor(value)))
                    : 1;
            };
            const colspan = span('colspan'),
                rowspan = span('rowspan');
            cells.push({ node: cell, row, column, colspan, rowspan });
            for (let y = row; y < row + rowspan; y++)
                for (let x = column; x < column + colspan; x++) occupied[y][x] = true;
            column += colspan;
            columns = Math.max(columns, column);
        }
    });
    return { table, rows, cells, columns };
}

export function tableRectangle(document: NativeDocument, selection: TableCellSelection): TableRectangle | undefined {
    const table = findNode(document, selection.tableId);
    if (table?.kind !== 'table') return;
    const grid = tableGrid(table),
        anchor = grid.cells.find((cell) => cell.node.id === selection.anchorId),
        focus = grid.cells.find((cell) => cell.node.id === selection.focusId);
    if (!anchor || !focus) return;
    let top = Math.min(anchor.row, focus.row),
        left = Math.min(anchor.column, focus.column),
        bottom = Math.max(anchor.row + anchor.rowspan, focus.row + focus.rowspan),
        right = Math.max(anchor.column + anchor.colspan, focus.column + focus.colspan);
    let cells: GridCell[];
    for (;;) {
        cells = grid.cells.filter(
            (cell) =>
                cell.row < bottom &&
                cell.row + cell.rowspan > top &&
                cell.column < right &&
                cell.column + cell.colspan > left,
        );
        const bounds = [top, left, bottom, right];
        for (const cell of cells) {
            top = Math.min(top, cell.row);
            left = Math.min(left, cell.column);
            bottom = Math.max(bottom, cell.row + cell.rowspan);
            right = Math.max(right, cell.column + cell.colspan);
        }
        if ([top, left, bottom, right].every((value, index) => value === bounds[index])) break;
    }
    const covered = new Set<string>();
    for (const cell of cells)
        for (let y = cell.row; y < cell.row + cell.rowspan; y++)
            for (let x = cell.column; x < cell.column + cell.colspan; x++) covered.add(`${y}:${x}`);
    if (covered.size !== (bottom - top) * (right - left)) return;
    return { grid, cells, top, left, bottom, right };
}

export function columnWeights(grid: TableGrid): number[] {
    const sizes =
        typeof grid.table.attributes?.columnSize === 'string'
            ? grid.table.attributes.columnSize.split(',').map(Number)
            : [];
    return sizes.length === grid.columns && sizes.every((size) => Number.isFinite(size) && size > 0)
        ? sizes
        : Array.from({ length: grid.columns }, () => 1);
}
