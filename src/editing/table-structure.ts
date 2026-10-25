import { findNode, type Attributes, type NativeDocument, type NativeNode } from '../document/model.js';
import type { StructureResult } from './lists.js';
import { columnWeights, type GridCell, type GridRow, type TableGrid } from './table-grid.js';
import { allocator, identity, textBlocks, update, type TextCaret } from './text.js';
const withChildren = (node: NativeNode, children: readonly NativeNode[]): NativeNode =>
    node.children?.length === children.length && node.children.every((child, index) => child === children[index])
        ? node
        : Object.freeze({ ...node, children: Object.freeze(children) });
export type TableCommand =
    | 'rowBefore'
    | 'rowAfter'
    | 'deleteRow'
    | 'columnBefore'
    | 'columnAfter'
    | 'deleteColumn'
    | 'deleteTable'
    | 'headerRow';
function canonicalCell(cell: GridCell): NativeNode {
    if (
        cell.node.attributes?.colspan === cell.colspan &&
        cell.node.attributes?.rowspan === cell.rowspan &&
        !['rmMergeOrigin', 'rmMergedTo', 'rmHideMode', 'rmColspan', 'rmRowspan'].some(
            (key) => key in cell.node.attributes!,
        )
    )
        return cell.node;
    const attributes: Attributes = Object.freeze({
        ...Object.fromEntries(
            Object.entries(cell.node.attributes ?? {}).filter(
                ([key]) => !['rmMergeOrigin', 'rmMergedTo', 'rmHideMode', 'rmColspan', 'rmRowspan'].includes(key),
            ),
        ),
        colspan: cell.colspan,
        rowspan: cell.rowspan,
    });
    return Object.freeze({ ...cell.node, attributes });
}

export function rebuild(
    grid: TableGrid,
    rows: readonly GridRow[],
    cells: readonly GridCell[],
    columnSize?: string,
): NativeNode {
    const built = rows.map((row, index) => ({
        ...row,
        node: withChildren(
            row.node,
            cells
                .filter((cell) => cell.row === index)
                .sort((a, b) => a.column - b.column)
                .map(canonicalCell),
        ),
    }));
    const groups = new Map(
        (grid.table.children ?? []).filter((node) => node.kind === 'tableRowGroup').map((node) => [node.id, node]),
    );
    const emitted = new Set<string>(),
        children: NativeNode[] = [];
    for (const row of built) {
        const group = groups.get(row.parentId);
        if (!group) children.push(row.node);
        else if (!emitted.has(group.id)) {
            emitted.add(group.id);
            children.push(
                withChildren(
                    group,
                    built.filter((candidate) => candidate.parentId === group.id).map((candidate) => candidate.node),
                ),
            );
        }
    }
    return Object.freeze({
        ...grid.table,
        ...(columnSize === undefined ? {} : { attributes: Object.freeze({ ...grid.table.attributes, columnSize }) }),
        children: Object.freeze(children),
    });
}

export function blankCell(nextId: () => string, template?: NativeNode, header = false): NativeNode {
    const source = template ? textBlocks(template)[0] : undefined;
    const paragraph = identity(
        {
            id: '',
            kind: 'paragraph',
            ...(source?.attributes ? { attributes: source.attributes } : {}),
            children: Object.freeze([]),
        },
        nextId(),
    );
    const attributes = Object.freeze(
        Object.fromEntries(
            Object.entries(template?.attributes ?? {}).filter(
                ([key]) => !['id', 'colspan', 'rowspan', 'colwidth'].includes(key) && !key.startsWith('rm'),
            ),
        ),
    );
    return Object.freeze({
        id: nextId(),
        kind: header ? 'tableHeader' : 'tableCell',
        attributes,
        children: Object.freeze([paragraph]),
    });
}

export function cellCaret(cell: NativeNode): TextCaret {
    const block = textBlocks(cell)[0];
    if (!block) throw new Error('The table cell has no editable paragraph');
    return { blockId: block.id, offset: 0 };
}

export function tableResult(document: NativeDocument, cellId: string, baseRevision: number): StructureResult {
    const cell = findNode(document, cellId);
    if (!cell) throw new Error('The table cell no longer exists');
    const block = textBlocks(cell)[0];
    if (block) return { document, caret: { blockId: block.id, offset: 0 } };
    const paragraph = Object.freeze({ id: allocator(document)(), kind: 'paragraph', children: Object.freeze([]) });
    const next = update(document, cell, [withChildren(cell, [...(cell.children ?? []), paragraph])]);
    return {
        document: Object.freeze({ ...next, revision: baseRevision + 1 }),
        caret: { blockId: paragraph.id, offset: 0 },
    };
}

