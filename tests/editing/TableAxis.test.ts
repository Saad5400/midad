import { DocumentSession, exportDocument, findNode, importDocument, type NativeNode } from '@saad5400/midad/document';
import {
    blockText,
    canMoveTableAxis,
    columnWeights,
    deleteTableById,
    mergeTableCells,
    replaceInlineText,
    resizeTableColumns,
    setTableAttributes,
    setTableCellAttributes,
    setTableRowHeight,
    splitTableCell,
    tabTable,
    tableAxisCommand,
    tableAxisRange,
    tableAxisSelection,
    tableCommand,
    tableGrid,
} from '@saad5400/midad/editing';
import { expect, it } from 'vitest';

const p = (id: string) => ({
    type: 'paragraph',
    attrs: { id: `${id}-p`, dir: 'ltr' },
    content: [{ type: 'text', text: id }],
});
const cell = (id: string, attrs = {}) => ({
    type: 'tableCell',
    attrs: { id, retained: id, ...attrs },
    content: [p(id)],
});
const row = (id: string, ...content: unknown[]) => ({
    type: 'tableRow',
    attrs: { id, rowHeight: 72, retained: id },
    content,
});
const fixture = (
    rows: unknown[] = [
        row('r1', cell('a'), cell('b'), cell('c')),
        row('r2', cell('d'), cell('e'), cell('f')),
        row('r3', cell('g'), cell('h'), cell('i')),
    ],
) =>
    importDocument(
        {
            type: 'doc',
            content: [{ type: 'table', attrs: { id: 'table', columnSize: '2,3,5', retained: 'table' }, content: rows }],
        },
        'axis',
    );
const grid = (document: ReturnType<typeof fixture>) => tableGrid(findNode(document, 'table')!);
const ids = (node: NativeNode): string[] => [node.id, ...(node.children?.flatMap(ids) ?? [])];
const texts = (document: ReturnType<typeof fixture>) =>
    grid(document).rows.map((row) => row.node.children!.map((cell) => cell.children!.map(blockText).join('|')));
const valid = (document: ReturnType<typeof fixture>) => {
    expect(() => importDocument(exportDocument(document), document.id)).not.toThrow();
    const all = ids(document.root);
    expect(new Set(all).size).toBe(all.length);
};

it.each(['row', 'column'] as const)('moves a logical %s and preserves identities, weights and history', (axis) => {
    const source = fixture(),
        session = new DocumentSession(source);
    expect(canMoveTableAxis(grid(source), axis, 0, -1)).toBe(false);
    const result = tableAxisCommand(source, 'table', axis, 0, 'moveAfter')!;
    session.commit(result.document);
    valid(result.document);
    if (axis === 'row') {
        expect(grid(result.document).rows.map((row) => row.node.id)).toEqual(['r2', 'r1', 'r3']);
        expect(texts(result.document)[0]).toEqual(['d', 'e', 'f']);
    } else {
        expect(texts(result.document)[0]).toEqual(['b', 'a', 'c']);
        expect(columnWeights(grid(result.document))).toEqual([3, 2, 5]);
    }
    session.undo();
    expect(session.document.root).toEqual(source.root);
    session.redo();
    expect(session.document.root).toEqual(result.document.root);
});

it('moves merged row groups intact and never tears a rowspan apart', () => {
    const source = fixture([
        row('r1', cell('a', { rowspan: 2 }), cell('b')),
        row('r2', cell('c')),
        row('r3', cell('d'), cell('e')),
    ]);
    expect(tableAxisRange(grid(source), 'row', 1)).toEqual({ from: 0, to: 2 });
    const result = tableAxisCommand(source, 'table', 'row', 1, 'moveAfter')!;
    expect(grid(result.document).rows.map((row) => row.node.id)).toEqual(['r3', 'r1', 'r2']);
    expect(grid(result.document).cells.find((cell) => cell.node.id === 'a')).toMatchObject({ row: 1, rowspan: 2 });
    valid(result.document);
});

