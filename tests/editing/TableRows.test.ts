import { DocumentSession, exportDocument, findNode, importDocument } from '@saad5400/midad/document';
import { setTableRowHeight } from '@saad5400/midad/editing';
import { expect, it } from 'vitest';

const fixture = () =>
    importDocument(
        {
            type: 'doc',
            content: [
                {
                    type: 'table',
                    attrs: { id: 'table' },
                    content: [
                        {
                            type: 'tableRowGroup',
                            attrs: { id: 'group' },
                            content: [
                                {
                                    type: 'tableRow',
                                    attrs: { id: 'row', retained: 'custom' },
                                    content: [
                                        {
                                            type: 'tableCell',
                                            content: [
                                                { type: 'paragraph', content: [{ type: 'text', text: 'Keep me' }] },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        'row-height',
    );

it('edits a grouped row height, retains metadata, round trips and restores with history', () => {
    const source = fixture();
    const session = new DocumentSession(source);
    const next = setTableRowHeight(source, 'table', 'row', 192);
    expect(findNode(next, 'row')!.attributes).toMatchObject({ retained: 'custom', rowHeight: 192 });
    expect(importDocument(exportDocument(next), next.id).root).toEqual(next.root);
    session.commit(next);
    session.undo();
    expect(session.document.root).toEqual(source.root);
    session.redo();
    expect(session.document.root).toEqual(next.root);
    expect(setTableRowHeight(next, 'table', 'row', 192)).toBe(next);
    expect(findNode(setTableRowHeight(next, 'table', 'row', null), 'row')!.attributes?.rowHeight).toBeUndefined();
});

it.each([-1, NaN, Infinity, 100001])('rejects an invalid row height without changing the source: %s', (height) => {
    const source = fixture();
    expect(() => setTableRowHeight(source, 'table', 'row', height)).toThrow('Invalid table row height');
    expect(findNode(source, 'row')!.attributes?.rowHeight).toBeUndefined();
});

it('rejects stale table or row identities and never edits a different table', () => {
    const source = fixture();
    expect(() => setTableRowHeight(source, 'missing', 'row', 100)).toThrow('table no longer exists');
    expect(() => setTableRowHeight(source, 'table', 'missing', 100)).toThrow('row no longer exists');
});
