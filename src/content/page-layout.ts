import { copyJson, isRecord, type NativeDocument } from '../document/model.js';
import { update } from '../editing/text.js';

export const MARGIN_SIDES = ['top', 'bottom', 'left', 'right'] as const;
export type MarginSide = (typeof MARGIN_SIDES)[number];
export type PageMargins = Readonly<Record<MarginSide, number>>;
export interface PageLayout {
    readonly orientation: 'portrait' | 'landscape';
    readonly margins: PageMargins;
}
export const MARGIN_MIN = 38;
export const MARGIN_MAX = 200;
export const PX_PER_CM = 96 / 2.54;
export const MARGIN_PRESETS = Object.freeze({
    normal: Object.freeze({ top: 96, bottom: 96, left: 96, right: 96 }),
    narrow: Object.freeze({ top: 48, bottom: 48, left: 48, right: 48 }),
    moderate: Object.freeze({ top: 96, bottom: 96, left: 72, right: 72 }),
    wide: Object.freeze({ top: 96, bottom: 96, left: 192, right: 192 }),
});

export function pageSize(orientation: PageLayout['orientation']): { width: number; height: number } {
    return orientation === 'landscape'
        ? { width: (297 * 72) / 25.4, height: (210 * 72) / 25.4 }
        : { width: (210 * 72) / 25.4, height: (297 * 72) / 25.4 };
}

export function documentPageLayout(document: NativeDocument): PageLayout {
    const value = document.root.attributes?.pageLayout;
    const layout = isRecord(value) ? value : {};
    const margins = isRecord(layout.margins) ? layout.margins : {};
    return {
        orientation: layout.orientation === 'landscape' ? 'landscape' : 'portrait',
        margins: Object.fromEntries(
            MARGIN_SIDES.map((side) => [side, typeof margins[side] === 'number' ? margins[side] : 96]),
        ) as PageMargins,
    };
}

export function setDocumentPageLayout(document: NativeDocument, layout: PageLayout): NativeDocument {
    if (layout.orientation !== 'portrait' && layout.orientation !== 'landscape')
        throw new Error('Invalid page orientation');
    if (
        MARGIN_SIDES.some(
            (side) =>
                !Number.isFinite(layout.margins[side]) ||
                layout.margins[side] < MARGIN_MIN ||
                layout.margins[side] > MARGIN_MAX,
        )
    )
        throw new Error('Invalid page margins');
    const current = documentPageLayout(document);
    if (
        current.orientation === layout.orientation &&
        MARGIN_SIDES.every((side) => current.margins[side] === layout.margins[side])
    )
        return document;
    const previous = document.root.attributes?.pageLayout;
    const attributes = Object.freeze({
        ...document.root.attributes,
        pageLayout: copyJson({ ...(isRecord(previous) ? previous : {}), ...layout }),
    });
    return update(document, document.root, [Object.freeze({ ...document.root, attributes })]);
}
