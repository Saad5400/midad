import CanvasKitInit from 'canvaskit-wasm';
import { PDFDocument } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { nativeFields } from '../../content/fields/commands.js';
import { persistNativeIdentities } from '../../document/identities.js';
import { exportDocument, importDocument, type NativeDocument } from '../../document/index.js';
import { DocumentLayoutController, type DocumentSurface } from '../../layout/index.js';
import { fillNativePdf, type FrozenPdfLayout } from '../../pdf/fill.js';
import {
    pdfSourceFieldBoxes,
    sourceWidgetBoxes,
    pdfSourcePages,
    preparePdfSourceForms,
    sceneManifest,
    writePdfOverlayDocument,
    writeScenePdf,
} from '../../pdf/index.js';
import { sceneReviewMap } from '../../pdf/review.js';
import { NativeTextKernel } from '../../rendering/kernel.js';
import { NATIVE_RENDERER_VERSION } from '../../rendering/version.js';

export interface RenderInput {
    id: string;
    content: unknown;
    title?: string;
    assets?: Record<string, string>;
    includeManifest?: boolean;
    validateOnly?: boolean;
    includeContent?: boolean;
    fillFields?: string[];
    frozenLayout?: FrozenPdfLayout;
    pdfSurface?: boolean;
    storedFields?: boolean;
    prepareSource?: boolean;
    fonts?: Record<string, string>;
    fontRoot?: string;
}
export interface RendererRuntimeOptions {
    fontRoot?: string;
    fonts?: Record<string, string>;
    artifact?: string;
    identity?: string;
}

