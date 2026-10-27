// @vitest-environment node
import { importClmDocument, type Json } from '@saad5400/midad/document';
import { NativeTextKernel } from '@saad5400/midad/kernel';
import { layoutDocument } from '@saad5400/midad/layout';
import { writeScenePdf } from '@saad5400/midad/pdf';
import { pdfPageText } from '@saad5400/midad/pdf/reading';
import CanvasKitInit from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const clean = (text: string) =>
    text
        .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
describe('native PDF logical reading order', () => {
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
    async function extract(content: Json[]): Promise<{ text: string; bytes: Uint8Array }> {
        const document = importClmDocument({ type: 'doc', content }, 'reading-order');
        await kernel.prepare(document);
        const scene = layoutDocument(document, kernel);
        const bytes = await writeScenePdf(scene, kernel, () => document);
        const task = getDocument({ data: new Uint8Array(bytes) });
        const pdf = await task.promise;
        try {
            const metadata = await pdf.getMetadata();
            const tagged = (metadata.info as { Custom?: Record<string, unknown> }).Custom?.CLMReadingOrder === '1';
            expect(tagged).toBe(true);
            const pages = [];
            for (let number = 1; number <= pdf.numPages; number++) {
                const detail = await pdfPageText(await pdf.getPage(number), tagged);
                pages.push(detail.text);
            }
            return { text: pages.join('\n'), bytes };
        } finally {
            await task.destroy();
        }
    }
    it.each([
        'عقد الخدمات — نواة المحرر المستقل',
        'مقدمة العقد ثم الالتزامات وأخيرًا الخاتمة',
        'العقد ABC رقم 123 ثم النهاية',
        'English العربية then English 123',
    ])('preserves the logical text of %s', async (text) => {
        const result = await extract([
            {
                type: 'paragraph',
                attrs: { dir: text.startsWith('English') ? 'ltr' : 'rtl' },
                content: [{ type: 'text', text }],
            },
        ]);
        expect(clean(result.text).replace(/ 1$/, '')).toBe(clean(text));
    });
    it.each(
        ['Arial', 'Amiri', 'Cairo', 'Noto Naskh Arabic'].flatMap((font) =>
            ['plain', 'table', 'columns'].map((context) => ({ font, context })),
        ),
    )('retains rich word fragments, diacritics and script order in $font / $context', async ({ font, context }) => {
        const fragments: Array<{ text: string; marks: Json[] }> = [
            { text: 'يَلْتَزِمُ الطرف ', marks: [{ type: 'textStyle', attrs: { fontFamily: font } }] },
            {
                text: 'الأ',
                marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { fontFamily: font, color: '#234567' } }],
            },
            {
                text: 'و',
                marks: [
                    { type: 'underline' },
                    { type: 'textStyle', attrs: { fontFamily: font, backgroundColor: '#ffefaa' } },
                ],
            },
            { text: 'ل', marks: [{ type: 'italic' }, { type: 'textStyle', attrs: { fontFamily: font } }] },
            { text: ' ABC رقم 123 — ثم النهاية.', marks: [{ type: 'textStyle', attrs: { fontFamily: font } }] },
        ];
        const paragraph: Json = {
            type: 'paragraph',
            attrs: { id: 'footer', dir: 'rtl' },
            content: fragments.map((part) => ({ type: 'text', ...part })),
        };
        const node: Json =
            context === 'table'
                ? {
                      type: 'table',
                      content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph] }] }],
                  }
                : context === 'columns'
                  ? {
                        type: 'parallelRow',
                        content: [
                            { type: 'parallelCell', attrs: { lang: 'ar' }, content: [paragraph] },
                            {
                                type: 'parallelCell',
                                attrs: { lang: 'en' },
                                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'OTHER' }] }],
                            },
                        ],
                    }
                  : paragraph;
        const result = await extract([node]);
        expect(clean(result.text.split('OTHER')[0]).replace(/ 1$/, '')).toBe(
            fragments.map((part) => part.text).join(''),
        );
    });
    it('keeps a heading in its original logical order', async () => {
        const text = 'عقد الخدمات — نواة المحرر المستقل';
        const result = await extract([{ type: 'heading', attrs: { dir: 'rtl' }, content: [{ type: 'text', text }] }]);
        expect(clean(result.text).replace(/ 1$/, '')).toBe(text);
    });
    it('keeps exact nonbreaking spaces and Unicode ligatures in logical text', async () => {
        const text = 'العقد\u00a0ABC — لا لأ لإ لآ office ffi';
        const result = await extract([{ type: 'paragraph', attrs: { dir: 'rtl' }, content: [{ type: 'text', text }] }]);
        expect(result.text.replace(/\n1$/, '')).toBe(text);
    });
    it('keeps inline field values between their surrounding words', async () => {
        const result = await extract([
            {
                type: 'paragraph',
                attrs: { dir: 'rtl' },
                content: [
                    { type: 'text', text: 'قبل ' },
                    {
                        type: 'variable',
                        attrs: {
                            id: 'field',
                            name: 'الحقل',
                            type: 'text',
                            value: 'قيمة ABC 123',
                            width: 140,
                            height: 26,
                            settings: { direction: 'rtl', fontFamily: 'Amiri', fontSize: '14px' },
                        },
                    },
                    { type: 'text', text: ' بعد الحقل' },
                ],
            },
        ]);
        expect(clean(result.text).replace(/ 1$/, '')).toBe('قبل قيمة ABC 123 بعد الحقل');
    });
    it('retains all words and their order across wrapped and continuing pages', async () => {
        const text = Array.from({ length: 160 }, (_, index) => `البند ${index} ABC ثم الالتزامات`).join(' ');
        const result = await extract([{ type: 'paragraph', attrs: { dir: 'rtl' }, content: [{ type: 'text', text }] }]);
        const body = result.text
            .split('\n')
            .filter((line) => !/^\d+$/.test(line.trim()))
            .join(' ');
        expect(clean(body)).toBe(text);
    });
});
