import {
    DocumentSession,
    exportDocument,
    findNode,
    importDocument,
    type NativeDocument,
} from '@saad5400/midad/document';
import {
    blockText,
    columnWeights,
    mergeTableCells,
    replaceSelection,
    resizeTableColumns,
    selectedText,
    selectionRanges,
    splitTableCell,
    tableGrid,
    tableRectangle,
    textBlocks,
    type NativeSelection,
    type TableCellSelection,
} from '@saad5400/midad/editing';
import { clipboardPayload, parseNativeFragment, pasteFragment, plainTextFragment } from '@saad5400/midad/interchange';
import { describe, expect, it } from 'vitest';

const p = (id: string, text = id) => ({
    type: 'paragraph',
    attrs: { id, dir: 'ltr' },
    content: text ? [{ type: 'text', text, marks: [{ type: 'bold' }] }] : [],
});
const cell = (id: string, attrs = {}) => ({ type: 'tableCell', attrs: { id, ...attrs }, content: [p(`${id}-p`, id)] });
const row = (id: string, ...content: unknown[]) => ({ type: 'tableRow', attrs: { id }, content });
const doc = (...rows: unknown[]) =>
    importDocument(
        { type: 'doc', content: [{ type: 'table', attrs: { id: 'table', columnSize: '2,3,5' }, content: rows }] },
        'cells',
    );
const fixture = () =>
    doc(
        row('r1', cell('a'), cell('b'), cell('c')),
        row('r2', cell('d'), cell('e'), cell('f')),
        row('r3', cell('g'), cell('h'), cell('i')),
    );
const cells = (anchorId: string, focusId = anchorId): TableCellSelection => ({ tableId: 'table', anchorId, focusId });
const selected = (anchorId: string, focusId = anchorId): NativeSelection => ({
    anchor: { blockId: `${anchorId}-p`, offset: 0 },
    focus: { blockId: `${focusId}-p`, offset: 1 },
    cells: cells(anchorId, focusId),
});
const valid = (document: NativeDocument) =>
    expect(() => importDocument(exportDocument(document), document.id)).not.toThrow();

