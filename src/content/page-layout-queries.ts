import { isRecord, type NativeDocument } from '../document/model.js';
import {
    MARGIN_SIDES,
    type PageBackground,
    type PageLayout,
    type PageLayoutOverride,
    type PageMargins,
    type PaperSize,
} from './page-layout-types.js';
import { assertWritablePage, paperDimensions, validPageNumber } from './page-settings.js';

export * from './page-layout-types.js';

export function pageSize(orientation: PageLayout['orientation'], paper?: PaperSize): { width: number; height: number } {
    const { width, height } = paperDimensions(paper);
    return orientation === 'landscape'
        ? { width: Math.max(width, height), height: Math.min(width, height) }
        : { width: Math.min(width, height), height: Math.max(width, height) };
}

function optionalSettings(
    value: Record<string, unknown>,
): Pick<PageLayout, 'size' | 'background' | 'header' | 'footer'> {
    return {
        ...(value.size !== undefined ? { size: value.size as PaperSize } : {}),
        ...(value.background !== undefined ? { background: value.background as PageBackground | null } : {}),
        ...(typeof value.header === 'boolean' ? { header: value.header } : {}),
        ...(typeof value.footer === 'boolean' ? { footer: value.footer } : {}),
    };
}

export function documentPageLayout(document: NativeDocument): PageLayout {
    const value = document.root.attributes?.pageLayout;
    const layout = isRecord(value) ? value : {};
    const margins = isRecord(layout.margins) ? layout.margins : {};
    return {
        ...optionalSettings(layout),
        orientation: layout.orientation === 'landscape' ? 'landscape' : 'portrait',
        margins: Object.fromEntries(
            MARGIN_SIDES.map((side) => [side, typeof margins[side] === 'number' ? margins[side] : 96]),
        ) as PageMargins,
    };
}

export function pageLayoutOverride(document: NativeDocument, pageNumber: number): PageLayoutOverride | undefined {
    validPageNumber(pageNumber);
    const layout = document.root.attributes?.pageLayout;
    const overrides = isRecord(layout) && isRecord(layout.overrides) ? layout.overrides : undefined;
    const value = overrides?.[String(pageNumber)];
    return isRecord(value) ? (value as unknown as PageLayoutOverride) : undefined;
}

export function pageLayoutForPage(document: NativeDocument, pageNumber: number): PageLayout {
    const defaults = documentPageLayout(document);
    const override = pageLayoutOverride(document, pageNumber);
    const result = override
        ? { ...defaults, ...override, margins: { ...defaults.margins, ...override.margins } }
        : defaults;
    assertWritablePage(result);
    return result;
}
