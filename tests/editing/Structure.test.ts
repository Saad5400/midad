import {
    DocumentSession,
    exportDocument,
    findNode,
    importDocument,
    type NativeDocument,
} from '@saad5400/midad/document';
import { blockText } from '@saad5400/midad/editing';
import { indentList, joinListItem, listContext, splitListItem, toggleList } from '@saad5400/midad/editing';
import { textBlocks, type NativeSelection } from '@saad5400/midad/editing';
import { insertTable, tabTable, tableCommand, tableContext, tableGrid } from '@saad5400/midad/editing';
import { describe, expect, it } from 'vitest';

const p = (id: string, text = id) => ({
    type: 'paragraph',
    attrs: { id, dir: 'ltr' },
    content: text ? [{ type: 'text', text, marks: [{ type: 'bold' }] }] : [],
});
const item = (id: string, ...content: unknown[]) => ({ type: 'listItem', attrs: { id }, content });
const list = (id: string, ...content: unknown[]) => ({ type: 'orderedList', attrs: { id, start: 4 }, content });
const doc = (...content: unknown[]) => importDocument({ type: 'doc', content }, 'structure');
const selection = (from: string, to = from): NativeSelection => ({
    anchor: { blockId: from, offset: 0 },
    focus: { blockId: to, offset: 0 },
});
const cell = (id: string, attrs = {}) => ({ type: 'tableCell', attrs: { id, ...attrs }, content: [p(`${id}-p`)] });
const row = (id: string, ...content: unknown[]) => ({ type: 'tableRow', attrs: { id }, content });
const table = (...content: unknown[]) =>
    doc({ type: 'table', attrs: { id: 'table', dir: 'rtl', columnSize: '2,3' }, content });
const valid = (document: NativeDocument) =>
    expect(() => importDocument(exportDocument(document), document.id)).not.toThrow();

describe('native list authoring', () => {
    it('applies a list type across existing list items and following paragraphs', () => {
        const source = doc(list('list', item('ia', p('a')), item('ib', p('b'))), p('c'));
        const result = toggleList(source, selection('b', 'c'), 'bulletList');
        expect(listContext(result, 'a')?.list.kind).toBe('orderedList');
        expect(listContext(result, 'b')?.list.kind).toBe('bulletList');
        expect(listContext(result, 'c')?.list.kind).toBe('bulletList');
        expect(textBlocks(result.root).map(blockText)).toEqual(['a', 'b', 'c']);
        valid(result);
    });
    it('wraps selected paragraphs, changes list type, and unwraps without losing text identities or marks', () => {
        const original = doc(p('a'), p('b'), p('c'));
        const wrapped = toggleList(original, selection('a', 'b'), 'bulletList');
        expect(wrapped.root.children?.map((node) => node.kind)).toEqual(['bulletList', 'paragraph']);
        expect(listContext(wrapped, 'a')?.list.children).toHaveLength(2);
        expect(findNode(wrapped, 'a')).toBe(findNode(original, 'a'));
        const converted = toggleList(wrapped, selection('a', 'b'), 'orderedList');
        expect(listContext(converted, 'a')?.list.kind).toBe('orderedList');
        const unwrapped = toggleList(converted, selection('a', 'b'), 'orderedList');
        expect(unwrapped.root.children?.map((node) => node.id)).toEqual(['a', 'b', 'c']);
        valid(unwrapped);
    });

    it('unwraps only the selected item and preserves numbering on both sides', () => {
        const source = doc(list('list', item('ia', p('a')), item('ib', p('b')), item('ic', p('c'))));
        const result = toggleList(source, selection('b'), 'orderedList');
        expect(result.root.children?.map((node) => node.kind)).toEqual(['orderedList', 'paragraph', 'orderedList']);
        expect(result.root.children?.[0].attributes?.start).toBe(4);
        expect(result.root.children?.[2].attributes?.start).toBe(6);
        valid(result);
    });

    it('indents multiple items and lifts them back without altering their content', () => {
        const source = doc(list('list', item('ia', p('a')), item('ib', p('b')), item('ic', p('c'))));
        const indented = indentList(source, selection('b', 'c'), false);
        expect(findNode(indented, 'list')?.children).toHaveLength(1);
        expect(listContext(indented, 'b')?.list.children?.map((node) => node.id)).toEqual(['ib', 'ic']);
        const lifted = indentList(indented, selection('b', 'c'), true);
        expect(findNode(lifted, 'list')?.children?.map((node) => node.id)).toEqual(['ia', 'ib', 'ic']);
        expect(findNode(lifted, 'b')).toBe(findNode(source, 'b'));
        expect(indentList(source, selection('a'), false)).toBe(source);
        valid(lifted);
    });

    it('keeps following nested items under the lifted item', () => {
        const source = doc(
            list(
                'outer',
                item(
                    'parent',
                    p('parent-p'),
                    list('inner', item('a-item', p('a')), item('b-item', p('b')), item('c-item', p('c'))),
                ),
            ),
        );
        const result = indentList(source, selection('b'), true);
        expect(findNode(result, 'outer')?.children?.map((node) => node.id)).toEqual(['parent', 'b-item']);
        expect(listContext(result, 'a')?.list.id).toBe('inner');
        expect(listContext(result, 'c')?.list.children?.[0].id).toBe('c-item');
        expect(findNode(result, 'b-item')?.children?.at(-1)?.kind).toBe('orderedList');
        valid(result);
    });

    it('splits an item across styled text and moves trailing nested content to the next item', () => {
        const source = doc(
            list('list', item('item', p('a', 'before after'), list('nested', item('nested-item', p('nested-p'))))),
        );
        const result = splitListItem(source, { blockId: 'a', from: 6, to: 7, expectedRevision: 0 })!;
        expect(blockText(findNode(result.document, 'a')!)).toBe('before');
        expect(blockText(findNode(result.document, result.caret.blockId)!)).toBe('after');
        expect(findNode(result.document, result.caret.blockId)?.children?.[0].marks?.[0].kind).toBe('bold');
        expect(findNode(result.document, 'list')?.children?.[1].children?.[1].id).toBe('nested');
        valid(result.document);
    });

    it('exits an empty list item and splits the remaining list without duplicating identities', () => {
        const source = doc(list('list', item('ia', p('a')), item('empty-item', p('empty', '')), item('ic', p('c'))));
        const result = splitListItem(source, { blockId: 'empty', from: 0, to: 0, expectedRevision: 0 })!;
        expect(result.document.root.children?.map((node) => node.kind)).toEqual([
            'orderedList',
            'paragraph',
            'orderedList',
        ]);
        expect(result.caret).toEqual({ blockId: 'empty', offset: 0 });
        valid(result.document);
    });

    it('joins adjacent items, lifts the first item with Backspace, and restores structure through undo', () => {
        const source = doc(list('list', item('ia', p('a')), item('ib', p('b'))));
        const session = new DocumentSession(source);
        const result = joinListItem(source, 'b')!;
        session.commit(result.document);
        expect(result.caret).toEqual({ blockId: 'a', offset: 1 });
        expect(blockText(findNode(session.document, 'a')!)).toBe('ab');
        expect(findNode(session.document, 'list')?.children).toHaveLength(1);
        session.undo();
        expect(session.document.root).toBe(source.root);
        const lifted = joinListItem(source, 'a')!;
        expect(lifted.document.root.children?.[0].id).toBe('a');
        valid(lifted.document);
    });

    it('rejects stale revisions and splitting inside an Arabic grapheme', () => {
        const source = doc(list('list', item('item', p('a', 'عَربي'))));
        expect(() => splitListItem(source, { blockId: 'a', from: 1, to: 1, expectedRevision: 0 })).toThrow('grapheme');
        expect(() => splitListItem(source, { blockId: 'a', from: 0, to: 0, expectedRevision: 1 })).toThrow('conflict');
    });
});

