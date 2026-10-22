// @vitest-environment node
import { importDocument } from '@saad5400/midad/document';
import { layoutPdfOverlays } from '@saad5400/midad/layout/pdf-overlays';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import CanvasKitInit from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LAB_IMAGE } from '../fixtures/migrationCorpus';
import { verifyScenePdf } from '../fixtures/pdfGeometry';

let kernel: NativeTextKernel;
beforeAll(async () => {
    const require = createRequire(import.meta.url);
    const ck = await CanvasKitInit({
        wasmBinary: await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')),
    } as Parameters<typeof CanvasKitInit>[0]);
    kernel = await NativeTextKernel.withAssets(
        ck,
        async (font) => new Uint8Array(await readFile(`assets/fonts/${font}.ttf`)),
        async (source) => ({ bytes: new Uint8Array(Buffer.from(source.slice(source.indexOf(',') + 1), 'base64')) }),
    );
});
afterAll(() => kernel?.destroy());
const pages = [
    { width: 600, height: 800 },
    { width: 800, height: 400 },
];
const field = (id: string, extra = {}) => ({
    id,
    type: 'text',
    name: id,
    width: 120,
    height: 30,
    x: 40,
    y: 50,
    settings: {},
    ...extra,
});
const document = (fields: unknown[], images: unknown[] = []) =>
    importDocument(
        {
            type: 'doc',
            attrs: { blockVariables: fields, floatingImages: images },
            content: [
                { type: 'pdfPage', attrs: { number: 1 } },
                { type: 'pdfPage', attrs: { number: 2 } },
            ],
        },
        'pdf-overlays',
    );
describe('read-only PDF document overlays', () => {
    it('keeps source page boxes unchanged and maps normalized fields against their own page', async () => {
        const source = document([
            field('normalized', {
                settings: { page: 2, relativeXPct: 0.1, relativeYPct: 0.2, widthPct: 0.3, heightPct: 0.1 },
            }),
        ]);
        await kernel.prepare(source);
        const scene = layoutPdfOverlays(source, kernel, pages);
        expect(scene.pages.map((page) => ({ width: page.width, height: page.height }))).toEqual(pages);
        expect(scene.pages[1].commands.find((command) => command.kind === 'field')).toMatchObject({
            nodeId: 'normalized',
            x: 80,
            y: 80,
            width: 240,
            height: 40,
        });
        expect(scene.pages[0].commands).toEqual([]);
        expect(Object.isFrozen(scene.pages[1].commands)).toBe(true);
        expect(Object.isFrozen(scene.pages)).toBe(true);
    });
    it('maps old absolute pixels across different page heights and the original 30-pixel gaps', async () => {
        const source = document([field('first'), field('second', { y: 1150 })]);
        await kernel.prepare(source);
        const scene = layoutPdfOverlays(source, kernel, pages);
        expect(scene.pages[0].commands.find((command) => command.kind === 'field')).toMatchObject({
            x: 30,
            y: 37.5,
            width: 90,
            height: 22.5,
        });
        expect(scene.pages[1].commands.find((command) => command.kind === 'field')).toMatchObject({ y: 40 });
    });
    it('uses the shared shaped values and images, skips cover objects, and exports the same glyph coordinates', async () => {
        const source = document(
            [
                field('value', {
                    value: 'قيمة عربية Hello',
                    settings: { fontFamily: 'Amiri', fontSize: '16px', direction: 'rtl' },
                }),
                field('cover', { surface: 'cover' }),
            ],
            [{ id: 'logo', src: LAB_IMAGE, x: 100, y: 160, width: 180, height: 60 }],
        );
        await kernel.prepare(source);
        const scene = layoutPdfOverlays(source, kernel, pages);
        expect(scene.glyphCount).toBeGreaterThan(0);
        expect(scene.pages[0].commands.some((command) => 'nodeId' in command && command.nodeId === 'cover')).toBe(
            false,
        );
        expect(scene.pages[0].commands.find((command) => command.kind === 'image')).toMatchObject({
            nodeId: 'logo',
            x: 75,
            y: 120,
            width: 135,
            height: 45,
        });
        await verifyScenePdf(source, scene, kernel, 'pdf-template-overlays');
    });
    it.each([[], [{ width: NaN, height: 800 }], [{ width: 0, height: 800 }]])(
        'refuses invalid page geometry',
        (boxes) => {
            expect(() => layoutPdfOverlays(document([]), kernel, boxes)).toThrow();
        },
    );
    it.each([
        field('bad', { width: -1 }),
        field('bad', { settings: { page: 9, relativeXPct: 0, relativeYPct: 0, widthPct: 0.1, heightPct: 0.1 } }),
    ])('refuses misplaced or malformed overlays instead of silently hiding them', (value) => {
        expect(() => layoutPdfOverlays(document([value]), kernel, pages)).toThrow();
    });
});
