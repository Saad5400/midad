import { copyJson, isRecord, type NativeDocument } from '../document/model.js';
import { update } from '../editing/text.js';
import {
    documentPageLayout,
    pageLayoutForPage,
    pageLayoutOverride,
    type PageLayout,
    type PageLayoutOverride,
} from './page-layout-queries.js';
import { assertWritablePage, validatePageSettings, validPageNumber } from './page-settings.js';

export * from './page-layout-queries.js';

export function setDocumentPageLayout(document: NativeDocument, layout: PageLayout): NativeDocument {
    validatePageSettings(layout);
    assertWritablePage(layout);
    const previous = document.root.attributes?.pageLayout;
    const attributes = Object.freeze({
        ...document.root.attributes,
        pageLayout: copyJson({ ...(isRecord(previous) ? previous : {}), ...layout }),
    });
    const root = Object.freeze({ ...document.root, attributes });
    if (JSON.stringify(documentPageLayout(document)) === JSON.stringify(documentPageLayout({ ...document, root })))
        return document;
    return update(document, document.root, [root]);
}

export function setPageLayout(document: NativeDocument, pageNumber: number, patch: PageLayoutOverride): NativeDocument {
    validPageNumber(pageNumber);
    validatePageSettings(patch);
    const current = pageLayoutOverride(document, pageNumber);
    const merged = {
        ...current,
        ...patch,
        ...(patch.margins ? { margins: { ...current?.margins, ...patch.margins } } : {}),
    };
    if (merged.margins && !Object.keys(merged.margins).length) delete merged.margins;
    const next = copyJson(merged);
    if (!Object.keys(merged).length || JSON.stringify(current) === JSON.stringify(next)) return document;
    const previous = document.root.attributes?.pageLayout;
    const layout = isRecord(previous) ? previous : {};
    const overrides = isRecord(layout.overrides) ? layout.overrides : {};
    const attributes = copyJson({
        ...document.root.attributes,
        pageLayout: { ...layout, overrides: { ...overrides, [String(pageNumber)]: next } },
    });
    const result = update(document, document.root, [
        Object.freeze({ ...document.root, attributes: attributes as typeof document.root.attributes }),
    ]);
    pageLayoutForPage(result, pageNumber);
    return result;
}

export function clearPageLayout(document: NativeDocument, pageNumber: number): NativeDocument {
    validPageNumber(pageNumber);
    if (!pageLayoutOverride(document, pageNumber)) return document;
    const previous = document.root.attributes?.pageLayout;
    if (!isRecord(previous) || !isRecord(previous.overrides)) return document;
    const overrides = { ...previous.overrides };
    delete overrides[String(pageNumber)];
    const layout = { ...previous };
    delete layout.overrides;
    const attributes = copyJson({
        ...document.root.attributes,
        pageLayout: { ...layout, ...(Object.keys(overrides).length ? { overrides } : {}) },
    });
    return update(document, document.root, [
        Object.freeze({ ...document.root, attributes: attributes as typeof document.root.attributes }),
    ]);
}
