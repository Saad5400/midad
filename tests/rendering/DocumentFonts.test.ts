// @vitest-environment node
import { importDocument } from '@saad5400/midad/document';
import { hitTest, layoutDocument } from '@saad5400/midad/layout';
import { layoutPdfOverlays } from '@saad5400/midad/layout/pdf-overlays';
import { writeScenePdf } from '@saad5400/midad/pdf';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import CanvasKitInit from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LAB_IMAGE } from '../fixtures/migrationCorpus';
import { verifyScenePdf } from '../fixtures/pdfGeometry';

let kernel: NativeTextKernel;
async function createKernel(
    readFont = async (font: string) => new Uint8Array(await readFile(`assets/fonts/${font}.ttf`)),
    readImage = async (_source: string): Promise<{ bytes: Uint8Array }> => {
        throw new Error('No image fixture');
    },
): Promise<NativeTextKernel> {
    const require = createRequire(import.meta.url);
    return NativeTextKernel.withAssets(
        await CanvasKitInit({ wasmBinary: await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')) }),
        readFont,
        readImage,
    );
}
beforeEach(async () => {
    kernel = await createKernel();
});
afterEach(() => kernel?.destroy());

const document = (family: string) =>
    importDocument(
        {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        {
                            type: 'text',
                            text: 'Arabic عربي 123',
                            marks: [{ type: 'textStyle', attrs: { fontFamily: family } }],
                        },
                    ],
                },
            ],
        },
        `document-${family}`,
    );

it('uses the document font profile after preparing a different document', async () => {
    const first = document('Arial'),
        second = document('Cairo');
    await kernel.prepare(first);
    const fingerprint = await kernel.fontFingerprint(first);
    await kernel.prepare(second);
    expect(await kernel.fontFingerprint(second)).not.toBe(fingerprint);
    const scene = layoutDocument(first, kernel);
    expect(scene.fontHash).toBe(fingerprint);
    const pdf = await PDFDocument.load(await writeScenePdf(scene, kernel, () => first));
    const identity = pdf.catalog.lookup(PDFName.of('CLMNative'), PDFHexString).decodeText();
    expect(JSON.parse(identity).fontHash).toBe(fingerprint);
    await verifyScenePdf(first, scene, kernel, 'document-fonts-retained');
});

it('exports a retained scene after another document prepares its fonts', async () => {
    const first = document('Arial');
    await kernel.prepare(first);
    const scene = layoutDocument(first, kernel);
    await kernel.prepare(document('Cairo'));
    await expect(writeScenePdf(scene, kernel, () => first)).resolves.toBeInstanceOf(Uint8Array);
});

it('binds overlay scenes to their own document font profile', async () => {
    const first = document('Arial');
    await kernel.prepare(first);
    const fingerprint = await kernel.fontFingerprint(first);
    await kernel.prepare(document('Cairo'));
    const scene = layoutPdfOverlays(first, kernel, [{ width: 600, height: 800 }]);
    expect(scene.fontHash).toBe(fingerprint);
    await expect(writeScenePdf(scene, kernel, () => first)).resolves.toBeInstanceOf(Uint8Array);
});

it('prepares multiple documents before laying them out without sharing their identity', async () => {
    const documents = [document('Arial'), document('Cairo'), document('Georgia')];
    await Promise.all(documents.map((doc) => kernel.prepare(doc)));
    for (const doc of documents) {
        const scene = layoutDocument(doc, kernel);
        expect(scene.fontHash).toBe(await kernel.fontFingerprint(doc));
        await expect(writeScenePdf(scene, kernel, () => doc)).resolves.toBeInstanceOf(Uint8Array);
        await verifyScenePdf(doc, scene, kernel, `document-fonts-${doc.id}`);
    }
});

it('does not interrupt an in-progress PDF when another font profile prepares', async () => {
    const first = document('Arial');
    await kernel.prepare(first);
    const scene = layoutDocument(first, kernel);
    const exporting = writeScenePdf(scene, kernel, () => first, { objectsPerTick: 1 });
    await kernel.prepare(document('Cairo'));
    await expect(exporting).resolves.toBeInstanceOf(Uint8Array);
});

