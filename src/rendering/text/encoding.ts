import type { ShapedParagraph } from './model.js';

export const INVALID_TEXT_OFFSET = 0xffffffff;
export interface Utf8TextIndex {
    offsets: Uint32Array;
    wellFormed: boolean;
}
const indexes = new WeakMap<ShapedParagraph, Utf8TextIndex>();
const length = (code: number) => (code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4);

export function utf8Index(text: string): Utf8TextIndex {
    let size = 0;
    let wellFormed = true;
    for (let at = 0; at < text.length; ) {
        const code = text.codePointAt(at)!;
        size += length(code);
        if (code >= 0xd800 && code <= 0xdfff) wellFormed = false;
        at += code > 0xffff ? 2 : 1;
    }
    const offsets = new Uint32Array(size + 1).fill(INVALID_TEXT_OFFSET);
    let byte = 0;
    let at = 0;
    while (at < text.length) {
        const code = text.codePointAt(at)!;
        offsets[byte] = at;
        byte += length(code);
        at += code > 0xffff ? 2 : 1;
    }
    offsets[byte] = at;
    return { offsets, wellFormed };
}

export function rememberTextIndex(shaped: ShapedParagraph, index: Utf8TextIndex): void {
    indexes.set(shaped, index);
}

export function textIndex(shaped: ShapedParagraph): Utf8TextIndex {
    const cached = indexes.get(shaped);
    if (cached) return cached;
    const index = utf8Index(shaped.text);
    indexes.set(shaped, index);
    return index;
}
