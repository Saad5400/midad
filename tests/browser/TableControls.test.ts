import {
    applyTableControlAction,
    tableControlMenu,
    tableControlSelection,
    type TableControlTarget,
} from '@saad5400/midad/browser/commands';
import { SurfaceFocusIntent } from '@saad5400/midad/browser/input';
import { tableControlFrame } from '@saad5400/midad/browser/view';
import { importDocument } from '@saad5400/midad/document';
import type { ScenePage } from '@saad5400/midad/layout';
import { expect, it } from 'vitest';

const documentFixture = () =>
    importDocument(
        {
            type: 'doc',
            content: [
                {
                    type: 'table',
                    attrs: { id: 'table' },
                    content: [
                        {
                            type: 'tableRow',
                            attrs: { id: 'row' },
                            content: ['a', 'b'].map((id) => ({
                                type: 'tableCell',
                                attrs: { id },
                                content: [
                                    {
                                        type: 'paragraph',
                                        attrs: { id: `${id}-p` },
                                        content: [{ type: 'text', text: id }],
                                    },
                                ],
                            })),
                        },
                    ],
                },
            ],
        },
        'table-controls',
    );
const target: TableControlTarget = { tableId: 'table', cellId: 'a', rowId: 'row' };

it('describes complete menus without requiring a renderer, locale or icon package', () => {
    const state = {
        orientation: 'row' as const,
        rowIndex: 0,
        colIndex: 0,
        rowCount: 2,
        colCount: 2,
        locked: false,
        cellCount: 1,
        hasMergedCell: false,
    };
    expect(tableControlMenu(state).map((group) => group.map((item) => item.id))).toEqual([
        ['header-toggle'],
        ['move-back', 'move-forward'],
        ['insert-before', 'insert-after'],
        ['alignment', 'color-text', 'color-background', 'clear'],
        ['duplicate', 'delete'],
    ]);
    expect(tableControlMenu({ ...state, orientation: 'table', locked: true })).toEqual([[{ id: 'table-lock' }]]);
});

it('applies row styling and duplication through the reusable controller', () => {
    const source = documentFixture();
    const styled = applyTableControlAction(source, target, 'row', 'color-background', null, '#ff0000')!;
    expect(
        styled.document.root.children![0].children![0].children!.every(
            (cell) => cell.attributes?.backgroundColor === '#ff0000',
        ),
    ).toBe(true);
    const duplicated = applyTableControlAction(styled.document, target, 'row', 'duplicate', null)!;
    expect(duplicated.document.root.children![0].children).toHaveLength(2);
    expect(duplicated.reveal).toBe(true);
});

it('projects controls using actual page bounds and follows backward cell-selection direction', () => {
    const source = documentFixture();
    const cells = { tableId: 'table', anchorId: 'b', focusId: 'a' };
    const selection = tableControlSelection(source, cells)!;
    const page: ScenePage = {
        width: 200,
        height: 300,
        commands: [],
        lines: [],
        cells: ['a', 'b'].map((id, index) => ({
            tableId: 'table',
            cellId: id,
            x: 20 + index * 60,
            y: 20,
            width: 60,
            height: 30,
            tableX: 20,
            columnEdges: [0, 60, 120],
            direction: 'ltr',
        })),
        tableRows: [{ tableId: 'table', rowId: 'row', rowIndex: 0, x: 20, y: 20, width: 120, height: 30, ends: true }],
    };
    const frame = tableControlFrame({
        document: source,
        page,
        target,
        bounds: { left: 100, top: 200, width: 400, height: 450 },
        viewport: { left: 0, top: 0, right: 1000, bottom: 1000 },
        selection,
    })!;
    expect(frame.table).toEqual({ left: 140, top: 230, width: 240, height: 45 });
    expect(frame.gripRight).toBe(false);
});

it('cancels deferred focus after an outside pointer/focus intent and after disposal', () => {
    const owner = document.createElement('div'),
        inside = document.createElement('button'),
        outside = document.createElement('input');
    owner.append(inside);
    document.body.append(owner, outside);
    const intent = new SurfaceFocusIntent((target) => target instanceof Node && owner.contains(target));
    try {
        const first = intent.capture();
        inside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(intent.current(first)).toBe(true);
        outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(intent.current(first)).toBe(false);
        const second = intent.capture();
        outside.focus();
        expect(intent.current(second)).toBe(false);
        const disposed = intent.capture();
        intent.dispose();
        expect(intent.current(disposed)).toBe(false);
    } finally {
        intent.dispose();
        owner.remove();
        outside.remove();
    }
});
