import type { CanvasKit, FontCollection, Typeface } from 'canvaskit-wasm';
import { fontUrl } from '../../typography/fonts.js';
import type { NativeFontAsset } from './model.js';

export const NATIVE_FONT_ID = 'amiri-regular';

const fontLoads = new Map<string, Promise<{ bytes: Uint8Array; hash: string }>>();
async function hash(bytes: Uint8Array): Promise<string> {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)), (value) =>
        value.toString(16).padStart(2, '0'),
    ).join('');
}

export class TextFonts {
    private collection?: FontCollection;
    private assets = new Map<string, NativeFontAsset>();
    readonly provider;

    constructor(
        private readonly ck: CanvasKit,
        private readonly readFont?: (file: string) => Promise<Uint8Array>,
    ) {
        this.provider = ck.TypefaceFontProvider.Make();
    }

    async load(files: ReadonlySet<string>): Promise<string> {
        const missing = [...files].filter((file) => !this.assets.has(file === 'amiri' ? NATIVE_FONT_ID : file));
        await Promise.all(
            missing.map(async (file) => {
                let load = this.readFont
                    ? this.readFont(file).then(async (bytes) => ({ bytes, hash: await hash(bytes) }))
                    : fontLoads.get(file);
                if (!load) {
                    const url = fontUrl(file);
                    if (!url) throw new Error(`The document font is missing: ${file}`);
                    load = fetch(url)
                        .then(async (response) => {
                            if (!response.ok) throw new Error(`The document font could not be downloaded: ${file}`);
                            const bytes = new Uint8Array(await response.arrayBuffer());
                            return { bytes, hash: await hash(bytes) };
                        })
                        .catch((error) => {
                            fontLoads.delete(file);
                            throw error;
                        });
                    fontLoads.set(file, load);
                }
                const { bytes, hash: fontHash } = await load;
                const id = file === 'amiri' ? NATIVE_FONT_ID : file;
                this.provider.registerFont(bytes, `Native-${id}`);
                const typeface = this.provider.matchFamilyStyle(`Native-${id}`, {
                    weight: this.ck.FontWeight.Normal,
                    width: this.ck.FontWidth.Normal,
                    slant: this.ck.FontSlant.Upright,
                });
                if (!typeface) throw new Error(`The document font could not be loaded: ${file}`);
                this.assets.set(
                    id,
                    Object.freeze({
                        id,
                        get bytes() {
                            return new Uint8Array(bytes);
                        },
                        hash: fontHash,
                        typeface,
                        family: typeface.getFamilyName(),
                    }),
                );
            }),
        );
        if (missing.length) {
            this.collection?.delete();
            this.collection = undefined;
        }
        return this.fingerprint(files);
    }

    collectionForShaping(): FontCollection {
        if (!this.collection) {
            const collection = this.ck.FontCollection.Make();
            try {
                collection.setDefaultFontManager(this.provider);
                collection.enableFontFallback();
                this.collection = collection;
            } catch (failure) {
                collection.delete();
                throw failure;
            }
        }
        return this.collection;
    }

    async fingerprint(files: ReadonlySet<string>): Promise<string> {
        return hash(
            new TextEncoder().encode(
                JSON.stringify(
                    [...new Set(['amiri', ...files])]
                        .map((file) => this.get(file === 'amiri' ? NATIVE_FONT_ID : file))
                        .map((asset) => [asset.id, asset.hash])
                        .sort(),
                ),
            ),
        );
    }

    get(id: string): NativeFontAsset {
        const font = this.assets.get(id);
        if (!font) throw new Error(`The document font has not been prepared: ${id}`);
        return font;
    }

    match(typeface: Typeface): NativeFontAsset | undefined {
        return [...this.assets.values()].find((asset) => typeface.isAliasOf(asset.typeface));
    }

    destroy(): void {
        this.collection?.delete();
        this.collection = undefined;
        for (const asset of this.assets.values()) asset.typeface.delete();
        this.assets.clear();
        this.provider.delete();
    }
}
