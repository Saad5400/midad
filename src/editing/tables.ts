import { copyJson, type Attributes, type NativeDocument, type NativeNode } from '../document/model.js';
import { inheritedDirection } from '../typography/direction.js';
import type { StructureResult } from './lists.js';
import {
    allocator,
    blockText,
    identity,
    nodePath,
    replaceInlineText,
    sliceInlineContent,
    textBlocks,
    update,
    type TextCaret,
} from './text.js';

import {
    columnWeights,
    tableGrid,
    tableRectangle,
    type GridCell,
    type GridRow,
    type TableCellSelection,
    type TableGrid,
} from './table-grid.js';
export { tableGrid } from './table-grid.js';
export { setTableRowHeight } from './table-rows.js';

export type TableCommand =
    | 'rowBefore'
    | 'rowAfter'
    | 'deleteRow'
    | 'columnBefore'
    | 'columnAfter'
    | 'deleteColumn'
    | 'deleteTable'
    | 'headerRow';
const withChildren = (node: NativeNode, children: readonly NativeNode[]): NativeNode =>
    Object.freeze({ ...node, children: Object.freeze(children) });

export function tableContext(
    document: NativeDocument,
    blockId: string,
): { grid: TableGrid; cell: GridCell } | undefined {
    const path = nodePath(document, blockId),
        table = [...path].reverse().find((node) => node.kind === 'table');
    if (!table) return;
    const grid = tableGrid(table),
        cell = grid.cells.find((cell) => path.includes(cell.node));
    return cell ? { grid, cell } : undefined;
}

