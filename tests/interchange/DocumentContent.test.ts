import { DocumentContentController } from '@saad5400/midad/interchange/fragment';
import { expect, it } from 'vitest';

const original = {
    type: 'doc',
    attrs: {
        pageLayout: { orientation: 'landscape', margins: { top: 48 }, overrides: { 2: { orientation: 'portrait' } } },
        custom: 'retained',
    },
    content: [{ type: 'paragraph', attrs: { id: 'paragraph' }, content: [{ type: 'text', text: 'Original' }] }],
};
it.each([false, true])('preserves full-document metadata and encoded format: %s', (encoded) => {
    const input = encoded ? JSON.stringify(original) : original;
    const controller = new DocumentContentController(input);
    expect(controller.source()).toEqual(original);
    const edited = {
        ...original,
        attrs: { ...original.attrs, pageLayout: { ...original.attrs.pageLayout, background: { color: '#ffffff' } } },
    };
    const output = controller.publish(edited);
    expect(typeof output).toBe(encoded ? 'string' : 'object');
    expect(encoded ? JSON.parse(output as string) : output).toEqual(edited);
    expect(controller.accept(output)).toBe(false);
    expect(controller.source()).toEqual(edited);
    expect(controller.accept(input)).toBe(true);
    expect(controller.source()).toEqual(original);
    expect(original.attrs.custom).toBe('retained');
});
it.each([null, undefined, [], JSON.stringify([])])('provides a writable empty document for %j', (value) => {
    const controller = new DocumentContentController(value);
    expect(controller.source()).toMatchObject({ type: 'doc', content: [{ type: 'paragraph' }] });
});
it('refuses malformed external data without changing the accepted document', () => {
    const controller = new DocumentContentController(original);
    expect(() => controller.accept('{broken')).toThrow();
    expect(controller.source()).toEqual(original);
});
