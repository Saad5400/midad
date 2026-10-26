import { bindFloatingAnchors } from '../../content/floating-anchors.js';
import type { NativeDocument } from '../../document/model.js';
import { retainMeasurements } from '../../layout/measurement.js';
import { layoutDocumentSurface, type DocumentSurface } from '../../layout/surface.js';
import type { DocumentScene } from '../../layout/scene.js';
import type { NativeTextKernel } from '../../rendering/kernel.js';

export interface DocumentLayout {
    readonly document: NativeDocument;
    readonly scene: DocumentScene;
}
export interface PreparedDocumentLayout extends DocumentLayout {
    release(): void;
}
export interface DocumentLayoutOptions {
    kernel: () => NativeTextKernel | undefined;
    surface?: () => DocumentSurface;
    validate?: (document: NativeDocument) => void;
}
interface RetainedLayout {
    readonly source: NativeDocument;
    readonly layout: DocumentLayout;
    readonly kernel: NativeTextKernel;
    readonly surface: string;
    readonly release: () => void;
}
function identity(surface: DocumentSurface): string {
    return surface.kind === 'flow'
        ? `flow:${surface.width ?? ''}`
        : JSON.stringify(['pdf', surface.pages.map((page) => [page.number, page.width, page.height])]);
}

export class DocumentLayoutController {
    private readonly origins = new WeakMap<
        DocumentScene,
        { kernel: NativeTextKernel; surface: string; document: NativeDocument }
    >();
    private displayed: RetainedLayout | undefined;
    private staged: RetainedLayout | undefined;
    private disposed = false;

    constructor(private readonly options: DocumentLayoutOptions) {}

    private renderer(value = this.options.kernel()): NativeTextKernel {
        if (this.disposed || !value) throw new Error('The document renderer is unavailable');
        return value;
    }
    private surface(document: NativeDocument): DocumentSurface {
        if (this.disposed) throw new Error('The document layout was closed');
        this.options.validate?.(document);
        return this.options.surface?.() ?? { kind: 'flow' };
    }
    layout(document: NativeDocument, kernel = this.renderer()): DocumentScene {
        const renderer = this.renderer(kernel),
            surface = this.surface(document);
        const scene = layoutDocumentSurface(document, renderer, surface);
        this.origins.set(scene, { kernel: renderer, surface: identity(surface), document });
        return scene;
    }
    hydrate(document: NativeDocument, kernel = this.renderer()): DocumentLayout {
        const renderer = this.renderer(kernel),
            surface = this.surface(document),
            scene = layoutDocumentSurface(document, renderer, surface),
            hydrated = surface.kind === 'pdf' ? document : bindFloatingAnchors(document, scene);
        const result = {
            document: hydrated,
            scene: hydrated === document ? scene : layoutDocumentSurface(hydrated, renderer, surface),
        };
        this.origins.set(result.scene, { kernel: renderer, surface: identity(surface), document: result.document });
        return result;
    }
    async prepare(document: NativeDocument): Promise<PreparedDocumentLayout> {
        const kernel = this.renderer();
        await kernel.prepare(document);
        if (kernel !== this.options.kernel()) throw new Error('The document renderer changed');
        const prepared = this.hydrate(document, kernel);
        return { ...prepared, release: this.retain(prepared, kernel) };
    }
    private retain(layout: DocumentLayout, kernel: NativeTextKernel): () => void {
        const paragraphs = kernel.retainParagraphs(
            layout.scene.pages.flatMap((page) => page.lines.map((line) => line.shaped)),
        );
        const measurements = retainMeasurements(kernel, layout.document);
        return () => {
            paragraphs();
            measurements();
        };
    }
    private hold(source: NativeDocument, layout: DocumentLayout): RetainedLayout {
        const kernel = this.renderer();
        if (source.id !== layout.scene.documentId || source.revision !== layout.scene.revision)
            throw new Error('The document layout revision changed');
        const surface = identity(this.surface(source)),
            origin = this.origins.get(layout.scene);
        if (
            origin?.kernel !== kernel ||
            origin.surface !== surface ||
            layout.scene.fontHash !== kernel.fontHashFor(source)
        )
            throw new Error('The document layout context changed');
        return {
            source,
            layout,
            kernel,
            surface,
            release: this.retain(layout, kernel),
        };
    }
    remember(source: NativeDocument, layout: DocumentLayout): void {
        const next = this.hold(source, layout);
        this.staged?.release();
        this.staged = next;
    }
    cached(document: NativeDocument, kernel = this.renderer()): DocumentLayout | undefined {
        const renderer = this.renderer(kernel),
            surface = identity(this.surface(document));
        for (const entry of [this.staged, this.displayed])
            if (
                entry &&
                (entry.source === document || entry.layout.document === document) &&
                entry.kernel === renderer &&
                entry.surface === surface &&
                entry.layout.scene.fontHash === renderer.fontHashFor(document)
            )
                return entry.layout;
    }
    display(document: NativeDocument, scene: DocumentScene | undefined): void {
        if (this.disposed) return;
        if (!scene) {
            this.displayed?.release();
            this.displayed = undefined;
            return;
        }
        const layout = this.cached(document);
        const next = this.hold(
            document,
            layout?.scene === scene ? layout : { document: this.origins.get(scene)?.document ?? document, scene },
        );
        this.displayed?.release();
        this.displayed = next;
        if (scene === this.staged?.layout.scene) {
            this.staged?.release();
            this.staged = undefined;
        }
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.displayed?.release();
        this.staged?.release();
        this.displayed = undefined;
        this.staged = undefined;
    }
}