function canonicalCell(cell: GridCell): NativeNode {
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

function rebuild(
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

function blankCell(nextId: () => string, template?: NativeNode, header = false): NativeNode {
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

function cellCaret(cell: NativeNode): TextCaret {
    const block = textBlocks(cell)[0];
    if (!block) throw new Error('The table cell has no editable paragraph');
    return { blockId: block.id, offset: 0 };
}

export function insertTable(
    document: NativeDocument,
    caret: TextCaret,
    rowCount: number,
    columnCount: number,
    header: boolean,
): StructureResult {
    if (![rowCount, columnCount].every((value) => Number.isInteger(value) && value >= 1 && value <= 100))
        throw new Error('Table dimensions must be between 1 and 100');
    const path = nodePath(document, caret.blockId),
        block = path.at(-1);
    if (!block || !['paragraph', 'heading'].includes(block.kind))
        throw new Error('Choose a paragraph before inserting a table');
    replaceInlineText(document, {
        blockId: block.id,
        from: caret.offset,
        to: caret.offset,
        text: '',
        expectedRevision: document.revision,
    });
    const nextId = allocator(document);
    const content = Array.from({ length: rowCount }, (_, row) =>
        Object.freeze({
            id: nextId(),
            kind: 'tableRow',
            children: Object.freeze(
                Array.from({ length: columnCount }, () => blankCell(nextId, block, header && row === 0)),
            ),
        }),
    );
    const table = Object.freeze({
        id: nextId(),
        kind: 'table',
        attributes: Object.freeze({
            dir: path.reduce<'ltr' | 'rtl'>((direction, node) => inheritedDirection(node, direction), 'rtl'),
            columnSize: Array.from({ length: columnCount }, () => 1).join(','),
        }),
        children: Object.freeze(content),
    });
    const before = sliceInlineContent(block.children ?? [], 0, caret.offset),
        after = sliceInlineContent(block.children ?? [], caret.offset, Infinity);
    const keepBefore = before.length > 0 || path.at(-2)?.kind === 'listItem';
    const used = new Set(before.map((node) => node.id));
    const tail = identity(
        {
            ...block,
            kind: 'paragraph',
            children: Object.freeze(after.map((node) => (used.has(node.id) ? identity(node, nextId()) : node))),
        },
        keepBefore ? nextId() : block.id,
    );
    return {
        document: update(document, block, [...(keepBefore ? [withChildren(block, before)] : []), table, tail]),
        caret: cellCaret(content[0].children[0]),
    };
}

export function tableCommand(document: NativeDocument, blockId: string, command: TableCommand): StructureResult | null {
    const context = tableContext(document, blockId);
    if (!context) return null;
    const { grid, cell } = context,
        nextId = allocator(document);
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
    return { document: update(document, grid.table, [next]), caret: cellCaret(target.node) };
}

export function tabTable(document: NativeDocument, blockId: string, backward: boolean): StructureResult | null {
    const context = tableContext(document, blockId);
    if (!context) return null;
    const { grid, cell } = context,
        index = grid.cells.indexOf(cell);
    const target = grid.cells[index + (backward ? -1 : 1)];
    if (target) return { document, caret: cellCaret(target.node) };
    if (!backward) {
        const result = tableCommand(document, blockId, 'rowAfter')!;
        const next = tableContext(result.document, result.caret.blockId)!;
        const first = next.grid.cells.find(
            (entry) => entry.row <= next.cell.row && entry.row + entry.rowspan > next.cell.row && entry.column === 0,
        );
        return { ...result, caret: first ? cellCaret(first.node) : result.caret };
    }
    return { document, caret: cellCaret(cell.node) };
}

export function mergeTableCells(document: NativeDocument, selection: TableCellSelection): StructureResult | null {
    const rectangle = tableRectangle(document, selection);
    if (!rectangle || rectangle.cells.length < 2) return null;
    const { grid, cells, top, left, bottom, right } = rectangle;
    const origin = cells.find((cell) => cell.row === top && cell.column === left)!;
    const meaningful = cells.flatMap((cell) =>
        (cell.node.children ?? []).filter((node) => node.kind !== 'paragraph' || !!blockText(node)),
    );
    const children = meaningful.length ? meaningful : (origin.node.children ?? []);
    const merged = {
        ...origin,
        node: withChildren(origin.node, children),
        rowspan: bottom - top,
        colspan: right - left,
    };
    const selected = new Set(cells);
    const table = rebuild(grid, grid.rows, [...grid.cells.filter((cell) => !selected.has(cell)), merged]);
    return { document: update(document, grid.table, [table]), caret: cellCaret(merged.node) };
}

export function splitTableCell(document: NativeDocument, cellId: string): StructureResult | null {
    const context = tableContext(document, cellId);
    if (!context || (context.cell.rowspan === 1 && context.cell.colspan === 1)) return null;
    const { grid, cell } = context,
        nextId = allocator(document);
    const cells = grid.cells.filter((entry) => entry !== cell);
    for (let row = cell.row; row < cell.row + cell.rowspan; row++)
        for (let column = cell.column; column < cell.column + cell.colspan; column++)
            cells.push({
                node:
                    row === cell.row && column === cell.column
                        ? cell.node
                        : blankCell(nextId, cell.node, cell.node.kind === 'tableHeader'),
                row,
                column,
                rowspan: 1,
                colspan: 1,
            });
    return { document: update(document, grid.table, [rebuild(grid, grid.rows, cells)]), caret: cellCaret(cell.node) };
}

export interface TableColumnLayout {
    readonly columnEdges: readonly number[];
    readonly minimumColumnWidths?: readonly number[];
}

export function resizeTableColumns(
    document: NativeDocument,
    tableId: string,
    boundary: number,
    delta: number,
    tableWidth: number,
    layout?: TableColumnLayout,
): NativeDocument {
    const table = nodePath(document, tableId).at(-1);
    if (table?.kind !== 'table') throw new Error('The table no longer exists');
    const grid = tableGrid(table);
    if (
        !Number.isInteger(boundary) ||
        boundary < 1 ||
        boundary >= grid.columns ||
        !Number.isFinite(delta) ||
        !Number.isFinite(tableWidth) ||
        tableWidth <= 0
    )
        throw new Error('Invalid table column resize');
    if (
        layout &&
        (layout.columnEdges.length !== grid.columns + 1 ||
            layout.columnEdges.some(
                (edge, index) => !Number.isFinite(edge) || (index > 0 && edge <= layout.columnEdges[index - 1]),
            ) ||
            Math.abs(layout.columnEdges[0]) > 0.002 ||
            Math.abs(layout.columnEdges.at(-1)! - tableWidth) > 0.002 ||
            (layout.minimumColumnWidths &&
                (layout.minimumColumnWidths.length !== grid.columns ||
                    layout.minimumColumnWidths.some((width) => !Number.isFinite(width) || width < 0))))
    )
        throw new Error('Invalid table column layout');
    const weights = layout
            ? layout.columnEdges.slice(1).map((edge, index) => edge - layout.columnEdges[index])
            : columnWeights(grid),
        sum = weights.reduce((total, value) => total + value, 0);
    const minimum = (Math.min(24, tableWidth / grid.columns / 2) * sum) / tableWidth;
    const left = boundary - 1,
        right = boundary;
    const leftMinimum = Math.min(
        weights[left],
        Math.max(minimum, ((layout?.minimumColumnWidths?.[left] ?? 0) * sum) / tableWidth),
    );
    const rightMinimum = Math.min(
        weights[right],
        Math.max(minimum, ((layout?.minimumColumnWidths?.[right] ?? 0) * sum) / tableWidth),
    );
    const change = Math.max(
        leftMinimum - weights[left],
        Math.min(weights[right] - rightMinimum, (delta * sum) / tableWidth),
    );
    if (Math.abs(change) < 0.000001) return document;
    weights[left] += change;
    weights[right] -= change;
    const columnSize = weights.map((value) => Math.round(value * 1e6) / 1e6).join(',');
    return update(document, table, [
        Object.freeze({ ...table, attributes: Object.freeze({ ...table.attributes, columnSize }) }),
    ]);
}

export function selectedTableFragment(document: NativeDocument, selection: TableCellSelection): NativeNode | undefined {
    const rectangle = tableRectangle(document, selection);
    if (!rectangle) return;
    const { grid, cells, top, bottom, left, right } = rectangle;
    return rebuild(
        grid,
        grid.rows.slice(top, bottom),
        cells.map((cell) => ({ ...cell, row: cell.row - top, column: cell.column - left })),
        columnWeights(grid).slice(left, right).join(','),
    );
}

export function replaceTableCells(
    document: NativeDocument,
    selection: TableCellSelection,
    text: string,
): StructureResult | null {
    const rectangle = tableRectangle(document, selection);
    if (!rectangle) return null;
    const nextId = allocator(document),
        first = rectangle.cells[0];
    let caret: TextCaret | undefined;
    const mapped = new Map(
        rectangle.cells.map((cell) => {
            const empty = blankCell(nextId, cell.node, cell.node.kind === 'tableHeader');
            let paragraph = empty.children![0];
            if (cell === first) {
                caret = { blockId: paragraph.id, offset: text.length };
                const parts: NativeNode[] = [];
                text.split('\n').forEach((part, index) => {
                    if (index) parts.push(Object.freeze({ id: nextId(), kind: 'hardBreak' }));
                    if (part) parts.push(Object.freeze({ id: nextId(), kind: 'text', text: part }));
                });
                paragraph = withChildren(paragraph, parts);
            }
            return [cell, { ...cell, node: withChildren(cell.node, [paragraph]) }] as const;
        }),
    );
    const { grid } = rectangle;
    const table = rebuild(
        grid,
        grid.rows,
        grid.cells.map((cell) => mapped.get(cell) ?? cell),
    );
    return { document: update(document, grid.table, [table]), caret: caret! };
}

export function pasteTableCells(
    document: NativeDocument,
    selection: TableCellSelection,
    blocks: readonly NativeNode[],
    plain = false,
): StructureResult {
    const rectangle = tableRectangle(document, selection);
    if (!rectangle || !blocks.length) throw new Error('The cell selection is no longer in the document');
    let nextId = allocator(document);
    const clone = (node: NativeNode): NativeNode =>
        identity(
            {
                ...node,
                ...(node.attributes ? { attributes: copyJson(node.attributes) as Attributes } : {}),
                ...(node.children ? { children: Object.freeze(node.children.map(clone)) } : {}),
            },
            nextId(),
        );
    const cloneForCell = (node: NativeNode, target: NativeNode): NativeNode => {
        const copied = clone(node);
        if (!plain) return copied;
        const fallback = textBlocks(rectangle.cells[0].node)[0],
            template = textBlocks(target)[0] ?? fallback;
        const marks =
            template?.children?.find((child) => child.kind === 'text')?.marks ??
            fallback?.children?.find((child) => child.kind === 'text')?.marks;
        const inherit = (node: NativeNode): NativeNode => {
            if (node.kind === 'text') return Object.freeze({ ...node, ...(marks ? { marks } : {}) });
            const children = node.children?.map(inherit);
            return identity(
                {
                    ...node,
                    ...(node.kind === 'paragraph' && template?.attributes ? { attributes: template.attributes } : {}),
                    ...(children ? { children: Object.freeze(children) } : {}),
                },
                node.id,
            );
        };
        return inherit(copied);
    };
    let source = blocks.length === 1 && blocks[0].kind === 'table' ? blocks[0] : undefined;
    if (
        !source &&
        plain &&
        blocks.every((block) => block.kind === 'paragraph') &&
        (blocks.length > 1 || blocks.some((block) => blockText(block).includes('\t')))
    ) {
        const values = blocks.map((block) => blockText(block).split('\t')),
            columns = Math.max(...values.map((row) => row.length));
        source = Object.freeze({
            id: nextId(),
            kind: 'table',
            children: Object.freeze(
                values.map((row) =>
                    Object.freeze({
                        id: nextId(),
                        kind: 'tableRow',
                        children: Object.freeze(
                            Array.from({ length: columns }, (_, column) =>
                                Object.freeze({
                                    id: nextId(),
                                    kind: 'tableCell',
                                    children: Object.freeze([
                                        Object.freeze({
                                            id: nextId(),
                                            kind: 'paragraph',
                                            children: Object.freeze(
                                                row[column]
                                                    ? [Object.freeze({ id: nextId(), kind: 'text', text: row[column] })]
                                                    : [],
                                            ),
                                        }),
                                    ]),
                                }),
                            ),
                        ),
                    }),
                ),
            ),
        });
    }
    if (!source) {
        const nodes = new Map(
            rectangle.cells.map((cell) => [
                cell,
                withChildren(
                    cell.node,
                    blocks.map((block) => cloneForCell(block, cell.node)),
                ),
            ]),
        );
        const first = nodes.get(rectangle.cells[0])!;
        const table = rebuild(
            rectangle.grid,
            rectangle.grid.rows,
            rectangle.grid.cells.map((cell) => ({ ...cell, node: nodes.get(cell) ?? cell.node })),
        );
        return { document: update(document, rectangle.grid.table, [table]), caret: cellCaret(first) };
    }
    const copied = tableGrid(source);
    if (!copied.cells.length || !copied.columns || !copied.rows.length) throw new Error('The copied table is empty');
    const occupied = new Set<string>();
    let area = 0;
    for (const cell of copied.cells) {
        area += cell.rowspan * cell.colspan;
        for (let row = cell.row; row < cell.row + cell.rowspan; row++)
            for (let column = cell.column; column < cell.column + cell.colspan; column++)
                occupied.add(`${row}:${column}`);
    }
    if (occupied.size !== copied.rows.length * copied.columns || area !== occupied.size)
        throw new Error('The copied table must be rectangular');
    const { top, left } = rectangle;
    const bottom = rectangle.cells.length === 1 ? top + copied.rows.length : rectangle.bottom;
    const right = rectangle.cells.length === 1 ? left + copied.columns : rectangle.right;
    let base = document,
        grid = rectangle.grid;
    while (grid.rows.length < bottom) {
        const last = grid.cells.at(-1)!;
        base = tableCommand(base, cellCaret(last.node).blockId, 'rowAfter')!.document;
        grid = tableContext(base, cellCaret(last.node).blockId)!.grid;
    }
    while (grid.columns < right) {
        const last = grid.cells.find((cell) => cell.column + cell.colspan === grid.columns)!;
        base = tableCommand(base, cellCaret(last.node).blockId, 'columnAfter')!.document;
        grid = tableContext(base, cellCaret(last.node).blockId)!.grid;
    }
    const intersecting = grid.cells.filter(
        (cell) =>
            cell.row < bottom &&
            cell.row + cell.rowspan > top &&
            cell.column < right &&
            cell.column + cell.colspan > left &&
            (cell.colspan > 1 || cell.rowspan > 1),
    );
    for (const cell of intersecting) base = splitTableCell(base, cell.node.id)!.document;
    nextId = allocator(base);
    grid = tableContext(base, selection.anchorId)!.grid;
    const cells = grid.cells.filter(
        (cell) => !(cell.row >= top && cell.row < bottom && cell.column >= left && cell.column < right),
    );
    let first: NativeNode | undefined;
    for (let row = top; row < bottom; row += copied.rows.length)
        for (let column = left; column < right; column += copied.columns)
            for (const cell of copied.cells) {
                const y = row + cell.row,
                    x = column + cell.column;
                if (y >= bottom || x >= right) continue;
                const target = grid.cells.find((cell) => cell.row === y && cell.column === x)!;
                const node = cloneForCell(cell.node, target.node);
                first ??= node;
                cells.push({
                    node,
                    row: y,
                    column: x,
                    rowspan: Math.min(cell.rowspan, bottom - y),
                    colspan: Math.min(cell.colspan, right - x),
                });
            }
    const table = rebuild(grid, grid.rows, cells);
    const next = update(base, grid.table, [table]);
    return { document: Object.freeze({ ...next, revision: document.revision + 1 }), caret: cellCaret(first!) };
}
