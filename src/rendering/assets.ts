import type { CanvasKit, Image } from 'canvaskit-wasm';
import { IMAGE_FIELD_TYPES, nativeFields } from '../content/fields/queries.js';
import { documentPageLayout } from '../content/page-layout-queries.js';
import { documentPresentation } from '../content/presentation/queries.js';
import type { NativeDocument, NativeNode } from '../document/model.js';
import { isRecord } from '../document/model.js';
import { decodeImage, rasterImage } from './raster-image.js';

export interface ImageAsset {
    readonly id: string;
    readonly bytes: Uint8Array;
    readonly image: Image;
    readonly width: number;
    readonly height: number;
}
export type MediaResolver = (source: string) => string | Promise<string>;
export type ImageReader = (source: string) => Promise<{ bytes: Uint8Array; mimeType?: string }>;

export class DocumentImages {
    private bySource = new Map<string, ImageAsset>();
    private byId = new Map<string, ImageAsset>();

    constructor(
        private readonly ck: CanvasKit,
        private readonly resolve: MediaResolver = (source) => source,
        private readonly read?: ImageReader,
    ) {}

    async prepare(document: NativeDocument): Promise<void> {
        const sources = new Set<string>();
        const visit = (node: NativeNode): void => {
            if (node.kind === 'image' && typeof node.attributes?.src === 'string') sources.add(node.attributes.src);
            node.children?.forEach(visit);
        };
        visit(document.root);
        for (const media of Object.values(documentPresentation(document)))
            if (media.enabled && media.src) sources.add(media.src);
        const layout = document.root.attributes?.pageLayout;
        const overrides =
            isRecord(layout) && isRecord(layout.overrides) ? Object.values(layout.overrides).filter(isRecord) : [];
        const background = documentPageLayout(document).background;
        if (background?.src) sources.add(background.src);
        for (const settings of overrides)
            if (isRecord(settings.background) && typeof settings.background.src === 'string')
                sources.add(settings.background.src);
        const header = documentPresentation(document).header;
        if (
            header.src &&
            (documentPageLayout(document).header === true || overrides.some((value) => value.header === true))
        )
            sources.add(header.src);
        for (const field of nativeFields(document))
            if (
                IMAGE_FIELD_TYPES.has(String(field.attributes.type)) &&
                typeof field.attributes.value === 'string' &&
                field.attributes.value
            )
                sources.add(field.attributes.value);
        const floating = document.root.attributes?.floatingImages;
        if (Array.isArray(floating))
            for (const image of floating)
                if (image && typeof image === 'object' && !Array.isArray(image) && typeof image.src === 'string')
                    sources.add(image.src);
        const results = await Promise.allSettled(
            [...sources].map(async (source) => {
                if (this.bySource.has(source)) return;
                const loaded = this.read ? await this.read(source) : await this.download(source);
                const encoded = loaded.bytes;
                if (encoded.length > 30 * 1024 * 1024) throw new Error('The document image exceeds the size limit');
                let image = this.ck.MakeImageFromEncoded(encoded);
                if (
                    !image &&
                    (loaded.mimeType?.includes('image/svg+xml') ||
                        /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(new TextDecoder().decode(encoded)))
                ) {
                    if (typeof globalThis.document === 'undefined')
                        throw new Error('SVG images require canonical PNG bytes');
                    const decoded = await decodeImage(new Blob([new Uint8Array(encoded)], { type: 'image/svg+xml' }));
                    try {
                        image = this.ck.MakeImageFromEncoded(await (await rasterImage(decoded)).arrayBuffer());
                    } finally {
                        URL.revokeObjectURL(decoded.src);
                    }
                }
                if (!image) throw new Error('A document image could not be decoded');
                const bytes = image.encodeToBytes(this.ck.ImageFormat.PNG);
                if (!bytes) {
                    image.delete();
                    throw new Error('A document image could not be prepared for PDF');
                }
                const id = Array.from(
                    new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)),
                    (value) => value.toString(16).padStart(2, '0'),
                ).join('');
                const existing = this.byId.get(id);
                if (existing) {
                    image.delete();
                    this.bySource.set(source, existing);
                    return;
                }
                const asset = Object.freeze({
                    id,
                    get bytes() {
                        return new Uint8Array(bytes);
                    },
                    image,
                    width: image.width(),
                    height: image.height(),
                });
                this.bySource.set(source, asset);
                this.byId.set(id, asset);
            }),
        );
        const failure = results.find((result) => result.status === 'rejected');
        if (failure) throw failure.reason;
    }

    private async download(source: string): Promise<{ bytes: Uint8Array; mimeType?: string }> {
        const response = await fetch(await this.resolve(source));
        if (!response.ok) throw new Error('A document image could not be downloaded');
        return {
            bytes: new Uint8Array(await response.arrayBuffer()),
            mimeType: response.headers.get('content-type') ?? undefined,
        };
    }

    source(source: string): ImageAsset {
        const asset = this.bySource.get(source);
        if (!asset) throw new Error('The document image has not been prepared');
        return asset;
    }

    alias(source: string, alias: string): void {
        this.bySource.set(alias, this.source(source));
    }

    get(id: string): ImageAsset {
        const asset = this.byId.get(id);
        if (!asset) throw new Error('The document image snapshot is unavailable');
        return asset;
    }

    destroy(): void {
        for (const asset of this.byId.values()) asset.image.delete();
        this.byId.clear();
        this.bySource.clear();
    }
}
