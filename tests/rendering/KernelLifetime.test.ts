// @vitest-environment node
import { importDocument } from '@saad5400/midad/document';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import { DEFAULT_TEXT_STYLE } from '@saad5400/midad/typography';
import CanvasKitInit from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

describe('text kernel resource lifetime', () => {
    it('bounds native memory across many paragraphs and preserves existing shapes when loading another font', async () => {
        const require = createRequire(import.meta.url);
        const ck = await CanvasKitInit({
            wasmBinary: await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')),
        } as Parameters<typeof CanvasKitInit>[0]);
        const kernel = await NativeTextKernel.withAssets(
            ck,
            async (file) => new Uint8Array(await readFile(`assets/fonts/${file}.ttf`)),
            async () => {
                throw new Error('No images');
            },
        );
        let first: ReturnType<typeof kernel.shapeRich> | undefined;
        let retained: ReturnType<typeof kernel.shape> | undefined;
        try {
            const start = ck.HEAPU8.byteLength;
            for (let index = 0; index < 600; index++) {
                const shaped = kernel.shapeRich(
                    [
                        {
                            nodeId: `paragraph-${index}`,
                            text: 'مرحبا بالعالم Hello world · 123',
                            style: DEFAULT_TEXT_STYLE,
                            editable: true,
                        },
                    ],
                    480,
                    'rtl',
                );
                first ??= shaped;
            }
            expect(ck.HEAPU8.byteLength - start).toBeLessThan(64 * 1024 * 1024);
            const position = first!.paragraph.getGlyphPositionAtCoordinate(0, 0);
            const document = importDocument(
                {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: 'خط آخر',
                                    marks: [{ type: 'textStyle', attrs: { fontFamily: 'Cairo' } }],
                                },
                            ],
                        },
                    ],
                },
                'another-font',
            );
            await kernel.prepare(document);
            kernel.shapeRich(
                [
                    {
                        nodeId: 'cairo',
                        text: 'خط آخر',
                        style: { ...DEFAULT_TEXT_STYLE, family: 'Cairo' },
                        editable: true,
                    },
                ],
                480,
                'rtl',
            );
            expect(first!.paragraph.getGlyphPositionAtCoordinate(0, 0)).toEqual(position);
            const release = kernel.retainParagraphs([first!]);
            const secondRelease = kernel.retainParagraphs([first!]);
            kernel.clearUnused(new Set());
            expect(first!.paragraph.isDeleted()).toBe(false);
            release();
            release();
            kernel.clearUnused(new Set());
            expect(first!.paragraph.isDeleted()).toBe(false);
            secondRelease();
            kernel.clearUnused(new Set());
            expect(first!.paragraph.isDeleted()).toBe(true);
            retained = kernel.shape('Retained until disposal', 200, 12, 'ltr');
            kernel.retainParagraphs([retained]);
        } finally {
            kernel.destroy();
            kernel.destroy();
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        expect(first!.paragraph.isDeleted()).toBe(true);
        expect(retained!.paragraph.isDeleted()).toBe(true);
    });
});
