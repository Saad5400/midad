import type { PdfReviewMap } from '../review.js';

export interface EncodedPdfReviewMap {
    encoding: 'deflate-base64';
    data: string;
}
export type PdfReviewData = PdfReviewMap | EncodedPdfReviewMap;
const cache = new WeakMap<object, Promise<PdfReviewMap>>();
function validate(value: unknown): PdfReviewMap {
    const map = value as PdfReviewMap;
    if (
        !map ||
        map.version !== 1 ||
        !Array.isArray(map.blocks) ||
        !Array.isArray(map.rows) ||
        !Array.isArray(map.pages)
    )
        throw new Error('Invalid frozen PDF review index');
    let length = 0;
    for (const block of map.blocks) {
        if (
            typeof block.id !== 'string' ||
            typeof block.text !== 'string' ||
            !Array.isArray(block.aliases) ||
            !block.aliases.every((id) => typeof id === 'string')
        )
            throw new Error('Invalid frozen PDF review block');
        length += block.text.length;
    }
    if (length > 10_000_000 || map.pages.length > 2000) throw new Error('The PDF review index exceeds its size limit');
    return map;
}
export function decodeReviewMap(value: PdfReviewData): Promise<PdfReviewMap> {
    if (!value || typeof value !== 'object') return Promise.reject(new Error('Invalid frozen PDF review index'));
    const existing = cache.get(value);
    if (existing) return existing;
    const decode = async (): Promise<PdfReviewMap> => {
        if (!('encoding' in value)) return validate(value);
        if (
            value.encoding !== 'deflate-base64' ||
            typeof value.data !== 'string' ||
            value.data.length > 12 * 1024 * 1024
        )
            throw new Error('Invalid frozen PDF review encoding');
        const bytes = Uint8Array.from(atob(value.data), (character) => character.charCodeAt(0));
        if (bytes.length > 8 * 1024 * 1024) throw new Error('The PDF review index exceeds its size limit');
        const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
            while (true) {
                const { value: chunk, done } = await reader.read();
                if (done) break;
                size += chunk.byteLength;
                if (size > 32 * 1024 * 1024) throw new Error('The PDF review index exceeds its size limit');
                chunks.push(chunk);
            }
            const result = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.byteLength;
            }
            return validate(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result)));
        } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
        }
    };
    const pending = decode().catch((error) => {
        cache.delete(value);
        throw error;
    });
    cache.set(value, pending);
    return pending;
}