it('duplicates a merged column group with fresh IDs and matching column widths', () => {
    const source = fixture([
        row('r1', cell('a', { colspan: 2 }), cell('b')),
        row('r2', cell('c'), cell('d'), cell('e')),
    ]);
    const result = tableAxisCommand(source, 'table', 'column', 0, 'duplicate')!;
    const next = grid(result.document);
    expect(next.columns).toBe(5);
    expect(columnWeights(next)).toEqual([2, 3, 2, 3, 5]);
    expect(next.cells.filter((cell) => cell.colspan === 2)).toHaveLength(2);
    expect(texts(result.document)[0]).toEqual(['a', 'a', 'b']);
    expect(texts(result.document)[1]).toEqual(['c', 'd', 'c', 'd', 'e']);
    valid(result.document);
});

it('duplicates row metadata and inline fields without sharing field identities', () => {
    const source = fixture([
        row('r1', {
            type: 'tableCell',
            attrs: { id: 'a' },
            content: [
                {
                    ...p('a'),
                    content: [
                        { type: 'variable', attrs: { id: 'field-a', type: 'text', name: 'Value', value: '100' } },
                    ],
                },
            ],
        }),
    ]);
    const result = tableAxisCommand(source, 'table', 'row', 0, 'duplicate')!;
    const rows = grid(result.document).rows;
    expect(rows).toHaveLength(2);
    expect(rows[1].node.attributes).toMatchObject({ rowHeight: 72, retained: 'r1' });
    const variables = rows.map((row) => row.node.children![0].children![0].children![0]);
    expect(variables.map((node) => node.attributes?.value)).toEqual(['100', '100']);
    expect(variables[1].id).not.toBe(variables[0].id);
    expect(variables[1].attributes?.id).toBe(variables[1].id);
    valid(result.document);
});

it('moves rows across retained row-group slots without regrouping their content', () => {
    const source = fixture([
        {
            type: 'tableRowGroup',
            attrs: { id: 'g1', retained: 'first' },
            content: [row('r1', cell('a')), row('r2', cell('b'))],
        },
        { type: 'tableRowGroup', attrs: { id: 'g2', retained: 'second' }, content: [row('r3', cell('c'))] },
    ]);
    const result = tableAxisCommand(source, 'table', 'row', 1, 'moveAfter')!;
    expect(grid(result.document).rows.map((row) => row.node.id)).toEqual(['r1', 'r3', 'r2']);
    expect(findNode(result.document, 'g1')!.attributes?.retained).toBe('first');
    expect(findNode(result.document, 'g2')!.attributes?.retained).toBe('second');
    valid(result.document);
});

it('toggles a header column and applies cell styles without changing neighboring cells', () => {
    const source = fixture();
    const header = tableAxisCommand(source, 'table', 'column', 0, 'header')!.document;
    expect(
        grid(header)
            .cells.filter((cell) => cell.column === 0)
            .every((cell) => cell.node.kind === 'tableHeader'),
    ).toBe(true);
    expect(
        grid(header)
            .cells.filter((cell) => cell.column !== 0)
            .every((cell) => cell.node.kind === 'tableCell'),
    ).toBe(true);
    const styled = setTableCellAttributes(header, 'table', ['a', 'd'], {
        backgroundColor: '#ffeeaa',
        verticalAlign: 'middle',
    });
    expect(findNode(styled, 'a')!.attributes).toMatchObject({
        backgroundColor: '#ffeeaa',
        verticalAlign: 'middle',
        retained: 'a',
    });
    expect(findNode(styled, 'b')!.attributes?.backgroundColor).toBeUndefined();
    const cleared = setTableCellAttributes(styled, 'table', ['a'], { backgroundColor: null });
    expect(findNode(cleared, 'a')!.attributes?.backgroundColor).toBeUndefined();
    valid(styled);
});

