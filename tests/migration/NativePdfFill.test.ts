// @vitest-environment node
import { importDocument } from '@saad5400/midad/document';
import { fillNativePdf } from '@saad5400/midad/fill-pdf';
import { appendPdfRevision, snapshotPdfObjects } from '@saad5400/midad/incremental-pdf';
import { NativeTextKernel } from '@saad5400/midad/kernel';
import { layoutDocument } from '@saad5400/midad/layout';
import { writeScenePdf } from '@saad5400/midad/pdf';
import CanvasKitInit from 'canvaskit-wasm';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
function content(values: Record<string, string> = {}) {
    return importDocument(
        {
            type: 'doc',
            attrs: {
                blockVariables: [
                    {
                        id: 'arabic',
                        type: 'text',
                        name: 'اسم الطرف',
                        x: 80.25,
                        y: 160.5,
                        width: 350.25,
                        height: 72,
                        value: values.arabic ?? '',
                        settings: {
                            fontFamily: 'Amiri',
                            fontSize: '20px',
                            direction: 'rtl',
                            textAlign: 'right',
                            bold: true,
                            fontWeight: 'bold',
                            color: '#123456',
                            multiline: true,
                        },
                    },
                    {
                        id: 'english',
                        type: 'text',
                        name: 'English field',
                        x: 80.25,
                        y: 270.5,
                        width: 350.25,
                        height: 40.5,
                        value: values.english ?? '',
                        settings: {
                            fontFamily: 'Arial',
                            fontSize: '18px',
                            direction: 'ltr',
                            textAlign: 'left',
                            italic: true,
                            fontStyle: 'italic',
                            underline: true,
                        },
                    },
                    {
                        id: 'date',
                        type: 'date',
                        name: 'التاريخ',
                        x: 80.25,
                        y: 350.5,
                        width: 180,
                        height: 40.5,
                        value: values.date ?? '',
                        settings: { fontFamily: 'Amiri', direction: 'rtl', dateFormat: 'DD/MM/YYYY' },
                    },
                ],
            },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Frozen contract body العربية English' }] }],
        },
        'native-fill',
    );
}

