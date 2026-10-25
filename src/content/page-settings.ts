import { isRecord, type Json } from '../document/model.js';
import { color } from '../typography/style.js';
import {
    MARGIN_MAX,
    MARGIN_MIN,
    MARGIN_SIDES,
    PAPER_SIZES,
    type PageLayout,
    type PageLayoutOverride,
    type PaperSize,
} from './page-layout-types.js';

export function validPageNumber(page: number): void {
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new Error('Invalid page number');
}

export function paperDimensions(size: PaperSize = 'a4'): { width: number; height: number } {
    const value = typeof size === 'string' && Object.hasOwn(PAPER_SIZES, size) ? PAPER_SIZES[size] : size;
    if (
        !value ||
        typeof value !== 'object' ||
        !['width', 'height'].every((key) => {
            const dimension = value[key as keyof typeof value];
            return typeof dimension === 'number' && Number.isFinite(dimension) && dimension >= 72 && dimension <= 14400;
        })
    )
        throw new Error('Invalid paper size');
    return { width: value.width, height: value.height };
}

export function validatePageSettings(settings: PageLayoutOverride): void {
    if (settings.orientation !== undefined && !['portrait', 'landscape'].includes(settings.orientation))
        throw new Error('Invalid page orientation');
    if (
        settings.margins !== undefined &&
        (!isRecord(settings.margins as Json) ||
            MARGIN_SIDES.some((side) => {
                const value = settings.margins![side];
                return value !== undefined && (!Number.isFinite(value) || value < MARGIN_MIN || value > MARGIN_MAX);
            }))
    )
        throw new Error('Invalid page margins');
    if (settings.size !== undefined) paperDimensions(settings.size);
    for (const key of ['header', 'footer'] as const)
        if (settings[key] !== undefined && typeof settings[key] !== 'boolean')
            throw new Error('Invalid page visibility');
    const background = settings.background;
    if (background !== undefined && background !== null) {
        if (!isRecord(background as Json)) throw new Error('Invalid page background');
        if (background.color !== undefined) {
            if (typeof background.color !== 'string' || !background.color.trim())
                throw new Error('Invalid page background color');
            color(background.color);
        }
        if (background.src !== undefined && (typeof background.src !== 'string' || !background.src.trim()))
            throw new Error('Invalid page background image');
        if (background.fit !== undefined && !['cover', 'contain', 'stretch'].includes(background.fit))
            throw new Error('Invalid page background fit');
    }
}

export function assertWritablePage(layout: PageLayout): void {
    if (
        !layout.margins ||
        MARGIN_SIDES.some((side) => !Number.isFinite(layout.margins[side]) || layout.margins[side] < 0)
    )
        throw new Error('Invalid page margins');
    const size = paperDimensions(layout.size);
    const width =
        layout.orientation === 'landscape' ? Math.max(size.width, size.height) : Math.min(size.width, size.height);
    const height =
        layout.orientation === 'landscape' ? Math.min(size.width, size.height) : Math.max(size.width, size.height);
    if (
        width - (layout.margins.left + layout.margins.right) * 0.75 < 36 ||
        height - (layout.margins.top + layout.margins.bottom) * 0.75 < 36
    )
        throw new Error('Page margins leave no writable area');
}
