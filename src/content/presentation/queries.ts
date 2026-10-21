import type { Json, NativeDocument } from '../../document/model.js';

export interface PageMedia {
    readonly enabled: boolean;
    readonly src: string | null;
}
export interface NativePresentation {
    readonly cover: PageMedia;
    readonly header: PageMedia;
}
const record = (value: Json | undefined): value is Readonly<Record<string, Json>> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
export function documentPresentation(document: NativeDocument): NativePresentation {
    const value = document.root.attributes?.nativePresentation;
    if (value === undefined) return { cover: { enabled: false, src: null }, header: { enabled: false, src: null } };
    if (!record(value)) throw new Error('Invalid document presentation');
    const media = (kind: 'cover' | 'header'): PageMedia => {
        const entry = value[kind];
        if (
            !record(entry) ||
            typeof entry.enabled !== 'boolean' ||
            !(entry.src === null || (typeof entry.src === 'string' && entry.src.length))
        )
            throw new Error('Invalid document presentation media');
        return { enabled: entry.enabled, src: entry.src };
    };
    return { cover: media('cover'), header: media('header') };
}
export function headerTile(
    naturalWidth: number,
    naturalHeight: number,
    width: number,
    height: number,
): { width: number; height: number } {
    const aspectHeight = (naturalHeight * width) / naturalWidth;
    return { width, height: aspectHeight >= height * 0.8 ? height : aspectHeight };
}
