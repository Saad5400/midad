import type { NativeDocument } from '../../document/model.js';
import { formatBlock, formatText } from '../../editing/formatting.js';
import type { StructureResult } from '../../editing/lists.js';
import type { NativeSelection } from '../../editing/selection.js';
import {
    deleteTableById,
    setTableAttributes,
    setTableCellAttributes,
    tableAxisCommand,
    tableAxisSelection,
} from '../../editing/table-axis.js';
import { tableRectangle, type TableCellSelection } from '../../editing/table-grid.js';
import { resolveTableTarget as tableControlContext, type TableTarget } from '../../editing/table-target.js';
import { mergeTableCells, replaceTableCells, splitTableCell, tableContext } from '../../editing/tables.js';
import { blockText, textBlocks } from '../../editing/text.js';
export { tableControlContext };

export interface TableControlTarget extends TableTarget {
    pageIndex?: number;
}
export type TableControlScope = 'cell' | 'row' | 'column' | 'table';
export type TableControlEdit = Omit<StructureResult, 'caret'> & { caret?: StructureResult['caret']; reveal?: boolean };

export function tableControlCells(
    document: NativeDocument,
    target: TableControlTarget,
    scope: TableControlScope,
    selected: NativeSelection | null,
): TableCellSelection {
    const context = tableControlContext(document, target);
    if (scope === 'cell' && selected?.cells?.tableId === target.tableId) return selected.cells;
    if (scope === 'row' || scope === 'column') {
        const cells = tableAxisSelection(
            document,
            target.tableId,
            scope,
            scope === 'row' ? context.rowIndex : context.colIndex,
        );
        if (!cells) throw new Error('The table selection changed');
        return cells;
    }
    return {
        tableId: target.tableId,
        anchorId: scope === 'table' ? context.grid.cells[0].node.id : target.cellId,
        focusId: scope === 'table' ? context.grid.cells.at(-1)!.node.id : target.cellId,
    };
}

export function tableControlSelection(document: NativeDocument, cells: TableCellSelection): NativeSelection | null {
    const rectangle = tableRectangle(document, cells);
    if (!rectangle) throw new Error('The table selection changed');
    const first = textBlocks(rectangle.cells[0].node)[0];
    const last = textBlocks(rectangle.cells.at(-1)!.node).at(-1);
    if (!first || !last) return null;
    return {
        anchor: { blockId: first.id, offset: 0 },
        focus: { blockId: last.id, offset: blockText(last).length },
        cells,
    };
}

export function applyTableControlAction(
    document: NativeDocument,
    target: TableControlTarget,
    scope: TableControlScope,
    id: string,
    selected: NativeSelection | null,
    value?: string | null,
    atEnd = false,
): TableControlEdit | null {
    const context = tableControlContext(document, target);
    const cells = tableControlCells(document, target, scope, selected);
    const range = tableControlSelection(document, cells);
    const axis = scope === 'column' ? 'column' : 'row';
    const index = atEnd
        ? axis === 'row'
            ? context.grid.rows.length - 1
            : context.grid.columns - 1
        : axis === 'row'
          ? context.rowIndex
          : context.colIndex;
    const commands = {
        'header-toggle': 'header',
        'move-back': 'moveBefore',
        'move-forward': 'moveAfter',
        'insert-before': 'insertBefore',
        'insert-after': 'insertAfter',
        duplicate: 'duplicate',
        delete: 'delete',
    } as const;
    if (id in commands) {
        const result = tableAxisCommand(document, target.tableId, axis, index, commands[id as keyof typeof commands]);
        return result && { ...result, reveal: id !== 'header-toggle' };
    }
    if (id === 'table-delete') return deleteTableById(document, target.tableId);
    if (id === 'clear') return replaceTableCells(document, cells, '');
    if (id === 'merge-toggle') {
        const rectangle = tableRectangle(document, cells)!;
        const merged = rectangle.cells.filter((cell) => cell.rowspan > 1 || cell.colspan > 1);
        if (!merged.length) return mergeTableCells(document, cells);
        let result: StructureResult | null = null;
        let working = document;
        for (const cell of merged) {
            const next = splitTableCell(working, cell.node.id);
            if (next) {
                result = next;
                working = next.document;
            }
        }
        return (
            result && { ...result, document: Object.freeze({ ...result.document, revision: document.revision + 1 }) }
        );
    }
    let next = document;
    if (id === 'table-lock')
        next = setTableAttributes(document, target.tableId, { locked: context.grid.table.attributes?.locked !== true });
    else if (id === 'table-border-color')
        next = setTableAttributes(document, target.tableId, { borderColor: value ?? null });
    else if (id === 'color-background' || id.startsWith('valign-')) {
        const rectangle = tableRectangle(document, cells)!;
        const body = rectangle.cells.filter((cell) => cell.node.kind !== 'tableHeader');
        const targets = id === 'color-background' && body.length ? body : rectangle.cells;
        next = setTableCellAttributes(
            document,
            target.tableId,
            targets.map((cell) => cell.node.id),
            id === 'color-background'
                ? { backgroundColor: value ?? null }
                : { verticalAlign: id.slice(7) as 'top' | 'middle' | 'bottom' },
        );
    } else if (id === 'color-text' || id.startsWith('align-')) {
        const rectangle = tableRectangle(document, cells)!;
        for (const cell of rectangle.cells)
            for (const block of textBlocks(cell.node))
                next =
                    id === 'color-text'
                        ? formatText(
                              next,
                              {
                                  blockId: block.id,
                                  from: 0,
                                  to: blockText(block).length,
                                  expectedRevision: next.revision,
                              },
                              { kind: 'style', attributes: { color: value ?? null } },
                          )
                        : formatBlock(next, block.id, { textAlign: id.slice(6) as 'left' | 'center' | 'right' });
    } else throw new Error('Unknown table action');
    return {
        document: next === document ? document : Object.freeze({ ...next, revision: document.revision + 1 }),
        caret: scope === 'table' ? (selected?.focus ?? range?.anchor) : range?.anchor,
    };
}

export function tableControlTargetAfter(
    document: NativeDocument,
    result: TableControlEdit,
): TableControlTarget | undefined {
    if (!result.caret) return;
    const context = tableContext(document, result.caret.blockId);
    return context
        ? {
              tableId: context.grid.table.id,
              cellId: context.cell.node.id,
              rowId: context.grid.rows[context.cell.row].node.id,
          }
        : undefined;
}
