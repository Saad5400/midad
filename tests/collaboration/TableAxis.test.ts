import { SharedNativeDocument } from '@saad5400/midad/collaboration';
import { exportDocument, findNode, importDocument } from '@saad5400/midad/document';
import { blockText, replaceInlineText, tableAxisCommand, tableGrid } from '@saad5400/midad/editing';
import { expect, it } from 'vitest';

const fixture = () =>
    importDocument(
        {
            type: 'doc',
            content: [
                {
                    type: 'table',
                    attrs: { id: 'table' },
                    content: ['a', 'b', 'c'].map((id) => ({
                        type: 'tableRow',
                        attrs: { id: `row-${id}` },
                        content: [
                            {
                                type: 'tableCell',
                                attrs: { id: `cell-${id}` },
                                content: [{ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text: id }] }],
                            },
                        ],
                    })),
                },
            ],
        },
        'shared-table',
    );
it.each(['moveAfter', 'duplicate', 'header'] as const)(
    'converges a table %s with concurrent peer typing and delayed delivery',
    (command) => {
        const source = SharedNativeDocument.create(fixture());
        const peers = [0, 1, 2].map(() => SharedNativeDocument.fromState(source.state(), source.document().id));
        source.destroy();
        try {
            const edited = tableAxisCommand(peers[0].document(), 'table', 'row', 0, command)!;
            peers[0].publish(edited.document);
            const before = peers[1].document();
            peers[1].publish(
                replaceInlineText(before, {
                    blockId: 'b',
                    from: 1,
                    to: 1,
                    text: ' peer',
                    expectedRevision: before.revision,
                }),
            );
            for (let round = 0; round < 2; round++)
                for (const from of peers) for (const to of peers) if (from !== to) to.receive(from.state(to.vector()));
            const snapshots = peers.map((peer) => exportDocument(peer.document()));
            expect(snapshots[1]).toEqual(snapshots[0]);
            expect(snapshots[2]).toEqual(snapshots[0]);
            expect(blockText(findNode(peers[0].document(), 'b')!)).toBe('b peer');
            const grid = tableGrid(findNode(peers[0].document(), 'table')!);
            expect(grid.rows).toHaveLength(command === 'duplicate' ? 4 : 3);
            if (command === 'moveAfter')
                expect(grid.rows.map((row) => row.node.id)).toEqual(['row-b', 'row-a', 'row-c']);
        } finally {
            peers.forEach((peer) => peer.destroy());
        }
    },
);
