import { copyJson, type NativeDocument } from '../../document/model.js';
import { update } from '../../editing/text.js';
import { documentPresentation, type NativePresentation } from './queries.js';

export function setDocumentPresentation(document: NativeDocument, presentation: NativePresentation): NativeDocument {
    const current = documentPresentation(document);
    if (JSON.stringify(current) === JSON.stringify(presentation)) return document;
    const next = update(document, document.root, [
        Object.freeze({
            ...document.root,
            attributes: Object.freeze({ ...document.root.attributes, nativePresentation: copyJson(presentation) }),
        }),
    ]);
    documentPresentation(next);
    return next;
}
