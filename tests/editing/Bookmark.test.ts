import { importDocument } from '@saad5400/midad/document';
import {
    captureCommandBookmark,
    commandBookmarkValid,
    commandTrigger,
    replaceInlineText,
} from '@saad5400/midad/editing';
import { describe, expect, it } from 'vitest';
const source = (text = 'Hello') =>
    importDocument(
        { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'p' }, content: [{ type: 'text', text }] }] },
        'bookmark',
    );
const at = (offset: number) => ({ anchor: { blockId: 'p', offset }, focus: { blockId: 'p', offset } });

describe('portable command bookmarks', () => {
    it('snapshots mutable host selection, target and marks without changing the source document', () => {
        const document = source(),
            selection = at(2),
            target = { containerId: document.root.id },
            marks = [{ kind: 'textStyle', attributes: { fontFamily: 'Arial' } }];
        const bookmark = captureCommandBookmark({ document, selection, target, marks });
        selection.focus.offset = 4;
        target.containerId = 'different';
        marks[0].attributes.fontFamily = 'Amiri';
        expect(bookmark.selection?.focus.offset).toBe(2);
        expect(bookmark.target?.containerId).toBe(document.root.id);
        expect(bookmark.marks?.[0].attributes?.fontFamily).toBe('Arial');
        expect(bookmark.document).toBe(document);
    });
    it('accepts save acknowledgements but rejects changed text, removed nodes and other documents', () => {
        const document = source(),
            bookmark = captureCommandBookmark({ document, selection: at(2) });
        expect(
            commandBookmarkValid(
                { ...document, revision: 1, root: { ...document.root, attributes: { acknowledged: true } } },
                bookmark,
            ),
        ).toBe(true);
        expect(
            commandBookmarkValid(
                replaceInlineText(document, { blockId: 'p', from: 0, to: 1, text: 'N', expectedRevision: 0 }),
                bookmark,
            ),
        ).toBe(false);
        expect(commandBookmarkValid(importDocument({ type: 'doc' }, document.id), bookmark)).toBe(false);
        expect(commandBookmarkValid({ ...document, id: 'other' }, bookmark)).toBe(false);
    });
    it('validates live query text through unrelated acknowledgements and rejects changed queries', () => {
        const document = source('/library'),
            selection = at(8),
            trigger = commandTrigger(document, selection)!;
        const bookmark = captureCommandBookmark({ document, selection, trigger });
        expect(commandBookmarkValid({ ...document, revision: 2 }, bookmark)).toBe(true);
        expect(commandBookmarkValid(source('/changed'), bookmark)).toBe(false);
        expect(commandBookmarkValid({ ...document, revision: -1 }, bookmark)).toBe(false);
    });
    it('rejects broken structural writing anchors and unavailable containers', () => {
        const document = importDocument(
            { type: 'doc', content: [{ type: 'horizontalRule', attrs: { id: 'rule' } }] },
            'structure',
        );
        const bookmark = captureCommandBookmark({
            document,
            selection: null,
            target: { containerId: document.root.id, afterId: 'rule' },
        });
        expect(commandBookmarkValid(document, bookmark)).toBe(true);
        expect(commandBookmarkValid(importDocument({ type: 'doc' }, document.id), bookmark)).toBe(false);
        expect(commandBookmarkValid(document, { ...bookmark, target: { containerId: 'rule' } })).toBe(false);
        const frozen = importDocument({ type: 'doc', content: [{ type: 'pdfPage' }] }, 'frozen');
        expect(commandBookmarkValid(frozen, captureCommandBookmark({ document: frozen, selection: null }))).toBe(false);
    });
    it('keeps object validation with the host and rejects stale active-object identity', () => {
        const document = source(),
            bookmark = captureCommandBookmark({ document, selection: at(0), objectId: 'floating-widget' });
        expect(commandBookmarkValid(document, bookmark, 'floating-widget')).toBe(true);
        expect(commandBookmarkValid(document, bookmark, 'other')).toBe(false);
        expect(commandBookmarkValid(document, bookmark)).toBe(false);
    });
    it('rejects invalid grapheme boundaries and selections that leave their captured scope', () => {
        const document = source('a\u0301b');
        expect(commandBookmarkValid(document, captureCommandBookmark({ document, selection: at(1) }))).toBe(false);
        expect(commandBookmarkValid(document, captureCommandBookmark({ document, selection: at(2) }))).toBe(true);
        expect(
            commandBookmarkValid(
                document,
                captureCommandBookmark({ document, selection: { ...at(2), scopeId: 'missing' } }),
            ),
        ).toBe(false);
        expect(commandBookmarkValid(document, captureCommandBookmark({ document, selection: at(100) }))).toBe(false);
    });
});
