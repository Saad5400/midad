import type { Map as SharedMap } from 'yjs';
import { copyJson, isRecord, type Attributes, type Json, type NativeMark } from '../document/model.js';

export function encodeSharedBytes(bytes: Uint8Array): string {
    const chunks: string[] = [];
    for (let index = 0; index < bytes.length; index += 32768)
        chunks.push(String.fromCharCode(...bytes.subarray(index, index + 32768)));
    return btoa(chunks.join(''));
}
export function decodeSharedBytes(value: string, maximum = 24 * 1024 * 1024): Uint8Array {
    if (value.length > (maximum * 4) / 3 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
        throw new Error('Invalid shared document encoding');
    const binary = atob(value);
    if (binary.length > maximum) throw new Error('The shared document is too large');
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
export function canonicalSharedJson(value: unknown): string {
    const sort = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(sort);
        if (value === null || typeof value !== 'object') return value;
        return Object.fromEntries(
            Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, entry]) => [key, sort(entry)]),
        );
    };
    return JSON.stringify(sort(value));
}
export function flatSharedAttributes(attributes: Attributes): Map<string, Json> {
    const result = new Map<string, Json>();
    const visit = (value: Json, path: string[]): void => {
        if (path.length > 32) throw new Error('Shared attributes are nested too deeply');
        if (path.at(-1) !== 'nativeAnchor' && isRecord(value) && Object.keys(value).length)
            Object.entries(value).forEach(([key, child]) => visit(child, [...path, key]));
        else result.set(JSON.stringify(path), value);
    };
    Object.entries(attributes).forEach(([key, value]) => visit(value, [key]));
    return result;
}
export function writeSharedAttributes(target: SharedMap<Json>, before: Attributes, after: Attributes): void {
    const previous = flatSharedAttributes(before),
        current = flatSharedAttributes(after);
    for (const [key, value] of current)
        if (!previous.has(key) || canonicalSharedJson(previous.get(key)) !== canonicalSharedJson(value))
            target.set(key, copyJson(value));
    for (const key of previous.keys()) if (!current.has(key)) target.delete(key);
}
export function readSharedAttributes(source: SharedMap<Json>): Attributes {
    const result: Record<string, Json> = Object.create(null);
    const entries = [...source]
        .filter(([key]) => key.startsWith('['))
        .map(([key, value]) => ({ key, value, path: JSON.parse(key) as unknown }));
    entries.sort(
        (a, b) =>
            (Array.isArray(a.path) ? a.path.length : 0) - (Array.isArray(b.path) ? b.path.length : 0) ||
            a.key.localeCompare(b.key),
    );
    for (const { value, path } of entries) {
        if (!Array.isArray(path) || !path.length || path.length > 32 || path.some((key) => typeof key !== 'string'))
            throw new Error('Invalid shared attribute path');
        let target = result;
        for (const part of path.slice(0, -1)) {
            const current = Object.hasOwn(target, part) && isRecord(target[part]) ? target[part] : undefined;
            const child = Object.assign(Object.create(null), current) as Record<string, Json>;
            target[part] = child;
            target = child;
        }
        target[path[path.length - 1]] = copyJson(value);
    }
    return copyJson(result) as Attributes;
}
export function sharedTextAttributes(
    marks: readonly NativeMark[] | undefined,
    attributes?: Attributes,
): Record<string, Json> {
    const result: Record<string, Json> = {};
    if (marks?.length) result.markOrder = marks.map((mark) => mark.kind);
    for (const mark of marks ?? []) {
        if (mark.kind === 'textStyle')
            for (const [key, value] of Object.entries(mark.attributes ?? {})) result[`style:${key}`] = value;
        else result[`mark:${mark.kind}`] = mark.attributes ? copyJson(mark.attributes) : true;
    }
    if (attributes) {
        const raw = Object.fromEntries(
            Object.entries(attributes).filter(([key]) => key !== 'id' && key !== 'nativeId'),
        );
        if (Object.keys(raw).length) result.textAttributes = copyJson(raw);
    }
    return result;
}
export function nativeSharedMarks(attributes: Record<string, Json>): readonly NativeMark[] {
    const marks: NativeMark[] = [];
    for (const [key, value] of Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b)))
        if (key.startsWith('mark:') && value !== null && value !== false)
            marks.push({ kind: key.slice(5), ...(isRecord(value) ? { attributes: value } : {}) });
    const style = Object.fromEntries(
        Object.entries(attributes)
            .filter(([key, value]) => key.startsWith('style:') && value !== null)
            .map(([key, value]) => [key.slice(6), value]),
    );
    if (Object.keys(style).length) marks.push({ kind: 'textStyle', attributes: style });
    const order = Array.isArray(attributes.markOrder) ? attributes.markOrder : [];
    marks.sort((a, b) => {
        const left = order.indexOf(a.kind),
            right = order.indexOf(b.kind);
        return (left < 0 ? order.length : left) - (right < 0 ? order.length : right) || a.kind.localeCompare(b.kind);
    });
    return Object.freeze(marks);
}
