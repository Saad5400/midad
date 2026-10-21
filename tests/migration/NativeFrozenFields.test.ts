// @vitest-environment node
import { exportDocument, importDocument } from '@saad5400/midad/document';
import { fieldAppearancePage } from '@saad5400/midad/field-appearance';
import { FrozenFieldSession } from '@saad5400/midad/frozen-fields';
import { NativeTextKernel } from '@saad5400/midad/kernel';
import { paintPage } from '@saad5400/midad/paint';
import CanvasKitInit from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const create = () =>
    importDocument(
        {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'Before ' },
                        {
                            type: 'variable',
                            attrs: {
                                id: 'mine',
                                type: 'text',
                                name: 'اسمي',
                                settings: { fontFamily: 'Amiri', fontSize: '18px', direction: 'rtl', required: true },
                            },
                        },
                        {
                            type: 'variable',
                            attrs: { id: 'other', type: 'text', name: 'Other', settings: { direction: 'ltr' } },
                        },
                        { type: 'variable', attrs: { id: 'baked', type: 'text', name: 'Baked', value: 'Fixed' } },
                        { type: 'text', text: ' after' },
                    ],
                },
            ],
        },
        'frozen',
    );
const boxes = [
    { id: 'mine', page: 1, x: 30, y: 40, width: 180, height: 40 },
    { id: 'other', page: 2, x: 80, y: 90, width: 180, height: 40 },
    { id: 'baked', page: 1, x: 30, y: 100, width: 180, height: 40 },
];
const pages = [
    { width: 600, height: 800 },
    { width: 600, height: 800 },
];

describe('frozen PDF field sessions', () => {
    let kernel: NativeTextKernel;
    beforeAll(async () => {
        const options = {
            wasmBinary: new Uint8Array(await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm'))),
        };
        kernel = await NativeTextKernel.withAssets(
            await CanvasKitInit(options as NonNullable<Parameters<typeof CanvasKitInit>[0]>),
            async (font) => new Uint8Array(await readFile(`assets/fonts/${font}.ttf`)),
            async () => {
                throw new Error('Unexpected image');
            },
        );
    });
    afterAll(() => kernel.destroy());
    it('changes only pending assigned values while preserving every authored node and rectangle', () => {
        const document = create(),
            before = exportDocument(document);
        const session = new FrozenFieldSession(document, boxes, pages, ['mine']);
        session.setValue('mine', 'قيمة عربية ABC');
        expect(session.value('mine')).toBe('قيمة عربية ABC');
        expect(session.valuesForSubmit()).toEqual({ mine: 'قيمة عربية ABC' });
        expect(exportDocument(document)).toEqual(before);
        expect(session.fields.map((entry) => entry.box)).toEqual(boxes);
        expect(Object.isFrozen(session.fields[0].box)).toBe(true);
        const attrs = session.attributes('mine');
        expect(() => {
            (attrs.settings as Record<string, unknown>).fontSize = '90px';
        }).toThrow();
        expect((session.attributes('mine').settings as Record<string, unknown>).fontSize).toBe('18px');
        session.setValue('mine', '');
        expect(session.value('mine')).toBe('');
    });
    it('refuses foreign, absent, already painted and locked fields', () => {
        const session = new FrozenFieldSession(create(), boxes, pages, ['mine', 'baked'], ['mine']);
        for (const id of ['mine', 'other', 'missing', 'baked'])
            expect(() => session.setValue(id, 'Change')).toThrow('cannot be changed');
        expect(session.valuesForSubmit()).toEqual({});
    });
    it.each([
        { id: 'mine', page: 0, x: 30, y: 40, width: 180, height: 40 },
        { id: 'mine', page: 3, x: 30, y: 40, width: 180, height: 40 },
        { id: 'mine', page: 1, x: -1, y: 40, width: 180, height: 40 },
        { id: 'mine', page: 1, x: 30, y: 790, width: 180, height: 40 },
        { id: 'mine', page: 1, x: 30, y: 40, width: NaN, height: 40 },
        { id: 'unknown', page: 1, x: 30, y: 40, width: 180, height: 40 },
    ])('rejects an inconsistent frozen box %#', (box) => {
        expect(() => new FrozenFieldSession(create(), [box], pages, ['mine'])).toThrow();
    });
    it('rejects duplicate boxes and absent editable IDs instead of choosing an ambiguous target', () => {
        expect(() => new FrozenFieldSession(create(), [boxes[0], boxes[0]], pages, ['mine'])).toThrow();
        expect(() => new FrozenFieldSession(create(), boxes, pages, ['missing'])).toThrow('missing');
    });
    it('uses exactly the appearance commands used by PDF field filling', async () => {
        const session = new FrozenFieldSession(create(), boxes, pages, ['mine']);
        session.setValue('mine', 'الاسم Name 123');
        await kernel.prepare(session.previewDocument());
        const actual = session.appearance('mine', kernel, new Set());
        const expected = fieldAppearancePage('mine', session.attributes('mine'), 180, 40, kernel, new Set());
        expect(actual.page.commands).toEqual(expected.commands);
        expect(actual.field).toEqual(boxes[0]);
        expect(actual.page.commands.some((command) => command.kind === 'clipStart')).toBe(true);
    });
    it('shows the uploaded attachment filename instead of its label', () => {
        const document = importDocument(
            {
                type: 'doc',
                attrs: { blockVariables: [{ id: 'file', type: 'attachment', name: 'Attachment label' }] },
                content: [{ type: 'paragraph' }],
            },
            'attachment',
        );
        const session = new FrozenFieldSession(document, [{ ...boxes[0], id: 'file' }], pages, ['file']);
        session.setValue('file', 'مرفق العقد.txt');
        expect((session.attributes('file').settings as Record<string, unknown>).filename).toBe('مرفق العقد.txt');
    });
    it.each(['signature', 'initials', 'stamp'])(
        'fits the final %s image without adding a second reference caption',
        (type) => {
            const document = importDocument(
                {
                    type: 'doc',
                    attrs: { blockVariables: [{ id: 'image', type, name: type, reference_id: 'REF-123' }] },
                    content: [{ type: 'paragraph' }],
                },
                'image',
            );
            const session = new FrozenFieldSession(document, [{ ...boxes[0], id: 'image' }], pages, ['image']);
            session.setValue('image', 'blob:local-image', true);
            expect(session.attributes('image').reference_id).toBeNull();
        },
    );
    it('clears the overlay to transparent without erasing the underlying PDF', async () => {
        const session = new FrozenFieldSession(create(), boxes, pages, ['mine']);
        session.setValue('mine', 'Preview');
        await kernel.prepare(session.previewDocument());
        const page = session.appearance('mine', kernel, new Set()).page;
        const surface = kernel.ck.MakeSurface(180, 40)!;
        try {
            paintPage(kernel, surface, page, 1, true);
            const snapshot = surface.makeImageSnapshot();
            try {
                const pixels = snapshot.readPixels(0, 0, {
                    width: 180,
                    height: 40,
                    colorType: kernel.ck.ColorType.RGBA_8888,
                    alphaType: kernel.ck.AlphaType.Unpremul,
                    colorSpace: kernel.ck.ColorSpace.SRGB,
                })!;
                expect(pixels[3]).toBe(0);
                expect(Array.from(pixels).some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
            } finally {
                snapshot.delete();
            }
        } finally {
            surface.dispose();
        }
    });
});
