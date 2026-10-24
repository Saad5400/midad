// @vitest-environment node
import { exportDocument, importDocument } from '@saad5400/midad/document';
import { fieldAppearancePage } from '@saad5400/midad/pdf';
import { writeScenePdf } from '@saad5400/midad/pdf';
import { FrozenFieldSession } from '@saad5400/midad/pdf';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import { paintPage } from '@saad5400/midad/rendering';
import CanvasKitInit from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LAB_IMAGE } from '../fixtures/migrationCorpus';
import { verifyScenePdf } from '../fixtures/pdfGeometry';

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
            async (source) => {
                if (!source.startsWith('data:image/png;base64,')) throw new Error('Unexpected image');
                return { bytes: new Uint8Array(Buffer.from(source.slice(source.indexOf(',') + 1), 'base64')) };
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
    it('retains an immutable pending document until values change', () => {
        const session = new FrozenFieldSession(create(), boxes, pages, ['mine']);
        session.setValue('mine', 'First');
        const first = session.previewDocument();
        expect(session.previewDocument()).toBe(first);
        expect(Object.isFrozen(first.root.children![0].children)).toBe(true);
        session.setValue('mine', 'Second');
        const second = session.previewDocument();
        expect(second.revision).toBeGreaterThan(first.revision);
        expect(first.root.children![0].children![0].attributes!.value).toBe('First');
        expect(second.root.children![0].children![0].attributes!.value).toBe('Second');
    });
    it.each([[], [{ width: NaN, height: 800 }], [{ width: 600, height: 0 }]].map((geometry) => ({ geometry })))(
        'rejects invalid source page geometry %#',
        ({ geometry }) => {
            expect(() => new FrozenFieldSession(create(), [], geometry, [])).toThrow('page geometry');
        },
    );
    it('places only pending appearances on their original pages and rejects stale revisions', async () => {
        const session = new FrozenFieldSession(create(), boxes, pages, ['mine', 'other']);
        session.setValue('mine', 'Pending قيمة');
        session.setValue('other', 'Other');
        await kernel.prepare(session.previewDocument());
        const local = session.appearance('mine', kernel, new Set());
        const scene = session.pendingScene(kernel);
        expect(scene.pages).toHaveLength(2);
        expect(scene.fontHash).toBe(kernel.fontHashFor(session.previewDocument()));
        expect(scene.revision).toBe(session.previewDocument().revision);
        expect(Object.isFrozen(scene.pages[0].commands)).toBe(true);
        const before = local.page.commands.find((command) => 'glyphs' in command)!;
        const after = scene.pages[0].commands.find((command) => 'glyphs' in command)!;
        if (!('glyphs' in before) || !('glyphs' in after)) throw new Error('Missing text');
        expect(after.glyphs).toEqual(before.glyphs);
        expect(after.positions).toEqual(before.positions.map((value, index) => value + (index % 2 ? 40 : 30)));
        expect(
            scene.pages[1].commands.some((command) => 'glyphs' in command && command.text.join('').includes('Other')),
        ).toBe(true);
        expect(
            scene.pages
                .flatMap((page) => page.commands)
                .some((command) => 'glyphs' in command && command.text.join('').includes('Fixed')),
        ).toBe(false);
        session.setValue('mine', 'Updated');
        await expect(writeScenePdf(scene, kernel, () => session.previewDocument())).rejects.toThrow();
    });
    it('exports pending images and marked Arabic without redrawing baked values', async () => {
        const document = importDocument(
            {
                type: 'doc',
                attrs: {
                    blockVariables: [
                        {
                            id: 'text',
                            type: 'text',
                            settings: {
                                fontFamily: 'Amiri',
                                fontSize: '20px',
                                direction: 'rtl',
                                color: '#123456',
                                underline: true,
                            },
                        },
                        { id: 'image', type: 'stamp', reference_id: 'SOURCE-REFERENCE' },
                        { id: 'baked', type: 'text', value: 'Already in the source PDF' },
                    ],
                },
                content: [{ type: 'paragraph' }],
            },
            'frozen-print',
        );
        const session = new FrozenFieldSession(
            document,
            [
                { id: 'text', page: 1, x: 30, y: 40, width: 360, height: 70 },
                { id: 'image', page: 2, x: 80, y: 90, width: 180, height: 60 },
                { id: 'baked', page: 1, x: 30, y: 180, width: 180, height: 40 },
            ],
            pages,
            ['text', 'image'],
        );
        session.setValue('text', 'قِيمَةٌ عَرَبِيَّةٌ ABC 123');
        session.setValue('image', LAB_IMAGE, true);
        await kernel.prepare(session.previewDocument());
        const scene = session.pendingScene(kernel);
        expect(scene.glyphCount).toBeGreaterThan(0);
        expect(scene.pages[1].commands.some((command) => command.kind === 'image')).toBe(true);
        await verifyScenePdf(session.previewDocument(), scene, kernel, 'frozen-pending-print');
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
