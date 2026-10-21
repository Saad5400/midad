import { DocumentCommandController } from '@saad5400/midad/browser';
import { importDocument } from '@saad5400/midad/document';
import { describe, expect, it } from 'vitest';
const source = (id = 'command', text = '/library') =>
    importDocument(
        { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'p' }, content: [{ type: 'text', text }] }] },
        id,
    );
const at = (offset: number) => ({ anchor: { blockId: 'p', offset }, focus: { blockId: 'p', offset } });
describe('document command lifecycle', () => {
    it('retains trigger identity while unchanged and refreshes when the document identity changes', () => {
        let document = source();
        const controller = new DocumentCommandController({ document: () => document, selection: () => at(8) });
        controller.refresh();
        const first = controller.trigger;
        controller.refresh();
        expect(controller.trigger).toBe(first);
        document = source('replacement');
        controller.refresh();
        expect(controller.trigger?.documentId).toBe('replacement');
        expect(controller.trigger).not.toBe(first);
    });
    it('hides for composition/disabled controls while preserving explicit dismissal until the trigger is left', () => {
        const document = source();
        let enabled = true,
            position = 8;
        const controller = new DocumentCommandController({
            document: () => document,
            selection: () => at(position),
            enabled: () => enabled,
        });
        controller.refresh();
        controller.hide();
        expect(controller.trigger).toBeUndefined();
        controller.refresh();
        expect(controller.trigger).toBeDefined();
        controller.dismiss();
        controller.refresh();
        expect(controller.trigger).toBeUndefined();
        position = 0;
        controller.refresh();
        position = 8;
        controller.refresh();
        expect(controller.trigger).toBeDefined();
        enabled = false;
        controller.refresh();
        expect(controller.trigger).toBeUndefined();
        enabled = true;
        controller.refresh();
        expect(controller.trigger).toBeDefined();
    });
    it('keeps arbitrary deferred action kinds and captured targets through a save acknowledgement', () => {
        let document = source();
        let selection = at(8);
        const controller = new DocumentCommandController<'asset-picker' | 'catalog'>({
            document: () => document,
            selection: () => selection,
        });
        controller.refresh();
        const context = controller.context(true);
        controller.dismiss();
        controller.beginPending('catalog', context);
        selection = at(0);
        document = { ...document, revision: 1, root: { ...document.root, attributes: { acknowledged: true } } };
        expect(controller.valid(controller.pending!.context)).toBe(true);
        expect(controller.pending?.context.selection?.focus.offset).toBe(8);
        controller.endPending('asset-picker');
        expect(controller.pending?.kind).toBe('catalog');
        controller.endPending('catalog');
        expect(controller.pending).toBeUndefined();
        controller.beginPending('catalog', context);
        controller.reset();
        controller.refresh();
        expect(controller.pending).toBeUndefined();
    });
    it('delegates menu keys and preserves ordinary editor shortcuts and composition', () => {
        const document = source();
        const controller = new DocumentCommandController({ document: () => document, selection: () => at(8) });
        let prevented = false;
        const event = {
            key: 'Enter',
            preventDefault: () => {
                prevented = true;
            },
        };
        controller.refresh();
        expect(controller.key({ ...event, isComposing: true })).toBe(false);
        expect(controller.key(event, () => true)).toBe(true);
        expect(controller.trigger).toBeDefined();
        expect(controller.key({ ...event, key: 'c', ctrlKey: true })).toBe(false);
        expect(controller.trigger).toBeUndefined();
        controller.reset();
        controller.refresh();
        expect(controller.key({ ...event, key: 'Escape' })).toBe(true);
        expect(prevented).toBe(true);
    });
    it('aborts deferred work on cancellation, replacement and reset without changing the document', () => {
        const document = source(),
            controller = new DocumentCommandController({ document: () => document, selection: () => at(8) });
        const context = controller.context();
        controller.beginPending('catalog', context);
        const first = controller.pending!;
        controller.beginPending('asset', context);
        expect(first.signal.aborted).toBe(true);
        const second = controller.pending!;
        controller.endPending('catalog');
        expect(second.signal.aborted).toBe(false);
        controller.endPending('asset');
        expect(second.signal.aborted).toBe(true);
        controller.beginPending('catalog', context);
        const third = controller.pending!;
        controller.reset();
        expect(third.signal.aborted).toBe(true);
        expect(document.root.children![0].children![0].text).toBe('/library');
    });
});