describe('native table authoring', () => {
    it('keeps the required first paragraph when inserting a table into a list item', () => {
        const source = doc(list('list', item('item', p('a', 'text'))));
        const result = insertTable(source, { blockId: 'a', offset: 0 }, 1, 1, false);
        expect(findNode(result.document, 'item')?.children?.map((node) => node.kind)).toEqual([
            'paragraph',
            'table',
            'paragraph',
        ]);
        expect(blockText(findNode(result.document, 'a')!)).toBe('');
        expect(textBlocks(result.document.root).map(blockText)).toContain('text');
        valid(result.document);
    });
    it('inserts a table between styled text, creates unique cells, and keeps the original text after undo', () => {
        const source = doc(p('a', 'before after'));
        const result = insertTable(source, { blockId: 'a', offset: 7 }, 2, 3, true);
        const grid = tableContext(result.document, result.caret.blockId)!.grid;
        expect(grid.rows).toHaveLength(2);
        expect(grid.columns).toBe(3);
        expect(grid.cells.filter((entry) => entry.node.kind === 'tableHeader')).toHaveLength(3);
        expect(textBlocks(result.document.root).map(blockText).filter(Boolean)).toEqual(['before ', 'after']);
        const session = new DocumentSession(source);
        session.commit(result.document);
        session.undo();
        expect(session.document.root).toBe(source.root);
        valid(result.document);
    });

    it('uses table order for Tab, adds a row from the last cell, and returns to its first cell', () => {
        const source = table(row('r1', cell('a'), cell('b')), row('r2', cell('c'), cell('d')));
        expect(tabTable(source, 'a-p', false)?.caret.blockId).toBe('b-p');
        expect(tabTable(source, 'a-p', true)?.document).toBe(source);
        expect(tabTable(source, 'd-p', true)?.caret.blockId).toBe('c-p');
        const appended = tabTable(source, 'd-p', false)!;
        const context = tableContext(appended.document, appended.caret.blockId)!;
        expect(context.grid.rows).toHaveLength(3);
        expect(context.cell.column).toBe(0);
        expect(context.cell.row).toBe(2);
        expect(context.cell.node.kind).toBe('tableCell');
        valid(appended.document);
    });

    it('adds rows inside rowspans and keeps table row-group metadata', () => {
        const source = table({
            type: 'tableRowGroup',
            attrs: { id: 'group', label: 'body' },
            content: [row('r1', cell('a', { rowspan: 2 }), cell('b')), row('r2', cell('c'))],
        });
        const result = tableCommand(source, 'c-p', 'rowBefore')!;
        const grid = tableGrid(findNode(result.document, 'table')!);
        expect(grid.rows).toHaveLength(3);
        expect(grid.cells.find((entry) => entry.node.id === 'a')?.rowspan).toBe(3);
        expect(grid.cells.filter((entry) => entry.row === 1)).toHaveLength(1);
        expect(findNode(result.document, 'group')?.attributes?.label).toBe('body');
        expect(findNode(result.document, 'group')?.children).toHaveLength(3);
        valid(result.document);
    });

    it('adds and deletes columns through colspans and preserves column proportions', () => {
        const source = table(row('r1', cell('a', { colspan: 2 })), row('r2', cell('b'), cell('c')));
        const inserted = tableCommand(source, 'c-p', 'columnBefore')!;
        const grid = tableGrid(findNode(inserted.document, 'table')!);
        expect(grid.columns).toBe(3);
        expect(grid.cells.find((entry) => entry.node.id === 'a')?.colspan).toBe(3);
        expect(grid.table.attributes?.columnSize).toBe('2,3,3');
        const removed = tableCommand(inserted.document, inserted.caret.blockId, 'deleteColumn')!;
        expect(tableGrid(findNode(removed.document, 'table')!).columns).toBe(2);
        expect(findNode(removed.document, 'table')?.attributes?.columnSize).toBe('2,3');
        valid(removed.document);
    });

    it('moves a spanning cell origin when its row is deleted without discarding its text or field metadata', () => {
        const source = table(
            row(
                'r1',
                {
                    ...cell('a', { rowspan: 2 }),
                    content: [
                        p('a-p'),
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'variable',
                                    attrs: { id: 'field', type: 'signature', participant_id: 'party' },
                                },
                            ],
                        },
                    ],
                },
                cell('b'),
            ),
            row('r2', cell('c')),
        );
        const result = tableCommand(source, 'a-p', 'deleteRow')!;
        const grid = tableGrid(findNode(result.document, 'table')!);
        expect(grid.rows).toHaveLength(1);
        expect(grid.cells.find((entry) => entry.node.id === 'a')).toMatchObject({ row: 0, column: 0, rowspan: 1 });
        expect(findNode(result.document, 'field')?.attributes).toMatchObject({
            participant_id: 'party',
            type: 'signature',
        });
        valid(result.document);
    });

    it('understands legacy merged cells and converts ghost cells to real spans when editing the table', () => {
        const source = table(
            row(
                'r1',
                cell('a', { rmMergeOrigin: true, rmColspan: 2, rmRowspan: 1 }),
                cell('ghost', { rmMergedTo: 'a' }),
            ),
            row('r2', cell('b'), cell('c')),
        );
        const result = tableCommand(source, 'b-p', 'rowAfter')!;
        const grid = tableGrid(findNode(result.document, 'table')!);
        expect(grid.columns).toBe(2);
        expect(findNode(result.document, 'a')?.attributes?.colspan).toBe(2);
        expect(findNode(result.document, 'a')?.attributes?.rmMergeOrigin).toBeUndefined();
        expect(findNode(result.document, 'ghost')).toBeUndefined();
        expect(blockText(findNode(result.document, 'a-p')!)).toBe('a-p');
        valid(result.document);
    });

    it('toggles headers and leaves an editable paragraph when the last row, column or entire table is deleted', () => {
        const source = table(row('r1', cell('a'), cell('b')));
        const headed = tableCommand(source, 'a-p', 'headerRow')!;
        expect(
            tableGrid(findNode(headed.document, 'table')!).cells.every((entry) => entry.node.kind === 'tableHeader'),
        ).toBe(true);
        const removed = tableCommand(headed.document, headed.caret.blockId, 'deleteRow')!;
        expect(removed.document.root.children?.[0].kind).toBe('paragraph');
        expect(findNode(removed.document, removed.caret.blockId)).toBeDefined();
        const single = table(row('r1', cell('a')));
        expect(tableCommand(single, 'a-p', 'deleteColumn')!.document.root.children?.[0].kind).toBe('paragraph');
        expect(tableCommand(source, 'a-p', 'deleteTable')!.document.root.children?.[0].kind).toBe('paragraph');
        valid(removed.document);
    });

    it('rejects invalid dimensions and partial grapheme insertion positions', () => {
        const source = doc(p('a', 'عَربي'));
        for (const count of [0, -1, 1.5, 101, NaN])
            expect(() => insertTable(source, { blockId: 'a', offset: 0 }, count, 2, false)).toThrow('dimensions');
        expect(() => insertTable(source, { blockId: 'a', offset: 1 }, 2, 2, false)).toThrow('grapheme');
    });
});
