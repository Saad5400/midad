// @vitest-environment node
import { importDocument } from '@saad5400/midad/document';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import { layoutDocument } from '@saad5400/midad/layout';
import { sceneManifest, writeScenePdf } from '@saad5400/midad/pdf';
import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';

describe('bundled symbol font fallbacks', () => {
    let ck: CanvasKit;
    beforeAll(async () => {
        const require = createRequire(import.meta.url);
        ck = await CanvasKitInit({
            wasmBinary: await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')),
        } as Parameters<typeof CanvasKitInit>[0]);
    });
    const symbols = [
        ['\u20c1', 'notonaskharabic'],
        ['😀', 'dejavusans'],
        ['⚖', 'dejavusans'],
        ['ℝ ✓ ☑', 'dejavusans'],
    ];
    it.each(
        symbols.flatMap(([symbol, expected]) =>
            [false, true].map((bold) => ({
                symbol,
                expected: bold && expected === 'dejavusans' ? expected + '-bold' : expected,
                bold,
            })),
        ),
    )('renders $symbol (bold=$bold) with the same bundled face in PDF', async ({ symbol, expected, bold }) => {
        const loaded: string[] = [];
        const kernel = await NativeTextKernel.withAssets(
            ck,
            async (file) => {
                loaded.push(file);
                return new Uint8Array(await readFile(`assets/fonts/${file}.ttf`));
            },
            async () => {
                throw new Error('No images');
            },
        );
        try {
            const document = importDocument(
                {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            attrs: { dir: 'rtl' },
                            content: [
                                {
                                    type: 'text',
                                    text: `يلتزم الطرفان بمبلغ 100 ${symbol}. Payment ${symbol}`,
                                    marks: bold ? [{ type: 'bold' }] : [],
                                },
                            ],
                        },
                    ],
                },
                'fallback',
            );
            await kernel.prepare(document);
            const scene = layoutDocument(document, kernel);
            const runs = scene.pages.flatMap((page) =>
                page.lines.flatMap((line) => line.shaped.lines.flatMap((shaped) => shaped.runs)),
            );
            for (const character of symbol.replaceAll(' ', '')) {
                expect(runs.some((run) => run.fontId === expected && run.text.join('').includes(character))).toBe(true);
            }
            expect(runs.flatMap((run) => run.glyphs)).not.toContain(0);
            expect(loaded).toContain(expected);
            const manifest = sceneManifest(scene);
            for (const character of symbol.replaceAll(' ', '')) expect(JSON.stringify(manifest)).toContain(character);
            const pdf = await writeScenePdf(scene, kernel, () => document);
            expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
        } finally {
            kernel.destroy();
        }
    });
    it('retains the selected font for symbols it already covers and loads no symbol face for plain text', async () => {
        const loaded: string[] = [];
        const kernel = await NativeTextKernel.withAssets(
            ck,
            async (file) => {
                loaded.push(file);
                return new Uint8Array(await readFile(`assets/fonts/${file}.ttf`));
            },
            async () => {
                throw new Error('No images');
            },
        );
        try {
            await kernel.prepare(
                importDocument(
                    {
                        type: 'doc',
                        content: [
                            { type: 'paragraph', content: [{ type: 'text', text: 'Ordinary text نص عربي 123' }] },
                        ],
                    },
                    'plain',
                ),
            );
            expect(loaded).toEqual(['amiri', 'liberationsans']);
            const document = importDocument(
                { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '€ ∑ ∞' }] }] },
                'existing',
            );
            await kernel.prepare(document);
            const scene = layoutDocument(document, kernel);
            const runs = scene.pages.flatMap((page) =>
                page.lines.flatMap((line) => line.shaped.lines.flatMap((shaped) => shaped.runs)),
            );
            expect(runs.every((run) => run.fontId === 'liberationsans')).toBe(true);
        } finally {
            kernel.destroy();
        }
    });
});
