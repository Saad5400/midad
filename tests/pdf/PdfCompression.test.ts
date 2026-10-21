// @vitest-environment node
import { importDocument } from '@saad5400/midad/document';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import { layoutDocument } from '@saad5400/midad/layout';
import { writeScenePdf } from '@saad5400/midad/pdf';
import CanvasKitInit from 'canvaskit-wasm';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import {
    PDFArray,
    PDFDict,
    PDFDocument,
    PDFHexString,
    PDFName,
    PDFNumber,
    PDFRawStream,
    decodePDFRawStream,
} from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeNestedRichFixture } from '../fixtures/nativeDocument';

const require = createRequire(import.meta.url);
describe('native PDF compression adapters', () => {
    let kernel: NativeTextKernel;
    const document = importDocument(makeNestedRichFixture(), 'compression-fixture');
    beforeAll(async () => {
        const wasmBinary = new Uint8Array(await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')));
        kernel = await NativeTextKernel.withAssets(
            await CanvasKitInit({ wasmBinary } as Parameters<typeof CanvasKitInit>[0]),
            async (file) => new Uint8Array(await readFile(`assets/fonts/${file}.ttf`)),
            async (source) => ({ bytes: new Uint8Array(Buffer.from(source.slice(source.indexOf(',') + 1), 'base64')) }),
        );
        await kernel.prepare(document);
    });
    afterAll(() => kernel?.destroy());
    it('preserves every decoded object, font, page command and field with native compressed streams', async () => {
        const scene = layoutDocument(document, kernel);
        const original = await writeScenePdf(scene, kernel, () => document);
        const compress = vi.fn((contents: Uint8Array) => new Uint8Array(deflateSync(contents)));
        const accelerated = await writeScenePdf(scene, kernel, () => document, {
            compress,
            objectsPerTick: 100000,
        });
        const read = async (bytes: Uint8Array) => {
            const pdf = await PDFDocument.load(bytes);
            const dictionary = (dict: PDFDict) =>
                dict
                    .entries()
                    .filter(([key]) => !['/Length', '/Filter', '/CreationDate', '/ModDate'].includes(key.toString()))
                    .map(([key, value]) => [key.toString(), value.toString()]);
            return {
                objects: pdf.context.enumerateIndirectObjects().flatMap(([ref, object]) => {
                    if (object instanceof PDFRawStream) {
                        if (['/ObjStm', '/XRef'].includes(object.dict.get(PDFName.of('Type'))?.toString() ?? ''))
                            return [];
                        return [
                            [
                                ref.toString(),
                                dictionary(object.dict),
                                createHash('sha256').update(decodePDFRawStream(object).decode()).digest('hex'),
                            ],
                        ];
                    }
                    return [[ref.toString(), object instanceof PDFDict ? dictionary(object) : object.toString()]];
                }),
                fields: pdf
                    .getForm()
                    .getFields()
                    .map((field) => field.getName()),
                pages: pdf.getPages().map((page) => {
                    const contents = page.node.Contents();
                    const streams = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
                    return {
                        width: page.getWidth(),
                        height: page.getHeight(),
                        commands: streams.map((ref) =>
                            Array.from(decodePDFRawStream(pdf.context.lookup(ref, PDFRawStream)).decode()),
                        ),
                    };
                }),
            };
        };
        expect(compress.mock.calls.length).toBeGreaterThan(scene.pages.length);
        expect(await read(accelerated)).toEqual(await read(original));
    });
    it('propagates compressor failures without changing the source document or scene', async () => {
        const scene = layoutDocument(document, kernel);
        const before = JSON.stringify(document);
        await expect(
            writeScenePdf(scene, kernel, () => document, {
                compress: () => {
                    throw new Error('Compression failed');
                },
            }),
        ).rejects.toThrow('Compression failed');
        expect(JSON.stringify(document)).toBe(before);
        expect(scene.revision).toBe(document.revision);
    });
    it('keeps separate reading owners and bounds when multiple spans share the same text', async () => {
        const document = importDocument(
            {
                type: 'doc',
                attrs: { dir: 'ltr' },
                content: ['one', 'two'].map((id) => ({
                    type: 'paragraph',
                    attrs: { id },
                    content: [{ type: 'text', text: 'Repeated text' }],
                })),
            },
            'reading-owners',
        );
        await kernel.prepare(document);
        const scene = layoutDocument(document, kernel);
        const pdf = await PDFDocument.load(await writeScenePdf(scene, kernel, () => document));
        const page = scene.pages[0];
        const expected = page.commands.flatMap((command) =>
            'glyphs' in command ? (command.reading ?? []).filter((part) => part.text) : [],
        );
        const spans = pdf.context
            .enumerateIndirectObjects()
            .filter(([, value]) => value instanceof PDFDict && value.get(PDFName.of('S'))?.toString() === '/Span')
            .map(([ref, value]) => ({ ref, value: value as PDFDict }))
            .sort(
                (a, b) =>
                    a.value.lookup(PDFName.of('K'), PDFNumber).asNumber() -
                    b.value.lookup(PDFName.of('K'), PDFNumber).asNumber(),
            );
        expect(spans).toHaveLength(expected.length);
        expect(new Set(spans.map((span) => span.ref.toString())).size).toBe(expected.length);
        expect(expected.filter((part) => part.text === 'Repeated text')).toHaveLength(2);
        spans.forEach(({ value }, index) => {
            const part = expected[index],
                box = part.box;
            expect(value.lookup(PDFName.of('ActualText'), PDFHexString).decodeText()).toBe(part.text);
            const bounds = value.lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('BBox'), PDFArray);
            expect(bounds.asArray().map((value) => (value as PDFNumber).asNumber())).toEqual([
                box.x,
                page.height - box.y - box.height,
                box.x + box.width,
                page.height - box.y,
            ]);
        });
    });
});