it('rejects another document’s fingerprint rather than removing font validation', async () => {
    const first = document('Arial'),
        second = document('Cairo');
    await kernel.prepare(first);
    const scene = layoutDocument(first, kernel);
    await kernel.prepare(second);
    await expect(
        writeScenePdf({ ...scene, fontHash: await kernel.fontFingerprint(second) }, kernel, () => first),
    ).rejects.toThrow('The document font has changed');
});

it('rejects a stale document before consulting its unprepared new fonts', async () => {
    const first = document('Arial');
    await kernel.prepare(first);
    const scene = layoutDocument(first, kernel);
    const changed = { ...first, revision: first.revision + 1, root: document('Cairo').root };
    await expect(writeScenePdf(scene, kernel, () => changed)).rejects.toThrow('The displayed layout is stale');
});

it('rejects a revision changed while its PDF is being written', async () => {
    const first = document('Arial');
    await kernel.prepare(first);
    const scene = layoutDocument(first, kernel);
    let current = first;
    const exporting = writeScenePdf(scene, kernel, () => current, { objectsPerTick: 1 });
    current = { ...first, revision: first.revision + 1, root: document('Cairo').root };
    await expect(exporting).rejects.toThrow('The displayed layout is stale');
});

it('accepts a new document root with the same prepared font profile', async () => {
    await kernel.prepare(document('Cairo'));
    const fresh = document('Cairo');
    expect(layoutDocument(fresh, kernel).fontHash).toBe(await kernel.fontFingerprint(fresh));
});

it('requires preparation for a new combination instead of borrowing a cached neighbor', async () => {
    const first = document('Cairo'),
        second = document('Georgia');
    await Promise.all([kernel.prepare(first), kernel.prepare(second)]);
    const combined = {
        ...first,
        root: { ...first.root, children: [...first.root.children!, ...second.root.children!] },
    };
    expect(() => layoutDocument(combined, kernel)).toThrow('font profile has not been prepared');
    await kernel.prepare(combined);
    expect(layoutDocument(combined, kernel).fontHash).toBe(await kernel.fontFingerprint(combined));
});

it('reuses the same shaped paragraph after warming an unrelated font', async () => {
    const shaped = kernel.shape('Arabic عربي 123', 300, 14, 'ltr');
    const release = kernel.retainParagraphs([shaped]);
    try {
        await kernel.prepare(document('Cairo'));
        expect(kernel.shape('Arabic عربي 123', 300, 14, 'ltr')).toBe(shaped);
        expect(shaped.paragraph.isDeleted()).toBe(false);
    } finally {
        release();
    }
});

it('keeps a leased interactive scene usable after laying out another document', async () => {
    const first = document('Arial');
    await kernel.prepare(first);
    const scene = layoutDocument(first, kernel);
    const release = kernel.retainParagraphs(scene.pages.flatMap((page) => page.lines.map((line) => line.shaped)));
    try {
        const line = scene.pages[0].lines[0];
        const x = (line.left ?? 0) + 5,
            y = line.top + line.height / 2;
        const original = hitTest(scene, 0, x, y);
        expect(original).not.toBeNull();
        const second = document('Cairo');
        await kernel.prepare(second);
        layoutDocument(second, kernel);
        expect(hitTest(scene, 0, x, y)).toEqual(original);
        await expect(writeScenePdf(scene, kernel, () => first)).resolves.toBeInstanceOf(Uint8Array);
    } finally {
        release();
    }
});

it('does not acquire unsupported characters from an unrelated warm document', async () => {
    expect(() => kernel.shape('ა', 300, 14, 'ltr')).toThrow();
    await kernel.prepare(document('Verdana'));
    expect(() => kernel.shape('ა', 300, 14, 'ltr')).toThrow();
});

it('rejects font queries after renderer disposal', async () => {
    const first = document('Arial');
    await kernel.prepare(first);
    kernel.destroy();
    expect(() => kernel.fontHashFor(first)).toThrow('disposed');
    await expect(kernel.fontFingerprint(first)).rejects.toThrow('disposed');
});

