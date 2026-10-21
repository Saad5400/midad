import { LiveTemplateController } from '@saad5400/midad/browser';
import { applyDocumentCommand } from '@saad5400/midad/content/commands';
import { importDocument } from '@saad5400/midad/document';
import { replaceInlineText } from '@saad5400/midad/editing';
import { describe, expect, it } from 'vitest';

describe('live document placeholders', () => {
    it('tracks replacement lengths and traverses, backtracks and finishes without changing the document', () => {
        const document = importDocument({ type: 'doc' }, 'template');
        const inserted = applyDocumentCommand(document, null, {
            kind: 'clause',
            placeholder: { title: 'Title', body: 'Content' },
        })!;
        const controller = new LiveTemplateController();
        const selected = controller.start(inserted.document, inserted.template!)!;
        const first = selected.focus.blockId;
        const changed = replaceInlineText(inserted.document, {
            blockId: first,
            from: 0,
            to: 5,
            text: 'عنوان جديد',
            expectedRevision: inserted.document.revision,
        });
        controller.update(inserted.document, changed);
        expect(controller.entries[0].to).toBe('عنوان جديد'.length);
        const next = controller.key({ key: 'Enter' }).selection!;
        expect(next.anchor.blockId).not.toBe(first);
        expect(controller.key({ key: 'Tab', shiftKey: true }).selection?.focus.offset).toBe('عنوان جديد'.length);
        expect(controller.key({ key: 'Enter', isComposing: true }).handled).toBe(false);
        controller.key({ key: 'Tab' });
        const end = controller.key({ key: 'Tab' }).selection!;
        expect(end.anchor).toEqual(end.focus);
        expect(controller.active).toBe(false);
    });
    it('cancels on outside selection, removed content and Escape while preserving the text', () => {
        const document = importDocument(
            {
                type: 'doc',
                content: [
                    { type: 'paragraph', attrs: { id: 'p' }, content: [{ type: 'text', text: 'Placeholder suffix' }] },
                ],
            },
            'template',
        );
        const controller = new LiveTemplateController();
        const ranges = [{ id: 'one', blockId: 'p', from: 0, to: 11 }];
        controller.start(document, ranges);
        controller.changed({ anchor: { blockId: 'p', offset: 15 }, focus: { blockId: 'p', offset: 15 } });
        expect(controller.active).toBe(false);
        controller.start(document, ranges);
        controller.key({ key: 'Escape' });
        expect(controller.active).toBe(false);
        controller.start(document, ranges);
        controller.update(document, importDocument({ type: 'doc' }, 'template'));
        expect(controller.active).toBe(false);
        expect(document.root.children![0].children![0].text).toBe('Placeholder suffix');
    });
});
