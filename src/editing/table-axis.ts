import { copyJson, findNode, type Attributes, type NativeDocument, type NativeNode } from '../document/model.js';
import { color } from '../typography/style.js';
import type { StructureResult } from './lists.js';
import { columnWeights, tableGrid, type GridCell, type TableCellSelection, type TableGrid } from './table-grid.js';
import { applyTableCommand, rebuild, tableResult } from './table-structure.js';
import { allocator, identity, update } from './text.js';

export type TableAxis = 'row' | 'column';
export type TableAxisCommand =
    | 'insertBefore'
    | 'insertAfter'
    | 'delete'
    | 'duplicate'
    | 'moveBefore'
    | 'moveAfter'
    | 'header';

function gridFor(document: NativeDocument, tableId: string): TableGrid {
    const node = findNode(document, tableId);
    if (node?.kind !== 'table') throw new Error('The table no longer exists');
    return tableGrid(node);
}
const start = (cell: GridCell, axis: TableAxis) => (axis === 'row' ? cell.row : cell.column);
const span = (cell: GridCell, axis: TableAxis) => (axis === 'row' ? cell.rowspan : cell.colspan);
const count = (grid: TableGrid, axis: TableAxis) => (axis === 'row' ? grid.rows.length : grid.columns);

export function tableAxisRange(grid: TableGrid, axis: TableAxis, index: number): { from: number; to: number } {
    if (axis !== 'row' && axis !== 'column') throw new Error('Invalid table axis');
    if (!Number.isInteger(index) || index < 0 || index >= count(grid, axis)) throw new Error('Invalid table axis');
    let from = index,
        to = index + 1;
    while (true) {
        const previous = [from, to];
        for (const cell of grid.cells) {
            const at = start(cell, axis),
                end = at + span(cell, axis);
            if (at < to && end > from) {
                from = Math.min(from, at);
                to = Math.max(to, end);
            }
        }
        if (from === previous[0] && to === previous[1]) return { from, to };
    }
}

export function tableAxisSelection(
    document: NativeDocument,
    tableId: string,
    axis: TableAxis,
    index: number,
): TableCellSelection | null {
    const grid = gridFor(document, tableId);
    tableAxisRange(grid, axis, index);
    const cells = grid.cells.filter(
        (cell) => start(cell, axis) <= index && start(cell, axis) + span(cell, axis) > index,
    );
    return cells.length ? { tableId, anchorId: cells[0].node.id, focusId: cells.at(-1)!.node.id } : null;
}

export function canMoveTableAxis(grid: TableGrid, axis: TableAxis, index: number, direction: -1 | 1): boolean {
    if (grid.table.attributes?.locked === true) return false;
    const range = tableAxisRange(grid, axis, index);
    return direction === -1 ? range.from > 0 : range.to < count(grid, axis);
}