describe('native table cell selection', () => {
    it('selects a rectangle rather than every intervening cell in text order', () => {
        const source = fixture();
        expect(tableRectangle(source, cells('b', 'e'))?.cells.map((cell) => cell.node.id)).toEqual(['b', 'e']);
        expect(selectionRanges(source, selected('b', 'e')).map((range) => range.blockId)).toEqual(['b-p', 'e-p']);
        expect(selectedText(source, selected('b', 'e'))).toBe('b\ne');
        expect(selectedText(source, selected('a', 'e'))).toBe('a\tb\nd\te');
    });

    it('expands a rectangle to include every intersecting merged cell, in either drag direction', () => {
        const source = doc(
            row('r1', cell('a', { colspan: 2 }), cell('b')),
            row('r2', cell('c'), cell('d', { colspan: 2 })),
        );
        const forward = tableRectangle(source, cells('a', 'c'))!;
        expect(forward).toMatchObject({ top: 0, left: 0, bottom: 2, right: 3 });
        expect(forward.cells.map((cell) => cell.node.id)).toEqual(['a', 'b', 'c', 'd']);
        expect(tableRectangle(source, cells('c', 'a'))?.cells).toEqual(forward.cells);
        expect(tableRectangle(source, cells('missing'))).toBeUndefined();
    });

    it('merges content with marks and fields, splits spans without losing content, and undoes each operation', () => {
        const source = doc(
            row('r1', cell('a'), {
                ...cell('b'),
                content: [
                    p('b-p', 'Bold'),
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'variable',
                                attrs: { id: 'signature', type: 'signature', participant_id: 'party' },
                            },
                        ],
                    },
                ],
            }),
            row('r2', cell('c'), cell('d')),
        );
        const session = new DocumentSession(source);
        const merged = mergeTableCells(source, cells('a', 'd'))!;
        session.commit(merged.document);
        expect(tableGrid(findNode(session.document, 'table')!).cells).toHaveLength(1);
        expect(findNode(session.document, 'a')?.attributes).toMatchObject({ colspan: 2, rowspan: 2 });
        expect(findNode(session.document, 'b-p')?.children?.[0]).toMatchObject({
            text: 'Bold',
            marks: [{ kind: 'bold' }],
        });
        expect(findNode(session.document, 'signature')?.attributes?.participant_id).toBe('party');
        const split = splitTableCell(session.document, 'a')!;
        session.commit(split.document);
        expect(tableGrid(findNode(session.document, 'table')!).cells).toHaveLength(4);
        expect(textBlocks(findNode(session.document, 'a')!).map(blockText)).toContain('Bold');
        valid(session.document);
        session.undo();
        expect(findNode(session.document, 'a')?.attributes?.rowspan).toBe(2);
        session.undo();
        expect(session.document.root).toBe(source.root);
    });

    it('keeps an empty merged cell to one paragraph and does not split an unmerged cell', () => {
        const source = doc(
            row('r1', { ...cell('a'), content: [p('a-p', '')] }, { ...cell('b'), content: [p('b-p', '')] }),
        );
        const merged = mergeTableCells(source, cells('a', 'b'))!;
        expect(findNode(merged.document, 'a')?.children).toHaveLength(1);
        expect(splitTableCell(source, 'a')).toBeNull();
        expect(mergeTableCells(source, cells('a'))).toBeNull();
    });

    it('clears or types into selected cells while leaving their neighbors intact', () => {
        const source = fixture(),
            result = replaceSelection(source, selected('b', 'e'), 'replacement');
        expect(blockText(findNode(result.document, result.caret.blockId)!)).toBe('replacement');
        expect(textBlocks(findNode(result.document, 'e')!).map(blockText)).toEqual(['']);
        for (const id of ['a', 'c', 'd', 'f', 'g', 'h', 'i'])
            expect(findNode(result.document, `${id}-p`)).toBe(findNode(source, `${id}-p`));
        expect(findNode(result.document, 'b')?.attributes?.colspan).toBe(1);
        valid(result.document);
    });

    it('copies only the selected rectangle with valid rich HTML, spans and native metadata', () => {
        const source = fixture(),
            payload = clipboardPayload(source, selected('b', 'f'));
        expect(payload.text).toBe('b\tc\ne\tf');
        expect(payload.html).toContain('<table');
        expect(new DOMParser().parseFromString(payload.html, 'text/html').querySelector('strong')?.textContent).toBe(
            'b',
        );
        const fragment = parseNativeFragment(payload.native),
            grid = tableGrid(fragment.blocks[0]);
        expect(grid.columns).toBe(2);
        expect(grid.rows).toHaveLength(2);
        expect(grid.table.attributes?.columnSize).toBe('3,5');
        expect(textBlocks(fragment.blocks[0]).map(blockText)).toEqual(['b', 'c', 'e', 'f']);
    });

    it('pastes a copied matrix into one cell, grows the table and creates unique identities', () => {
        const source = fixture();
        const fragment = parseNativeFragment(clipboardPayload(source, selected('a', 'e')).native);
        const pasted = pasteFragment(source, selected('i'), fragment);
        const grid = tableGrid(findNode(pasted.document, 'table')!);
        expect(grid.rows).toHaveLength(4);
        expect(grid.columns).toBe(4);
        const value = (row: number, column: number) =>
            textBlocks(grid.cells.find((cell) => cell.row === row && cell.column === column)!.node)
                .map(blockText)
                .join('');
        expect([value(2, 2), value(2, 3), value(3, 2), value(3, 3)]).toEqual(['a', 'b', 'd', 'e']);
        expect(value(0, 0)).toBe('a');
        expect(pasted.document.revision).toBe(1);
        valid(pasted.document);
    });

    it('pastes tab-separated text as a matrix and repeats a small matrix across a larger selection', () => {
        const source = fixture();
        const pasted = pasteFragment(source, selected('a', 'i'), plainTextFragment('X\tY'));
        const grid = tableGrid(findNode(pasted.document, 'table')!);
        expect(grid.cells.map((cell) => textBlocks(cell.node).map(blockText).join(''))).toEqual([
            'X',
            'Y',
            'X',
            'X',
            'Y',
            'X',
            'X',
            'Y',
            'X',
        ]);
        expect(textBlocks(grid.cells[0].node)[0].attributes?.dir).toBe('ltr');
        expect(textBlocks(grid.cells[0].node)[0].children?.[0].marks?.[0].kind).toBe('bold');
        valid(pasted.document);
    });

    it('splits target merges before pasting and preserves neighboring content', () => {
        const merged = mergeTableCells(fixture(), cells('a', 'e'))!.document;
        const selection: NativeSelection = {
            anchor: { blockId: 'a-p', offset: 0 },
            focus: { blockId: 'a-p', offset: 0 },
            cells: cells('a'),
        };
        const pasted = pasteFragment(merged, selection, plainTextFragment('X\tY\nZ\tW'));
        const grid = tableGrid(findNode(pasted.document, 'table')!);
        expect(
            grid.cells
                .filter((cell) => cell.row < 2 && cell.column < 2)
                .map((cell) => textBlocks(cell.node).map(blockText).join('')),
        ).toEqual(['X', 'Y', 'Z', 'W']);
        expect(findNode(pasted.document, 'f-p')).toBeDefined();
        valid(pasted.document);
    });

    it('resizes from the displayed column edges when content has redistributed the requested widths', () => {
        const source = fixture();
        const resized = resizeTableColumns(source, 'table', 1, 10, 500, {
            columnEdges: [0, 70, 250, 500],
            minimumColumnWidths: [50, 100, 100],
        });
        const weights = columnWeights(tableGrid(findNode(resized, 'table')!));
        const sum = weights.reduce((total, value) => total + value, 0);
        expect(weights.map((weight) => (weight * 500) / sum)).toEqual([80, 170, 250]);
    });
    it('does not jump an imported undersized column when attempting to shrink it further', () => {
        const raw = JSON.parse(JSON.stringify(exportDocument(fixture()))) as {
            content: Array<{ attrs: Record<string, unknown> }>;
        };
        raw.content[0].attrs.columnSize = '1,100,100';
        const source = importDocument(raw, 'narrow-table');
        expect(resizeTableColumns(source, 'table', 1, -1, 500)).toBe(source);
    });
    it('resizes adjacent columns, preserves total table width, and clamps both minimum widths', () => {
        const source = fixture(),
            resized = resizeTableColumns(source, 'table', 1, 50, 500);
        expect(columnWeights(tableGrid(findNode(resized, 'table')!))).toEqual([3, 2, 5]);
        for (const delta of [-10000, 10000]) {
            const result = resizeTableColumns(source, 'table', 1, delta, 500);
            const weights = columnWeights(tableGrid(findNode(result, 'table')!));
            expect(weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(10);
            expect((Math.min(...weights) / 10) * 500).toBeGreaterThanOrEqual(24);
            valid(result);
        }
        expect(resizeTableColumns(source, 'table', 1, 0, 500)).toBe(source);
        expect(() => resizeTableColumns(source, 'table', 0, 1, 500)).toThrow('Invalid');
        expect(() => resizeTableColumns(source, 'table', 1, NaN, 500)).toThrow('Invalid');
    });
});
