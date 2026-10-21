import { exportDocument, importDocument } from '@saad5400/midad/document';
import { initialTextCaret, keyboardShortcut, SelectionController } from '@saad5400/midad/interaction';
import type { DocumentScene } from '@saad5400/midad/layout';
import { NativeNavigation } from '@saad5400/midad/navigation';
import { selectedText } from '@saad5400/midad/selection';
import type { CanvasKit } from 'canvaskit-wasm';
import { describe, expect, it } from 'vitest';

const paragraph = (id: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text: id }] });
const caret = (blockId: string) => ({ anchor: { blockId, offset: 0 }, focus: { blockId, offset: 0 } });
const document = () =>
    importDocument(
        {
            type: 'doc',
            content: [
                paragraph('before'),
                {
                    type: 'parallelRow',
                    content: [
                        {
                            type: 'parallelCell',
                            attrs: { id: 'ar', lang: 'ar' },
                            content: [paragraph('ar-one'), paragraph('ar-two')],
                        },
                        { type: 'parallelCell', attrs: { id: 'en', lang: 'en' }, content: [paragraph('en-one')] },
                    ],
                },
                {
                    type: 'table',
                    attrs: { id: 'table' },
                    content: [
                        {
                            type: 'tableRow',
                            content: [
                                { type: 'tableCell', attrs: { id: 'cell-a' }, content: [paragraph('cell-a-text')] },
                                { type: 'tableCell', attrs: { id: 'cell-b' }, content: [paragraph('cell-b-text')] },
                            ],
                        },
                    ],
                },
                paragraph('after'),
            ],
        },
        'interaction',
    );

describe('standalone editor interaction state', () => {
    it('selects the current language first, then the document, without editing either', () => {
        const doc = document(),
            before = exportDocument(doc),
            controller = new SelectionController();
        const first = controller.selectAll(doc, caret('ar-one'))!;
        expect(first.scopeId).toBe('ar');
        expect(selectedText(doc, first)).toBe('ar-one\nar-two');
        const second = controller.selectAll(doc, first)!;
        expect(second.scopeId).toBe(doc.root.id);
        expect(selectedText(doc, second)).toContain('before\nar-one\nar-two\nen-one');
        expect(exportDocument(doc)).toEqual(before);
        expect(doc.revision).toBe(0);
    });
    it('escalates a table cell selection to its whole table and then the document', () => {
        const doc = document(),
            controller = new SelectionController();
        const first = controller.selectAll(
            doc,
            controller.cells(doc, {
                tableId: 'table',
                anchorId: 'cell-a',
                focusId: 'cell-a',
            })!,
        )!;
        expect(first.cells).toEqual({ tableId: 'table', anchorId: 'cell-a', focusId: 'cell-b' });
        expect(selectedText(doc, first)).toBe('cell-a-text\tcell-b-text');
        const second = controller.selectAll(doc, first)!;
        expect(second.scopeId).toBe(doc.root.id);
        expect(second.cells).toBeUndefined();
    });
    it.each(['ltr', 'rtl'] as const)(
        'navigates and extends table cells in physical %s arrow direction',
        (direction) => {
            const doc = document(),
                controller = new SelectionController();
            const scene = {
                documentId: doc.id,
                revision: 0,
                fontHash: '',
                margin: 0,
                glyphCount: 0,
                pages: [{ width: 500, height: 700, lines: [], commands: [], cells: [{ tableId: 'table', direction }] }],
            } as unknown as DocumentScene;
            const navigation = new NativeNavigation(doc, scene, {} as CanvasKit);
            const first = controller.cells(doc, { tableId: 'table', anchorId: 'cell-a', focusId: 'cell-a' })!;
            const result = controller.navigate(
                {
                    key: direction === 'ltr' ? 'ArrowRight' : 'ArrowLeft',
                    ctrlKey: false,
                    altKey: false,
                    metaKey: false,
                    shiftKey: true,
                },
                navigation,
                first,
            )!;
            expect(result.selection?.cells).toEqual({ tableId: 'table', anchorId: 'cell-a', focusId: 'cell-b' });
        },
    );
    it('restarts scoped selection after moving to another language or collapsing the previous range', () => {
        const doc = document(),
            controller = new SelectionController();
        expect(controller.selectAll(doc, caret('ar-one'))?.scopeId).toBe('ar');
        const other = controller.selectAll(doc, caret('en-one'))!;
        expect(other.scopeId).toBe('en');
        expect(controller.selectAll(doc, other)?.scopeId).toBe(doc.root.id);
        expect(controller.selectAll(doc, caret('ar-two'))?.scopeId).toBe('ar');
    });
    it('chooses a rendered text position without mutating an empty or hidden document', () => {
        const doc = document();
        const scene = {
            pages: [{ lines: [{ paragraphId: 'missing' }, { paragraphId: 'en-one' }] }],
        } as unknown as DocumentScene;
        expect(initialTextCaret(doc, scene)).toEqual({ blockId: 'en-one', offset: 0 });
        const empty = importDocument({ type: 'doc' }, 'empty'),
            before = exportDocument(empty);
        expect(initialTextCaret(empty, { pages: [{ lines: [] }] } as unknown as DocumentScene)).toBeUndefined();
        expect(exportDocument(empty)).toEqual(before);
    });
    it('starts in the visible continued line while skipping a non-editable clause prefix', () => {
        const doc = document();
        const scene = {
            pages: [
                { lines: [{ paragraphId: 'before' }] },
                {
                    lines: [
                        {
                            paragraphId: 'en-one',
                            originalTop: 20,
                            shaped: {
                                sources: [{ nodeId: 'en-one', editable: false, to: 3 }],
                                lines: [{ top: 20, start: 7 }],
                            },
                        },
                    ],
                },
            ],
        } as unknown as DocumentScene;
        expect(initialTextCaret(doc, scene, 1)).toEqual({ blockId: 'en-one', offset: 4 });
    });
    it('resolves physical shortcuts in another keyboard language and falls back to key names', () => {
        expect(keyboardShortcut({ key: 'لا', code: 'KeyB' })).toBe('b');
        expect(keyboardShortcut({ key: 'A' })).toBe('a');
        expect(keyboardShortcut({ key: 'Enter', code: 'Enter' })).toBe('enter');
    });
});