it('inserts and deletes the requested logical row inside a spanning cell', () => {
    const source = fixture([row('r1', cell('a', { rowspan: 2 }), cell('b')), row('r2', cell('c'))]);
    const inserted = tableAxisCommand(source, 'table', 'row', 1, 'insertBefore')!.document;
    expect(grid(inserted).rows).toHaveLength(3);
    expect(grid(inserted).cells.find((cell) => cell.node.id === 'a')!.rowspan).toBe(3);
    const removed = tableAxisCommand(source, 'table', 'row', 1, 'delete')!.document;
    expect(grid(removed).rows).toHaveLength(1);
    expect(findNode(removed, 'a')).toBeDefined();
    expect(findNode(removed, 'b')).toBeDefined();
    expect(findNode(removed, 'c')).toBeUndefined();
    valid(inserted);
    valid(removed);
});

it('selects full axes including intersecting merged cells', () => {
    const source = fixture();
    expect(tableAxisSelection(source, 'table', 'column', 1)).toEqual({ tableId: 'table', anchorId: 'b', focusId: 'h' });
    expect(tableAxisSelection(source, 'table', 'row', 1)).toEqual({ tableId: 'table', anchorId: 'd', focusId: 'f' });
});

it('locks structure across commands and resizing while retaining text editing and tab navigation', () => {
    const source = setTableAttributes(fixture(), 'table', { locked: true });
    for (const action of ['delete', 'duplicate', 'moveAfter', 'header', 'insertAfter'] as const)
        expect(tableAxisCommand(source, 'table', 'row', 0, action)).toBeNull();
    expect(tableCommand(source, 'a-p', 'deleteTable')).toBeNull();
    expect(mergeTableCells(source, { tableId: 'table', anchorId: 'a', focusId: 'b' })).toBeNull();
    expect(splitTableCell(source, 'a')).toBeNull();
    expect(() => resizeTableColumns(source, 'table', 1, 5, 300)).toThrow('locked');
    expect(() => setTableRowHeight(source, 'table', 'r1', 100)).toThrow('locked');
    expect(tabTable(source, 'i-p', false)!.document).toBe(source);
    expect(
        replaceInlineText(source, { blockId: 'a-p', from: 0, to: 1, text: 'Edited', expectedRevision: source.revision })
            .revision,
    ).toBe(source.revision + 1);
    const unlocked = setTableAttributes(source, 'table', { locked: false });
    expect(tableAxisCommand(unlocked, 'table', 'row', 0, 'duplicate')).not.toBeNull();
});

it('deletes the requested outer table when its first editable text belongs to a nested table', () => {
    const source = fixture([
        row('r1', {
            type: 'tableCell',
            attrs: { id: 'outer-cell' },
            content: [
                {
                    type: 'table',
                    attrs: { id: 'nested' },
                    content: [row('nested-row', cell('nested-cell'))],
                },
            ],
        }),
    ]);
    const result = deleteTableById(source, 'table')!;
    expect(findNode(result.document, 'table')).toBeUndefined();
    expect(findNode(result.document, 'nested')).toBeUndefined();
    expect(result.document.root.children).toHaveLength(1);
    expect(result.document.root.children![0].kind).toBe('paragraph');
});

it.each(['header', 'duplicate', 'insertAfter'] as const)(
    'edits an empty cell without requiring a pre-existing text caret: %s',
    (command) => {
        const source = fixture([row('r1', { type: 'tableCell', attrs: { id: 'empty' }, content: [] })]);
        const result = tableAxisCommand(source, 'table', 'row', 0, command)!;
        expect(findNode(result.document, result.caret.blockId)?.kind).toBe('paragraph');
        expect(result.document.revision).toBe(source.revision + 1);
        valid(result.document);
    },
);

it('rejects invalid targets and colors without modifying the document', () => {
    const source = fixture();
    expect(() => tableAxisCommand(source, 'missing', 'row', 0, 'delete')).toThrow('table no longer exists');
    expect(() => tableAxisCommand(source, 'table', 'row', 100, 'delete')).toThrow('Invalid table axis');
    expect(() => tableAxisCommand(source, 'table', 'row', 0, 'wrong' as never)).toThrow('Invalid table axis command');
    expect(() => setTableAttributes(source, 'table', { borderColor: 'not-a-color' })).toThrow();
    expect(() => setTableCellAttributes(source, 'table', ['missing'], { verticalAlign: 'bottom' })).toThrow(
        'cell no longer exists',
    );
    expect(source.revision).toBe(0);
});
