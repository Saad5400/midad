import { copyJson, isRecord, type NativeDocument } from '../document/model.js';
import { update } from '../editing/text.js';
import { documentPageLayout, MARGIN_MAX, MARGIN_MIN, MARGIN_SIDES, type PageLayout } from './page-layout-queries.js';

export * from './page-layout-queries.js';

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
