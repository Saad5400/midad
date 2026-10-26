// @vitest-environment node
import { DocumentLayoutController } from '@saad5400/midad/browser/view';
import { importDocument, type NativeDocument } from '@saad5400/midad/document';
import type { DocumentSurface } from '@saad5400/midad/layout';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import CanvasKitInit from 'canvaskit-wasm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';

let kernel: NativeTextKernel;
const controllers: DocumentLayoutController[] = [];
beforeAll(async () => {
    const require = createRequire(import.meta.url);
    kernel = await NativeTextKernel.withAssets(
        await CanvasKitInit({ wasmBinary: await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')) }),
        async (font) => new Uint8Array(await readFile(`assets/fonts/${font}.ttf`)),
        async () => {
            throw new Error('Unexpected image');
        },
    );
});
afterEach(() => {
    controllers.splice(0).forEach((controller) => controller.dispose());
    vi.restoreAllMocks();
    kernel.clearUnused(new Set());
});
afterAll(() => kernel?.destroy());
const document = () =>
    importDocument(
        {
            type: 'doc',
            attrs: { dir: 'ltr' },
            content: [
                {
                    type: 'paragraph',
                    attrs: { id: 'paragraph' },
                    content: [
                        {
                            type: 'text',
                            text: 'Text عربي must reflow at every change in the available width. '.repeat(20),
                        },
                    ],
                },
            ],
        },
        'layout-session',
    );
function open(initial: DocumentSurface = { kind: 'flow' }) {
    let renderer: NativeTextKernel | undefined = kernel,
        surface = initial,
        valid = true;
    const controller = new DocumentLayoutController({
        kernel: () => renderer,
        surface: () => surface,
        validate: () => {
            if (!valid) throw new Error('Source changed');
        },
    });
    controllers.push(controller);
    return {
        controller,
        setSurface: (next: DocumentSurface) => {
            surface = next;
        },
        setKernel: (next?: NativeTextKernel) => {
            renderer = next;
        },
        invalidate: () => {
            valid = false;
        },
    };
}
it('retains staged and displayed native paragraphs until their actual owners release them', async () => {
    const { controller } = open(),
        doc = document(),
        prepared = await controller.prepare(doc),
        shape = prepared.scene.pages[0].lines[0].shaped;
    controller.remember(doc, prepared);
    prepared.release();
    prepared.release();
    kernel.clearUnused(new Set());
    expect(shape.paragraph.isDeleted()).toBe(false);
    expect(controller.cached(doc)?.scene).toBe(prepared.scene);
    controller.display(doc, prepared.scene);
    kernel.clearUnused(new Set());
    expect(shape.paragraph.isDeleted()).toBe(false);
    controller.display(doc, undefined);
    kernel.clearUnused(new Set());
    expect(shape.paragraph.isDeleted()).toBe(true);
    expect(controller.cached(doc)).toBeUndefined();
});
it('invalidates cached flow geometry when width changes while preserving the visible old scene until replacement', async () => {
    const { controller, setSurface } = open({ kind: 'flow', width: 230 }),
        doc = document(),
        first = await controller.prepare(doc);
    controller.remember(doc, first);
    controller.display(doc, first.scene);
    first.release();
    setSurface({ kind: 'flow', width: 400 });
    expect(controller.cached(doc)).toBeUndefined();
    const next = await controller.prepare(doc),
        oldShape = first.scene.pages[0].lines[0].shaped,
        newShape = next.scene.pages[0].lines[0].shaped;
    expect(next.scene.pages[0].width).toBe(400);
    expect(newShape.lines.length).toBeLessThan(oldShape.lines.length);
    expect(oldShape.paragraph.isDeleted()).toBe(false);
    controller.remember(doc, next);
    controller.display(doc, next.scene);
    next.release();
    kernel.clearUnused(new Set());
    expect(oldShape.paragraph.isDeleted()).toBe(true);
    expect(newShape.paragraph.isDeleted()).toBe(false);
    controller.dispose();
    controller.dispose();
    kernel.clearUnused(new Set());
    expect(newShape.paragraph.isDeleted()).toBe(true);
});
it('tracks imported PDF page geometry without applying flow anchors', async () => {
    const { controller, setSurface } = open({ kind: 'pdf', pages: [{ number: 1, width: 400, height: 600 }] });
    const doc = importDocument({ type: 'doc', content: [{ type: 'pdfPage', attrs: { number: 1 } }] }, 'pdf-session');
    const first = await controller.prepare(doc);
    expect(first.document).toBe(doc);
    expect(first.scene.pages[0]).toMatchObject({ width: 400, height: 600 });
    controller.remember(doc, first);
    first.release();
    setSurface({ kind: 'pdf', pages: [{ number: 1, width: 600, height: 400 }] });
    expect(controller.cached(doc)).toBeUndefined();
    const next = await controller.prepare(doc);
    expect(next.scene.pages[0]).toMatchObject({ width: 600, height: 400 });
    next.release();
});
it('hydrates flow anchors and can reuse the staged layout through its hydrated document identity', async () => {
    const source = document();
    const doc: NativeDocument = {
        ...source,
        root: {
            ...source.root,
            attributes: {
                ...source.root.attributes,
                blockVariables: [{ id: 'field', type: 'text', x: 160, y: 280, width: 120, height: 40, settings: {} }],
            },
        },
    };
    const { controller } = open();
    const prepared = await controller.prepare(doc);
    expect(prepared.document.root.attributes?.blockVariables).not.toEqual(doc.root.attributes?.blockVariables);
    controller.remember(doc, prepared);
    expect(controller.cached(prepared.document)?.scene).toBe(prepared.scene);
    controller.display(prepared.document, prepared.scene);
    prepared.release();
    expect(controller.cached(prepared.document)?.scene).toBe(prepared.scene);
});
it('never reuses a layout after replacing its kernel or invalidating its source', async () => {
    const { controller, setKernel, invalidate } = open(),
        doc = document(),
        prepared = await controller.prepare(doc);
    controller.remember(doc, prepared);
    prepared.release();
    setKernel(Object.create(kernel));
    expect(controller.cached(doc)).toBeUndefined();
    setKernel(kernel);
    invalidate();
    expect(() => controller.cached(doc)).toThrow('Source changed');
    expect(() => controller.layout(doc)).toThrow('Source changed');
});

it.each(['kernel', 'surface'])('rejects prepared resources when their %s changes before adoption', async (change) => {
    const { controller, setKernel, setSurface } = open(),
        doc = document(),
        prepared = await controller.prepare(doc);
    if (change === 'kernel') setKernel(Object.create(kernel));
    else setSurface({ kind: 'flow', width: 300 });
    expect(() => controller.remember(doc, prepared)).toThrow('context changed');
    prepared.release();
});

it('invalidates both cache reuse and adoption when the prepared font identity changes', async () => {
    const { controller } = open(),
        doc = document(),
        prepared = await controller.prepare(doc);
    controller.remember(doc, prepared);
    vi.spyOn(kernel, 'fontHashFor').mockReturnValue('changed-fonts');
    expect(controller.cached(doc)).toBeUndefined();
    expect(() => controller.remember(doc, prepared)).toThrow('context changed');
    prepared.release();
});
it.each(['closed', 'replaced'])('rejects asset preparation that completes after its renderer is %s', async (change) => {
    const { controller, setKernel } = open();
    let finish!: () => void;
    vi.spyOn(kernel, 'prepare').mockImplementationOnce(
        () =>
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
    );
    const pending = controller.prepare(document());
    if (change === 'closed') controller.dispose();
    else setKernel(Object.create(kernel));
    finish();
    await expect(pending).rejects.toThrow();
});
it('rejects mismatched revision envelopes and supports an independently owned save renderer', async () => {
    const { controller, setKernel } = open(),
        doc = document(),
        prepared = await controller.prepare(doc);
    expect(() => controller.remember({ ...doc, revision: 99 }, prepared)).toThrow('revision changed');
    setKernel(undefined);
    expect(controller.layout(doc, kernel).documentId).toBe(doc.id);
    await expect(controller.prepare(doc)).rejects.toThrow('unavailable');
    controller.display(doc, undefined);
    prepared.release();
});
