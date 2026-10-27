// @vitest-environment node
import { importDocument } from '@saad5400/midad/document';
import { initializeDocumentTypography, setDocumentTypography } from '@saad5400/midad/content/typography';
import { selectionTextStyle } from '@saad5400/midad/formatting';
import { layoutDocument } from '@saad5400/midad/layout';
import { sceneManifest } from '@saad5400/midad/pdf';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import CanvasKitInit from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { verifyScenePdf } from '../fixtures/pdfGeometry';

let kernel: NativeTextKernel;
beforeAll(async () => {
    const require = createRequire(import.meta.url);
    kernel = await NativeTextKernel.withAssets(
        await CanvasKitInit({ wasmBinary: await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')) }),
        async (file) => new Uint8Array(await readFile(`assets/fonts/${file}.ttf`)),
        async () => {
            throw new Error('Unexpected image');
        },
    );
});
afterAll(() => kernel?.destroy());
const paragraph = (id: string, family?: string) => ({
    type: 'paragraph',
    attrs: { id },
    content: [
        {
            type: 'text',
            text: 'العربية English 123',
            ...(family ? { marks: [{ type: 'textStyle', attrs: { fontFamily: family } }] } : {}),
        },
    ],
});

it('initializes a blank document once without changing history or existing content defaults', () => {
    const empty = importDocument({ type: 'doc', attrs: { custom: 'preserve' }, content: [] }, 'empty');
    const initialized = initializeDocumentTypography(empty);
    expect(initialized.revision).toBe(empty.revision);
    expect(initialized.root.attributes).toEqual({ custom: 'preserve', typography: { fontFamily: 'Tajawal' } });
    expect(Object.isFrozen(initialized.root.attributes!.typography)).toBe(true);
    expect(initializeDocumentTypography(initialized)).toBe(initialized);
    const existing = importDocument({ type: 'doc', content: [paragraph('existing')] }, 'existing');
    expect(initializeDocumentTypography(existing)).toBe(existing);
    const next = setDocumentTypography(existing, { fontFamily: 'Cairo' });
    expect(next.revision).toBe(existing.revision + 1);
    expect(setDocumentTypography(next, { fontFamily: 'Cairo' })).toBe(next);
    expect(() => setDocumentTypography(existing, { fontFamily: 'Missing font' })).toThrow();
});

it('keeps existing unconfigured document geometry and font identities identical to explicit Arial defaults', async () => {
    const source = {
        type: 'doc',
        attrs: { nativeEditor: { schema: 1, renderer: 'legacy' } },
        content: [paragraph('old')],
    };
    const original = importDocument(source, 'default-font'),
        explicit = importDocument(
            { ...source, attrs: { ...source.attrs, typography: { fontFamily: 'Arial' } } },
            'default-font',
        );
    await kernel.prepare(original);
    const first = sceneManifest(layoutDocument(original, kernel));
    await kernel.prepare(explicit);
    expect(sceneManifest(layoutDocument(explicit, kernel))).toEqual(first);
});

it('uses the document font for text, footer and formatting queries without changing explicit font choices', async () => {
    const doc = importDocument(
        {
            type: 'doc',
            attrs: { typography: { fontFamily: 'Tajawal' } },
            content: [paragraph('new'), paragraph('explicit', 'Arial')],
        },
        'new-font',
    );
    await kernel.prepare(doc);
    const scene = layoutDocument(doc, kernel);
    expect(
        scene.pages[0].lines.find((line) => line.paragraphId === 'new')!.shaped.lines[0].runs.map((run) => run.fontId),
    ).toEqual(['tajawal', 'tajawal']);
    expect(
        scene.pages[0].lines
            .find((line) => line.paragraphId === 'explicit')!
            .shaped.lines[0].runs.some((run) => run.fontId === 'liberationsans'),
    ).toBe(true);
    expect(selectionTextStyle(doc, { blockId: 'new', from: 0, to: 0, expectedRevision: doc.revision }).family).toBe(
        'Tajawal',
    );
    await verifyScenePdf(doc, scene, kernel, 'document-typography');
});

it('invalidates measurements when the default changes even if the prepared font set remains identical', async () => {
    const first = importDocument(
        {
            type: 'doc',
            attrs: { typography: { fontFamily: 'Tajawal' } },
            content: [paragraph('unstyled'), paragraph('tajawal', 'Tajawal'), paragraph('cairo', 'Cairo')],
        },
        'font-switch',
    );
    await kernel.prepare(first);
    layoutDocument(first, kernel);
    const next = {
        ...first,
        revision: first.revision + 1,
        root: { ...first.root, attributes: { ...first.root.attributes, typography: { fontFamily: 'Cairo' } } },
    };
    await kernel.prepare(next);
    expect(kernel.fontHashFor(first)).toBe(kernel.fontHashFor(next));
    const scene = layoutDocument(next, kernel);
    expect(
        scene.pages[0].lines
            .find((line) => line.paragraphId === 'unstyled')!
            .shaped.lines[0].runs.every((run) => run.fontId === 'cairo'),
    ).toBe(true);
});

it('renders and exports the new 600-paragraph Arabic/Latin document default within five seconds each', async () => {
    const doc = importDocument(
        {
            type: 'doc',
            attrs: { typography: { fontFamily: 'Tajawal' } },
            content: Array.from({ length: 600 }, (_, index) => ({
                type: 'paragraph',
                content: [
                    {
                        type: 'text',
                        text: `${index} ` + 'يلتزم الطرف الأول بأحكام العقد والسداد خلال ثلاثين يوماً. '.repeat(10),
                    },
                ],
            })),
        },
        'new-default-large',
    );
    const started = performance.now();
    await kernel.prepare(doc);
    const scene = layoutDocument(doc, kernel),
        layoutMs = performance.now() - started;
    expect(layoutMs).toBeLessThan(5000);
    await verifyScenePdf(doc, scene, kernel, 'new-default-large');
    console.log(
        JSON.stringify({ workload: '600 paragraphs with the new document font', layoutMs, pages: scene.pages.length }),
    );
}, 15000);