describe('native incremental field filling', () => {
    let kernel: NativeTextKernel;
    beforeAll(async () => {
        const options: NonNullable<Parameters<typeof CanvasKitInit>[0]> & { wasmBinary: Uint8Array } = {
            wasmBinary: await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')),
        };
        const ck = await CanvasKitInit(options);
        kernel = await NativeTextKernel.withAssets(
            ck,
            async (font) => new Uint8Array(await readFile(`assets/fonts/${font}.ttf`)),
            async () => {
                throw new Error('Unexpected image in text-only fixture');
            },
        );
    });
    afterAll(() => kernel?.destroy());
    async function source(useObjectStreams = true): Promise<Uint8Array> {
        const doc = content();
        await kernel.prepare(doc);
        const bytes = await writeScenePdf(layoutDocument(doc, kernel), kernel, () => doc);
        if (useObjectStreams) return bytes;
        return (await PDFDocument.load(bytes)).save({ useObjectStreams: false });
    }
    it.each([true, false])(
        'appends field values and vector appearances without changing any existing byte (object streams %s)',
        async (streams) => {
            const original = await source(streams);
            const doc = content({
                arabic: 'مرحبًا بالطرف الأول ABC 123',
                english: 'Exact English fill',
                date: '1448-04-12',
            });
            await kernel.prepare(doc);
            const result = await fillNativePdf(original, doc, kernel, ['arabic', 'english', 'date']);
            expect(result.bytes.subarray(0, original.length)).toEqual(original);
            expect(result.bytes.length).toBeGreaterThan(original.length);
            expect(result.fields).toEqual(['arabic', 'english', 'date']);
            const reopened = await PDFDocument.load(result.bytes);
            for (const name of result.fields) {
                const field = reopened.getForm().getField(name);
                expect(field.isReadOnly()).toBe(true);
                const widget = field.acroField.getWidgets()[0];
                const normal = widget.dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
                if (!(normal instanceof PDFRawStream)) throw new Error('Missing vector appearance');
                expect(decodePDFRawStream(normal).decode().length).toBeGreaterThan(20);
            }
            expect(reopened.getForm().getTextField('arabic').getText()).toBe('مرحبًا بالطرف الأول ABC 123');
            expect(reopened.getForm().getTextField('english').getText()).toBe('Exact English fill');
            expect(reopened.getForm().getTextField('date').getText()).toContain('1448');
            const reader = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
            const page = await reader.getPage(1);
            const text = (await page.getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' ');
            expect(
                (await page.getAnnotations()).find((annotation) => annotation.fieldName === 'english')?.fieldValue,
            ).toBe('Exact English fill');
            expect(text).toContain('Frozen contract body');
            await reader.destroy();
        },
    );
    it.each(['समझौता १२३', 'চুক্তি ১২৩', 'കരാർ 123', 'ውል 123'])(
        'fills newly introduced script text %s without rewriting the original PDF',
        async (value) => {
            const original = await source();
            const document = content({ arabic: value });
            await kernel.prepare(document);
            const started = performance.now();
            const result = await fillNativePdf(original, document, kernel, ['arabic']);
            expect(performance.now() - started).toBeLessThan(5000);
            expect(result.bytes.subarray(0, original.length)).toEqual(original);
            expect((await PDFDocument.load(result.bytes)).getForm().getTextField('arabic').getText()).toBe(value);
            const directory = await mkdtemp(join(tmpdir(), 'document-editor-script-fill-'));
            await writeFile(`${directory}/original.pdf`, original);
            await writeFile(`${directory}/filled.pdf`, result.bytes);
            await writeFile(
                `${directory}/expected.pdf`,
                await writeScenePdf(layoutDocument(document, kernel), kernel, () => document),
            );
            console.log(JSON.stringify({ nativeScriptFillArtifacts: directory, value }));
        },
    );
    it('preserves every preceding revision when another participant fills a different field', async () => {
        const original = await source();
        const first = content({ arabic: 'الطرف الأول' });
        await kernel.prepare(first);
        const one = await fillNativePdf(original, first, kernel, ['arabic']);
        const second = content({ arabic: 'الطرف الأول', english: 'Second participant' });
        await kernel.prepare(second);
        const two = await fillNativePdf(one.bytes, second, kernel, ['arabic', 'english']);
        expect(two.bytes.subarray(0, one.bytes.length)).toEqual(one.bytes);
        const reopened = await PDFDocument.load(two.bytes);
        expect(reopened.getForm().getTextField('arabic').getText()).toBe('الطرف الأول');
        expect(reopened.getForm().getTextField('english').getText()).toBe('Second participant');
        const unchanged = await fillNativePdf(two.bytes, second, kernel, ['arabic', 'english']);
        expect(unchanged.bytes).toBe(two.bytes);
        const changed = content({ arabic: 'Changed first participant' });
        await kernel.prepare(changed);
        await expect(fillNativePdf(two.bytes, changed, kernel, ['arabic'])).rejects.toThrow('cannot be changed');
    });
    it('fills a historical frozen source with matching source identity and fonts', async () => {
        const old = 'a'.repeat(64);
        const pdf = await PDFDocument.load(await source());
        const identity = JSON.parse(pdf.catalog.lookup(PDFName.of('CLMNative'), PDFHexString).decodeText());
        pdf.catalog.set(PDFName.of('CLMNative'), PDFHexString.fromText(JSON.stringify({ ...identity, renderer: old })));
        const original = await pdf.save({ updateFieldAppearances: false });
        const current = content({ arabic: 'Historic source — समझौता' });
        const document = {
            ...current,
            root: {
                ...current.root,
                attributes: { ...current.root.attributes, nativeEditor: { schema: 1, renderer: old } },
            },
        };
        await kernel.prepare(document);
        const result = await fillNativePdf(original, document, kernel, ['arabic']);
        expect(result.bytes.subarray(0, original.length)).toEqual(original);
        expect((await PDFDocument.load(result.bytes)).getForm().getTextField('arabic').getText()).toBe(
            'Historic source — समझौता',
        );
        const wrong = {
            ...document,
            root: {
                ...document.root,
                attributes: { ...document.root.attributes, nativeEditor: { schema: 1, renderer: 'b'.repeat(64) } },
            },
        };
        await expect(fillNativePdf(original, wrong, kernel, ['arabic'])).rejects.toThrow('does not match');
    });
    it('rejects a forged source font fingerprint even when a new script is needed', async () => {
        const pdf = await PDFDocument.load(await source());
        const identity = JSON.parse(pdf.catalog.lookup(PDFName.of('CLMNative'), PDFHexString).decodeText());
        pdf.catalog.set(
            PDFName.of('CLMNative'),
            PDFHexString.fromText(JSON.stringify({ ...identity, fontHash: '0'.repeat(64) })),
        );
        const original = await pdf.save({ updateFieldAppearances: false });
        const unchanged = original.slice();
        const document = content({ arabic: 'समझौता १२३' });
        await kernel.prepare(document);
        await expect(fillNativePdf(original, document, kernel, ['arabic'])).rejects.toThrow('does not match');
        expect(original).toEqual(unchanged);
    });
    it('uses retained source font bytes when the installed font has changed', async () => {
        const retained = await NativeTextKernel.withAssets(
            kernel.ck,
            async (file) => new Uint8Array(await readFile(`assets/fonts/${file === 'amiri' ? 'cairo' : file}.ttf`)),
            async () => {
                throw new Error('Unexpected image');
            },
        );
        try {
            const empty = content();
            await retained.prepare(empty);
            const original = await writeScenePdf(layoutDocument(empty, retained), retained, () => empty);
            const document = content({ arabic: 'احتفظ بالخط الأصلي — समझौता' });
            await kernel.prepare(document);
            await expect(fillNativePdf(original, document, kernel, ['arabic'])).rejects.toThrow('does not match');
            await retained.prepare(document);
            const result = await fillNativePdf(original, document, retained, ['arabic']);
            expect(result.bytes.subarray(0, original.length)).toEqual(original);
            expect((await PDFDocument.load(result.bytes)).getForm().getTextField('arabic').getText()).toBe(
                'احتفظ بالخط الأصلي — समझौता',
            );
        } finally {
            retained.destroy();
        }
    });
    it('fills an inline field while retaining the font profile of baked rich content', async () => {
        const make = (value = '') =>
            importDocument(
                {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                { type: 'text', text: 'Body العربية ' },
                                {
                                    type: 'variable',
                                    attrs: {
                                        id: 'inline',
                                        type: 'text',
                                        name: 'Inline',
                                        value,
                                        width: 180,
                                        height: 40,
                                    },
                                },
                                {
                                    type: 'variable',
                                    attrs: {
                                        id: 'baked',
                                        type: 'text',
                                        name: 'Fixed',
                                        value: 'করার স্থির বিষয়',
                                        width: 180,
                                        height: 40,
                                    },
                                },
                            ],
                        },
                    ],
                },
                'inline-fill',
            );
        const empty = make();
        await kernel.prepare(empty);
        const original = await writeScenePdf(layoutDocument(empty, kernel), kernel, () => empty);
        expect(
            (await PDFDocument.load(original))
                .getForm()
                .getFields()
                .map((field) => field.getName()),
        ).toEqual(['inline']);
        const document = make('समझौता');
        await kernel.prepare(document);
        const result = await fillNativePdf(original, document, kernel, ['inline']);
        expect(result.bytes.subarray(0, original.length)).toEqual(original);
        expect((await PDFDocument.load(result.bytes)).getForm().getTextField('inline').getText()).toBe('समझौता');
    });
    it('refuses missing fields and duplicate field requests', async () => {
        const original = await source();
        const doc = content({ arabic: 'نص' });
        await kernel.prepare(doc);
        await expect(fillNativePdf(original, doc, kernel, ['missing'])).rejects.toThrow('missing');
        await expect(fillNativePdf(original, doc, kernel, ['arabic', 'arabic'])).rejects.toThrow('unique');
    });
    it('rejects ambiguous widget trees before appending a revision', async () => {
        const pdf = await PDFDocument.load(await source());
        const field = pdf.getForm().getTextField('arabic');
        const widgets = [0, 1].map(() =>
            pdf.context.register(
                pdf.context.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [10, 10, 100, 30], Parent: field.ref }),
            ),
        );
        field.acroField.dict.set(PDFName.of('Kids'), pdf.context.obj(widgets));
        const original = await pdf.save({ updateFieldAppearances: false });
        const doc = content({ arabic: 'نص' });
        await kernel.prepare(doc);
        await expect(fillNativePdf(original, doc, kernel, ['arabic'])).rejects.toThrow('unambiguous');
    });
    it('writes source and expected render artifacts for visual comparison', async () => {
        const original = await source();
        const doc = content({
            arabic: 'التزم الطرف الأول بسداد المبلغ ABC 123\nالسطـر الثاني',
            english: 'Exact English fill',
            date: '1448-04-12',
        });
        await kernel.prepare(doc);
        const expected = await writeScenePdf(layoutDocument(doc, kernel), kernel, () => doc);
        const result = await fillNativePdf(original, doc, kernel, ['arabic', 'english', 'date']);
        const dir = await mkdtemp(join(tmpdir(), 'document-editor-fill-'));
        await writeFile(`${dir}/original.pdf`, original);
        await writeFile(`${dir}/expected.pdf`, expected);
        await writeFile(`${dir}/filled.pdf`, result.bytes);
        console.log(JSON.stringify({ nativeFillArtifacts: dir }));
    });
    it('requires a usable previous cross-reference and preserves opaque signature dictionaries', async () => {
        const pdf = await PDFDocument.create();
        pdf.addPage();
        const signature = pdf.context.register(
            pdf.context.obj({ Type: 'Sig', ByteRange: [0, 100, 200, 100], Contents: PDFHexString.of('deadbeef') }),
        );
        pdf.catalog.set(PDFName.of('NativeTestSignature'), signature);
        const original = await pdf.save();
        const loaded = await PDFDocument.load(original, { updateMetadata: false });
        const before = snapshotPdfObjects(loaded);
        loaded.catalog.set(PDFName.of('NativeFillTest'), PDFHexString.fromText('appended'));
        const output = appendPdfRevision(original, loaded, before);
        expect(output.subarray(0, original.length)).toEqual(original);
        const read = await PDFDocument.load(output);
        expect(
            read.catalog
                .lookup(PDFName.of('NativeTestSignature'), PDFDict)
                .lookup(PDFName.of('Contents'), PDFHexString)
                .asString(),
        ).toBe('deadbeef');
        expect(() => appendPdfRevision(new Uint8Array([1, 2, 3]), loaded, before)).toThrow('cross-reference');
    });
});
