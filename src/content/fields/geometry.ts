import type { Attributes } from '../../document/model.js';
import { fieldSettings } from './queries.js';

export interface FieldBounds {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
export interface FieldPlacement extends FieldBounds {
    readonly page: number;
}
export type FieldHandle = 'move' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export function transformField(
    box: FieldBounds,
    handle: FieldHandle,
    dx: number,
    dy: number,
    page: { width: number; height: number },
): FieldBounds {
    if (![box.x, box.y, box.width, box.height, dx, dy, page.width, page.height].every(Number.isFinite))
        throw new Error('Invalid field position');
    const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
    if (handle === 'move')
        return {
            ...box,
            x: clamp(box.x + dx, 0, page.width - box.width),
            y: clamp(box.y + dy, 0, page.height - box.height),
        };
    let left = box.x,
        top = box.y,
        right = box.x + box.width,
        bottom = box.y + box.height;
    const minimumWidth = Math.min(9, box.width),
        minimumHeight = Math.min(9, box.height);
    if (handle.includes('w')) left = clamp(left + dx, 0, right - minimumWidth);
    if (handle.includes('e')) right = clamp(right + dx, left + minimumWidth, page.width);
    if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minimumHeight);
    if (handle.includes('s')) bottom = clamp(bottom + dy, top + minimumHeight, page.height);
    return { x: left, y: top, width: right - left, height: bottom - top };
}

export function floatingFieldPlacement(
    attrs: Attributes,
    page: { width: number; height: number },
    legacyStride: number,
): FieldPlacement {
    const settings = fieldSettings(attrs);
    const normalized = ['relativeXPct', 'relativeYPct', 'widthPct', 'heightPct'].every(
        (key) => typeof settings[key] === 'number' && Number.isFinite(settings[key]),
    );
    const rawY = typeof attrs.y === 'number' ? attrs.y : 0;
    if (normalized && Number.isInteger(settings.page) && Number(settings.page) >= 1)
        return {
            page: Number(settings.page) - 1,
            x: Number(settings.relativeXPct) * page.width,
            y: Number(settings.relativeYPct) * page.height,
            width: Number(settings.widthPct) * page.width,
            height: Number(settings.heightPct) * page.height,
        };
    const index = Math.max(0, Math.floor(rawY / legacyStride));
    return {
        page: index,
        x: Number(attrs.x ?? 0) * 0.75,
        y: (rawY - index * legacyStride) * 0.75,
        width: Number(attrs.width ?? 200) * 0.75,
        height: Number(attrs.height ?? 24) * 0.75,
    };
}