export async function createRendererRuntime(options: RendererRuntimeOptions = {}) {
    const require = createRequire(import.meta.url);
    const packageRoot = dirname(fileURLToPath(import.meta.resolve('@saad5400/midad/package.json')));
    const fontRoot = options.fontRoot ?? join(packageRoot, 'assets/fonts');
    const identity = options.identity ?? NATIVE_RENDERER_VERSION;
    const fonts =
        options.fonts ??
        Object.fromEntries(
            await Promise.all(
                (await readdir(fontRoot))
                    .filter((name) => name.endsWith('.ttf'))
                    .map(async (name) => [
                        name.slice(0, -4),
                        createHash('sha256')
                            .update(await readFile(join(fontRoot, name)))
                            .digest('hex'),
                    ]),
            ),
        );
    const build = { fonts, artifact: options.artifact ?? identity };
    const wasmOptions: NonNullable<Parameters<typeof CanvasKitInit>[0]> & { wasmBinary: Uint8Array } = {
        wasmBinary: await readFile(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')),
    };
    let canvasKit: ReturnType<typeof CanvasKitInit> | undefined;
    let current: { input: RenderInput; directory: string };
    let retained: { key: string; kernel: NativeTextKernel; layouts: DocumentLayoutController } | undefined;
    let cached: { keys: Set<string>; document: NativeDocument } | undefined;
    let surface: DocumentSurface = { kind: 'flow' };

    function disposeRenderer(): void {
        retained?.layouts.dispose();
        retained?.kernel.destroy();
        retained = undefined;
        cached = undefined;
    }

    async function renderer(input: RenderInput, directory: string): Promise<NativeTextKernel> {
        current = { input, directory };
        const images = new Map<string, Uint8Array>();
        const fingerprint = createHash('sha256').update(
            JSON.stringify(Object.entries(input.fonts ?? build.fonts).sort()),
        );
        for (const [source, asset] of Object.entries(input.assets ?? {}).sort()) {
            if (!/^[a-z0-9-]+\.bin$/i.test(asset)) throw new Error('Invalid image asset identity');
            const bytes = new Uint8Array(await readFile(join(directory, asset)));
            images.set(source, bytes);
            fingerprint.update(JSON.stringify(source)).update(createHash('sha256').update(bytes).digest());
        }
        const key = fingerprint.digest('hex');
        if (retained?.key === key) return retained.kernel;
        disposeRenderer();
        const kernel = await NativeTextKernel.withAssets(
            await (canvasKit ??= CanvasKitInit(wasmOptions)),
            async (file) => {
                if (!/^[a-z0-9-]+$/i.test(file)) throw new Error('Invalid font identity');
                const input = current.input;
                const fingerprint = input.fonts?.[file] ?? build.fonts[file];
                if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Invalid retained font fingerprint');
                const path =
                    input.fonts?.[file] && input.fontRoot
                        ? join(input.fontRoot, `${fingerprint}.ttf`)
                        : join(fontRoot, `${file}.ttf`);
                const bytes = await readFile(path);
                if (createHash('sha256').update(bytes).digest('hex') !== fingerprint)
                    throw new Error('The document font differs from its editor build');
                return new Uint8Array(bytes);
            },
            async (source) => {
                const bytes = images.get(source);
                if (bytes) return { bytes };
                if (
                    !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source) ||
                    source.length > 40 * 1024 * 1024
                )
                    throw new Error('The document image is not in its authorized asset manifest');
                return { bytes: new Uint8Array(Buffer.from(source.slice(source.indexOf(',') + 1), 'base64')) };
            },
        );
        retained = {
            key,
            kernel,
            layouts: new DocumentLayoutController({ kernel: () => retained?.kernel, surface: () => surface }),
        };
        return kernel;
    }

    async function renderNativeInput(input: RenderInput, directory: string): Promise<unknown> {
        if (typeof input.id !== 'string' || !input.id || input.id.length > 255)
            throw new Error('A document identity is required');
        const started = performance.now();
        if (input.prepareSource !== undefined) {
            if (
                input.prepareSource !== true ||
                input.pdfSurface !== undefined ||
                input.fillFields !== undefined ||
                input.validateOnly ||
                input.includeContent
            )
                throw new Error('Invalid source preparation operation');
            const original = new Uint8Array(await readFile(join(directory, 'input.pdf')));
            const log = console.log;
            let prepared: Uint8Array;
            console.log = (...messages: unknown[]) => {
                process.stderr.write(`${messages.map(String).join(' ')}\n`);
            };
            try {
                prepared = await preparePdfSourceForms(original, async (data) => {
                    const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
                    GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
                    const directory = dirname(require.resolve('pdfjs-dist/package.json'));
                    return getDocument({
                        data,
                        useSystemFonts: false,
                        verbosity: 0,
                        standardFontDataUrl: join(directory, 'standard_fonts/'),
                        cMapUrl: join(directory, 'cmaps/'),
                        cMapPacked: true,
                    }).promise;
                });
            } finally {
                console.log = log;
            }
            await writeFile(join(directory, 'document.pdf'), prepared, { flag: 'wx' });
            return {
                version: identity,
                preparedSource: true,
                changed: prepared !== original,
                elapsedMs: performance.now() - started,
            };
        }
        const inputPdf =
            input.pdfSurface || input.fillFields !== undefined
                ? new Uint8Array(await readFile(join(directory, 'input.pdf')))
                : undefined;
        const sourceKey = inputPdf ? createHash('sha256').update(inputPdf).digest('hex') : '';
        const contentKey = (content: unknown) =>
            createHash('sha256')
                .update(JSON.stringify([input.id, sourceKey, input.storedFields === true, content]))
                .digest('hex');
        const key = contentKey(input.content);
        const kernel = await renderer(input, directory);
        let document = cached?.keys.has(key) ? cached.document : importDocument(input.content, input.id);
        try {
            if (input.frozenLayout !== undefined && input.fillFields === undefined)
                throw new Error('Frozen PDF fields require a fill operation');
            if (input.pdfSurface !== undefined && (input.pdfSurface !== true || input.fillFields !== undefined))
                throw new Error('Invalid PDF surface operation');
            if (input.fillFields !== undefined) await kernel.prepareFonts(document);
            else await kernel.prepare(document);
            if (input.fillFields !== undefined) {
                if (!Array.isArray(input.fillFields) || input.fillFields.some((id) => typeof id !== 'string'))
                    throw new Error('Invalid native fields');
                const result = await fillNativePdf(inputPdf!, document, kernel, input.fillFields, input.frozenLayout);
                await writeFile(join(directory, 'document.pdf'), result.bytes, { flag: 'wx' });
                return { version: identity, fields: result.fields, elapsedMs: performance.now() - started };
            }
            const source = input.pdfSurface ? inputPdf : undefined;
            const sourcePages = source
                ? await pdfSourcePages(
                      source,
                      input.storedFields ? [] : nativeFields(document).map((field) => field.id),
                  )
                : undefined;
            if (input.storedFields) {
                if (!sourcePages || !input.validateOnly || !input.content || typeof input.content !== 'object')
                    throw new Error('Invalid stored PDF field map');
                const content = input.content as { attrs?: Record<string, unknown> };
                const fields = content.attrs?.blockVariables;
                if (!Array.isArray(fields)) throw new Error('Invalid stored PDF fields');
                const widgets = sourceWidgetBoxes(
                    await PDFDocument.load(inputPdf!, { updateMetadata: false }),
                    fields.map((field) => field.id),
                );
                document = importDocument(
                    {
                        ...content,
                        attrs: {
                            ...content.attrs,
                            blockVariables: fields.map((field) => {
                                const widget = widgets.get(field.id);
                                const page = sourcePages[(widget?.page ?? Number(field.settings?.page)) - 1];
                                if (!page) throw new Error('The stored field page is unavailable');
                                return {
                                    ...field,
                                    settings: {
                                        ...field.settings,
                                        page: page.number,
                                        relativeXPct: (widget?.x ?? Number(field.x) * 0.75) / page.width,
                                        relativeYPct: (widget?.y ?? Number(field.y) * 0.75) / page.height,
                                        widthPct: (widget?.width ?? Number(field.width) * 0.75) / page.width,
                                        heightPct: (widget?.height ?? Number(field.height) * 0.75) / page.height,
                                    },
                                };
                            }),
                        },
                        content: sourcePages.map((page) => ({ type: 'pdfPage', attrs: { number: page.number } })),
                    },
                    input.id,
                );
            }
            surface = sourcePages ? { kind: 'pdf', pages: sourcePages } : { kind: 'flow' };
            const layouts = retained!.layouts;
            const prepared = layouts.cached(document) ?? layouts.hydrate(document, kernel);
            layouts.remember(document, prepared);
            document = prepared.document;
            const scene = prepared.scene;
            layouts.display(document, scene);
            kernel.clearUnused(new Set());
            const normalized = exportDocument(persistNativeIdentities(document));
            cached = { keys: new Set([key, contentKey(normalized)]), document };
            const metadata = {
                version: identity,
                artifact: build.artifact,
                ...(source ? { surface: 'pdf' } : {}),
                coverPages: scene.coverPages ?? 0,
                elapsedMs: performance.now() - started,
                fontHash: scene.fontHash,
                fonts: build.fonts,
                pages: scene.pages.map((page) => ({ width: page.width, height: page.height })),
                review: {
                    encoding: 'deflate-base64',
                    data: deflateSync(JSON.stringify(sceneReviewMap(document, scene))).toString('base64'),
                },
                fields: sourcePages
                    ? pdfSourceFieldBoxes(scene, sourcePages)
                    : scene.pages.flatMap((page, index) =>
                          page.commands.flatMap((command) =>
                              command.kind === 'field'
                                  ? [
                                        {
                                            id: command.nodeId,
                                            page: index + 1,
                                            x: command.x,
                                            y: command.y,
                                            width: command.width,
                                            height: command.height,
                                        },
                                    ]
                                  : [],
                          ),
                      ),
            };
            if (input.validateOnly)
                return {
                    ...metadata,
                    validated: true,
                    ...(input.includeContent ? { content: normalized } : {}),
                };
            const pdf =
                source && sourcePages
                    ? await writePdfOverlayDocument(source, scene, kernel, () => document, sourcePages)
                    : await writeScenePdf(scene, kernel, () => document, {
                          title: input.title,
                          compress: (contents) => new Uint8Array(deflateSync(contents)),
                          objectsPerTick: 100000,
                      });
            await writeFile(join(directory, 'document.pdf'), pdf, { flag: 'wx' });
            if (input.includeManifest)
                await writeFile(join(directory, 'scene.json'), JSON.stringify(sceneManifest(scene)), { flag: 'wx' });
            return { ...metadata, elapsedMs: performance.now() - started };
        } catch (error) {
            disposeRenderer();
            throw error;
        }
    }

    async function warmRenderer(): Promise<void> {
        const input: RenderInput = {
            id: 'runtime-startup',
            content: {
                type: 'doc',
                content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Ready العربية' }] },
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Ready العربية',
                                marks: [{ type: 'textStyle', attrs: { fontFamily: 'Tajawal' } }],
                            },
                        ],
                    },
                ],
            },
        };
        const kernel = await renderer(input, fontRoot);
        await kernel.prepare(importDocument(input.content, input.id));
    }

    return { render: renderNativeInput, warm: warmRenderer, dispose: disposeRenderer };
}