export function applyTableCommand(
    document: NativeDocument,
    grid: TableGrid,
    cell: GridCell,
    command: TableCommand,
): StructureResult | null {
    if (grid.table.attributes?.locked === true) return null;
    const nextId = allocator(document);
    if (
        command === 'deleteTable' ||
        (command === 'deleteRow' && grid.rows.length === 1) ||
        (command === 'deleteColumn' && grid.columns === 1)
    ) {
        const paragraph = identity(
            {
                id: '',
                kind: 'paragraph',
                attributes: Object.freeze({ dir: grid.table.attributes?.dir ?? 'rtl' }),
                children: Object.freeze([]),
            },
            nextId(),
        );
        return { document: update(document, grid.table, [paragraph]), caret: { blockId: paragraph.id, offset: 0 } };
    }
    const rows = [...grid.rows],
        cells = grid.cells.map((cell) => ({ ...cell }));
    let targetRow = cell.row,
        targetColumn = cell.column;
    const weights = columnWeights(grid);
    if (command === 'rowBefore' || command === 'rowAfter') {
        const at = command === 'rowBefore' ? cell.row : cell.row + cell.rowspan;
        targetRow = at;
        rows.splice(at, 0, {
            node: identity(withChildren(grid.rows[cell.row].node, []), nextId()),
            parentId: grid.rows[cell.row].parentId,
        });
        for (const entry of cells) {
            if (entry.row < at && entry.row + entry.rowspan > at) entry.rowspan++;
            else if (entry.row >= at) entry.row++;
        }
        for (let column = 0; column < grid.columns; column++) {
            if (
                cells.some(
                    (entry) =>
                        entry.row <= at &&
                        entry.row + entry.rowspan > at &&
                        entry.column <= column &&
                        entry.column + entry.colspan > column,
                )
            )
                continue;
            const template = grid.cells.find(
                (entry) =>
                    entry.row <= cell.row &&
                    entry.row + entry.rowspan > cell.row &&
                    entry.column <= column &&
                    entry.column + entry.colspan > column,
            )?.node;
            cells.push({
                node: blankCell(nextId, template, command === 'rowBefore' && template?.kind === 'tableHeader'),
                row: at,
                column,
                rowspan: 1,
                colspan: 1,
            });
        }
    } else if (command === 'deleteRow') {
        rows.splice(cell.row, 1);
        for (let index = cells.length - 1; index >= 0; index--) {
            const entry = cells[index];
            if (entry.row === cell.row && entry.rowspan === 1) cells.splice(index, 1);
            else if (entry.row <= cell.row && entry.row + entry.rowspan > cell.row) entry.rowspan--;
            else if (entry.row > cell.row) entry.row--;
        }
        targetRow = Math.min(cell.row, rows.length - 1);
    } else if (command === 'columnBefore' || command === 'columnAfter') {
        const at = command === 'columnBefore' ? cell.column : cell.column + cell.colspan;
        targetColumn = at;
        weights.splice(at, 0, weights[Math.min(at, weights.length - 1)]);
        for (const entry of cells) {
            if (entry.column < at && entry.column + entry.colspan > at) entry.colspan++;
            else if (entry.column >= at) entry.column++;
        }
        for (let row = 0; row < rows.length; row++) {
            if (
                cells.some(
                    (entry) =>
                        entry.column <= at &&
                        entry.column + entry.colspan > at &&
                        entry.row <= row &&
                        entry.row + entry.rowspan > row,
                )
            )
                continue;
            const template = grid.cells.find(
                (entry) =>
                    entry.row <= row &&
                    entry.row + entry.rowspan > row &&
                    entry.column <= cell.column &&
                    entry.column + entry.colspan > cell.column,
            )?.node;
            cells.push({
                node: blankCell(nextId, template, template?.kind === 'tableHeader'),
                row,
                column: at,
                rowspan: 1,
                colspan: 1,
            });
        }
    } else if (command === 'deleteColumn') {
        weights.splice(cell.column, 1);
        for (let index = cells.length - 1; index >= 0; index--) {
            const entry = cells[index];
            if (entry.column === cell.column && entry.colspan === 1) cells.splice(index, 1);
            else if (entry.column <= cell.column && entry.column + entry.colspan > cell.column) entry.colspan--;
            else if (entry.column > cell.column) entry.column--;
        }
        targetColumn = Math.min(cell.column, weights.length - 1);
    } else if (command === 'headerRow') {
        const entries = cells.filter((entry) => entry.row === cell.row);
        const header = entries.some((entry) => entry.node.kind !== 'tableHeader');
        for (const entry of entries)
            entry.node = Object.freeze({ ...entry.node, kind: header ? 'tableHeader' : 'tableCell' });
    }
    const next = rebuild(grid, rows, cells, weights.join(','));
    const target =
        cells.find(
            (entry) =>
                entry.row <= targetRow &&
                entry.row + entry.rowspan > targetRow &&
                entry.column <= targetColumn &&
                entry.column + entry.colspan > targetColumn,
        ) ?? cells[0];
    return tableResult(update(document, grid.table, [next]), target.node.id, document.revision);
}