it.each(['font', 'image'])('waits for a pending font when a sibling %s fails', async (failureKind) => {
    kernel.destroy();
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
        release = resolve;
    });
    const failure = new Error(`Synthetic ${failureKind} failure`);
    kernel = await createKernel(
        async (font) => {
            if (font === 'cairo') await paused;
            if (font === 'gelasio') throw failure;
            return new Uint8Array(await readFile(`assets/fonts/${font}.ttf`));
        },
        async () => {
            throw failure;
        },
    );
    const first = document('Cairo'),
        second = document('Georgia');
    const target = {
        ...first,
        root: {
            ...first.root,
            children: [
                ...first.root.children!,
                ...(failureKind === 'font'
                    ? second.root.children!
                    : [{ id: 'image', kind: 'image', attributes: { src: 'broken' } }]),
            ],
        },
    };
    let settled = false;
    const preparing = kernel.prepare(target).catch((error) => {
        settled = true;
        return error;
    });
    try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(settled).toBe(false);
    } finally {
        release();
        expect(await preparing).toBe(failure);
        await vi.waitFor(() => expect(kernel.font('cairo').id).toBe('cairo'));
    }
});

it('waits for a pending image when another image fails', async () => {
    kernel.destroy();
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
        release = resolve;
    });
    const failure = new Error('Synthetic image failure');
    kernel = await createKernel(undefined, async (source) => {
        if (source === 'broken') throw failure;
        await paused;
        return { bytes: new Uint8Array(Buffer.from(LAB_IMAGE.split(',')[1], 'base64')) };
    });
    const first = document('Arial');
    const target = {
        ...first,
        root: {
            ...first.root,
            children: ['slow', 'broken'].map((src) => ({
                id: src,
                kind: 'image',
                attributes: { src },
            })),
        },
    };
    let settled = false;
    const preparing = kernel.prepare(target).catch((error) => {
        settled = true;
        return error;
    });
    try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(settled).toBe(false);
    } finally {
        release();
        expect(await preparing).toBe(failure);
        await vi.waitFor(() => expect(kernel.images.source('slow').width).toBeGreaterThan(0));
    }
});

it('retains native resources until failed preparation has drained during disposal', async () => {
    kernel.destroy();
    let release!: () => void, loading!: () => void;
    const paused = new Promise<void>((resolve) => {
        release = resolve;
    });
    const started = new Promise<void>((resolve) => {
        loading = resolve;
    });
    const failure = new Error('Synthetic media failure');
    kernel = await createKernel(
        async (font) => {
            if (font === 'cairo') {
                loading();
                await paused;
                if (kernel.provider.isDeleted()) throw new Error('Fixture renderer was disposed too early');
            }
            return new Uint8Array(await readFile(`assets/fonts/${font}.ttf`));
        },
        async () => {
            throw failure;
        },
    );
    const first = document('Cairo');
    const target = {
        ...first,
        root: {
            ...first.root,
            children: [
                ...first.root.children!,
                {
                    id: 'image',
                    kind: 'image',
                    attributes: { src: 'broken' },
                },
            ],
        },
    };
    const preparing = kernel.prepare(target).catch((error) => error);
    await started;
    kernel.destroy();
    try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(kernel.provider.isDeleted()).toBe(false);
    } finally {
        release();
        expect(await preparing).toBe(failure);
        await vi.waitFor(() => expect(kernel.provider.isDeleted()).toBe(true));
    }
});

it('recovers after failed preparation without changing another document’s font identity', async () => {
    const first = document('Arial');
    await kernel.prepare(first);
    const original = layoutDocument(first, kernel);
    const other = document('Cairo');
    const invalid = {
        ...other,
        root: {
            ...other.root,
            children: [
                ...other.root.children!,
                {
                    id: 'image',
                    kind: 'image',
                    attributes: { src: 'broken' },
                },
            ],
        },
    };
    await expect(kernel.prepare(invalid)).rejects.toThrow('No image fixture');
    await kernel.prepare(other);
    expect(layoutDocument(first, kernel).fontHash).toBe(original.fontHash);
    await expect(writeScenePdf(original, kernel, () => first)).resolves.toBeInstanceOf(Uint8Array);
});