export function tableAxisCommand(
    document: NativeDocument,
    tableId: string,
    axis: TableAxis,
    index: number,
    command: TableAxisCommand,
): StructureResult | null {
    if (!['insertBefore', 'insertAfter', 'delete', 'duplicate', 'moveBefore', 'moveAfter', 'header'].includes(command))
        throw new Error('Invalid table axis command');
    const grid = gridFor(document, tableId),
        range = tableAxisRange(grid, axis, index);
    if (grid.table.attributes?.locked === true) return null;
    const selected = grid.cells.filter(
        (cell) => start(cell, axis) <= index && start(cell, axis) + span(cell, axis) > index,
    );
    if (!selected.length) return null;
    if (command === 'insertBefore' || command === 'insertAfter' || command === 'delete') {
        const cell = {
            ...selected[0],
            ...(axis === 'row' ? { row: index, rowspan: 1 } : { column: index, colspan: 1 }),
        };
        const kind =
            axis === 'row'
                ? command === 'delete'
                    ? 'deleteRow'
                    : command === 'insertBefore'
                      ? 'rowBefore'
                      : 'rowAfter'
                : command === 'delete'
                  ? 'deleteColumn'
                  : command === 'insertBefore'
                    ? 'columnBefore'
                    : 'columnAfter';
        return applyTableCommand(document, grid, cell, kind);
    }
    if (command === 'header') {
        const targets = new Set(selected.map((cell) => cell.node.id));
        const header = selected.some((cell) => cell.node.kind !== 'tableHeader');
        return tableResult(
            update(document, grid.table, [
                rebuild(
                    grid,
                    grid.rows,
                    grid.cells.map((cell) =>
                        targets.has(cell.node.id)
                            ? {
                                  ...cell,
                                  node: Object.freeze({ ...cell.node, kind: header ? 'tableHeader' : 'tableCell' }),
                              }
                            : cell,
                    ),
                ),
            ]),
            selected[0].node.id,
            document.revision,
        );
    }
    const length = range.to - range.from;
    if (command === 'duplicate') {
        const nextId = allocator(document);
        const clone = (node: NativeNode): NativeNode =>
            identity(
                {
                    ...node,
                    ...(node.attributes ? { attributes: copyJson(node.attributes) as Attributes } : {}),
                    ...(node.children ? { children: Object.freeze(node.children.map(clone)) } : {}),
                },
                nextId(),
            );
        const cells = grid.cells.map((cell) =>
            start(cell, axis) >= range.to ? { ...cell, [axis]: start(cell, axis) + length } : cell,
        );
        const copied = grid.cells
            .filter((cell) => start(cell, axis) >= range.from && start(cell, axis) < range.to)
            .map((cell) => ({ ...cell, [axis]: start(cell, axis) + length, node: clone(cell.node) }));
        const rows = [...grid.rows],
            weights = columnWeights(grid);
        if (axis === 'row')
            rows.splice(
                range.to,
                0,
                ...grid.rows.slice(range.from, range.to).map((row) => ({
                    node: clone({ ...row.node, children: Object.freeze([]) }),
                    parentId: grid.rows[range.to - 1].parentId,
                })),
            );
        else weights.splice(range.to, 0, ...weights.slice(range.from, range.to));
        return tableResult(
            update(document, grid.table, [rebuild(grid, rows, [...cells, ...copied], weights.join(','))]),
            copied[0].node.id,
            document.revision,
        );
    }
    const direction = command === 'moveBefore' ? -1 : 1;
    if (!canMoveTableAxis(grid, axis, index, direction)) return null;
    const target = tableAxisRange(grid, axis, direction === -1 ? range.from - 1 : range.to);
    const first = direction === -1 ? target : range,
        second = direction === -1 ? range : target;
    const indices = Array.from({ length: count(grid, axis) }, (_, index) => index);
    const order = [
        ...indices.slice(0, first.from),
        ...indices.slice(second.from, second.to),
        ...indices.slice(first.from, first.to),
        ...indices.slice(second.to),
    ];
    const positions = new Map(order.map((before, after) => [before, after]));
    const rows =
        axis === 'row'
            ? order.map((before, after) => ({ ...grid.rows[before], parentId: grid.rows[after].parentId }))
            : grid.rows;
    const weights = columnWeights(grid);
    const cells = grid.cells.map((cell) => ({ ...cell, [axis]: positions.get(start(cell, axis))! }));
    return tableResult(
        update(document, grid.table, [
            rebuild(grid, rows, cells, (axis === 'column' ? order.map((index) => weights[index]) : weights).join(',')),
        ]),
        selected[0].node.id,
        document.revision,
    );
}

export function deleteTableById(document: NativeDocument, tableId: string): StructureResult | null {
    const grid = gridFor(document, tableId);
    return grid.cells.length ? applyTableCommand(document, grid, grid.cells[0], 'deleteTable') : null;
}

export function setTableCellAttributes(
    document: NativeDocument,
    tableId: string,
    cellIds: readonly string[],
    patch: { backgroundColor?: string | null; verticalAlign?: 'top' | 'middle' | 'bottom' | null },
): NativeDocument {
    const grid = gridFor(document, tableId);
    const selected = new Set(cellIds);
    if (cellIds.some((id) => !grid.cells.some((cell) => cell.node.id === id)))
        throw new Error('The table cell no longer exists');
    if (patch.backgroundColor !== undefined) color(patch.backgroundColor);
    if (
        patch.verticalAlign !== undefined &&
        patch.verticalAlign !== null &&
        !['top', 'middle', 'bottom'].includes(patch.verticalAlign)
    )
        throw new Error('Invalid cell alignment');
    let changed = false;
    const cells = grid.cells.map((cell) => {
        if (!selected.has(cell.node.id)) return cell;
        const attributes = { ...cell.node.attributes };
        for (const [key, value] of Object.entries(patch)) {
            if (value === null) delete attributes[key];
            else if (value !== undefined) attributes[key] = value;
        }
        if (JSON.stringify(attributes) === JSON.stringify(cell.node.attributes ?? {})) return cell;
        changed = true;
        return { ...cell, node: Object.freeze({ ...cell.node, attributes: Object.freeze(attributes) }) };
    });
    return changed ? update(document, grid.table, [rebuild(grid, grid.rows, cells)]) : document;
}

export function setTableAttributes(
    document: NativeDocument,
    tableId: string,
    patch: { locked?: boolean; borderColor?: string | null },
): NativeDocument {
    const { table } = gridFor(document, tableId);
    if (patch.locked !== undefined && typeof patch.locked !== 'boolean') throw new Error('Invalid table lock');
    const attributes = { ...table.attributes };
    if (patch.locked !== undefined) attributes.locked = patch.locked;
    if (patch.borderColor !== undefined) {
        if (table.attributes?.locked === true) throw new Error('The table structure is locked');
        color(patch.borderColor);
        if (patch.borderColor === null) delete attributes.borderColor;
        else attributes.borderColor = patch.borderColor;
    }
    if (JSON.stringify(attributes) === JSON.stringify(table.attributes ?? {})) return document;
    return update(document, table, [Object.freeze({ ...table, attributes: Object.freeze(attributes) })]);
}
