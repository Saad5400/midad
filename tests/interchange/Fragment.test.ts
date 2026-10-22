import { describe, expect, it } from 'vitest';
import {
    FragmentContentController,
    fragmentContent,
    fragmentSource,
    fragmentIsEmpty,
} from '@saad5400/midad/interchange/fragment';

const body = [
    {
        type: 'paragraph',
        attrs: { id: 'paragraph' },
        content: [
            { type: 'text', text: 'مرحبا Hello', marks: [{ type: 'bold' }] },
            {
                type: 'variable',
                attrs: { id: 'field', nativeId: 'field-native', name: 'Client', type: 'text', value: '' },
            },
            { type: 'image', attrs: { id: 'image', src: 'media-id', attachmentId: 'attachment' } },
        ],
    },
];
const original = { type: 'doc', attrs: { custom: 'keep' }, content: body };
describe('embedded rich fragments', () => {
    it.each([original, body, JSON.stringify(original), JSON.stringify(body)])(
        'round-trips the original storage envelope and semantic identities',
        (value) => {
            const visible = fragmentSource(value, 'ltr');
            expect(visible.attrs).toMatchObject({ dir: 'ltr', nativePresentation: { cover: { enabled: false } } });
            const output = fragmentContent(visible, value);
            expect(output).toEqual(value);
            expect(JSON.stringify(output)).toContain('field-native');
            expect(JSON.stringify(output)).toContain('attachment');
        },
    );
    it('restores original root layout and preserves body formatting changes and new identities', () => {
        const value = {
            ...original,
            attrs: {
                dir: 'rtl',
                pageLayout: { orientation: 'landscape' },
                nativePresentation: { cover: { enabled: true } },
                nativeId: 'root',
            },
        };
        const edited = structuredClone(fragmentSource(value));
        (edited.content as typeof body)[0].content.push({ type: 'text', text: 'new' } as never);
        const output = fragmentContent(edited, value) as typeof value;
        expect(output.attrs).toEqual(value.attrs);
        expect(output.content[0].content.at(-1)).toEqual({ type: 'text', text: 'new' });
        expect(value.content[0].content.at(-1)?.type).toBe('image');
    });
    it('ignores own acknowledgements but applies explicit resets to a previous value', () => {
        const controller = new FragmentContentController(original);
        const visible = structuredClone(controller.source());
        (visible.content as typeof body)[0].content[0].text = 'updated';
        const published = controller.publish(visible);
        expect(controller.accept(JSON.parse(JSON.stringify(published)))).toBe(false);
        expect(controller.accept(original)).toBe(true);
        expect(controller.accept(original)).toBe(false);
    });
    it('snapshots inputs and retains encoded empty document envelopes', () => {
        const value = structuredClone(original),
            controller = new FragmentContentController(value);
        value.attrs.custom = 'mutated';
        expect((controller.source().attrs as Record<string, unknown>).custom).toBe('keep');
        expect(typeof fragmentContent(fragmentSource('null'), 'null')).toBe('string');
        expect(fragmentSource(null).content).toEqual([]);
    });
    it('recognizes blank and structured content across all storage envelopes', () => {
        expect(fragmentIsEmpty(null)).toBe(true);
        expect(fragmentIsEmpty([{ type: 'paragraph', content: [{ type: 'text', text: '  ' }] }])).toBe(true);
        expect(fragmentIsEmpty(JSON.stringify(original))).toBe(false);
        for (const type of ['image', 'variable', 'table', 'parallelRow', 'horizontalRule'])
            expect(fragmentIsEmpty([{ type }])).toBe(false);
    });
    it.each(['{broken', '<p>HTML</p>', { invalid: true }, { type: 'doc', content: 'invalid' }])(
        'refuses malformed data instead of replacing it with an empty document',
        (value) => {
            expect(() => fragmentSource(value)).toThrow();
        },
    );
});
