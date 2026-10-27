import { copyJson, type NativeDocument } from '../document/model.js';
import { update } from '../editing/text.js';
import { documentTextStyle } from '../typography/style.js';

export interface DocumentTypography {
    readonly fontFamily: string;
}
export const DEFAULT_DOCUMENT_TYPOGRAPHY: DocumentTypography = Object.freeze({ fontFamily: 'Tajawal' });

export function setDocumentTypography(
    document: NativeDocument,
    settings: DocumentTypography | undefined,
): NativeDocument {
    if (JSON.stringify(document.root.attributes?.typography) === JSON.stringify(settings)) return document;
    const attributes = { ...document.root.attributes };
    if (settings) attributes.typography = copyJson(settings);
    else delete attributes.typography;
    const root = Object.freeze({ ...document.root, attributes: Object.freeze(attributes) });
    documentTextStyle({ ...document, root });
    return update(document, document.root, [root]);
}

export function initializeDocumentTypography(
    document: NativeDocument,
    settings = DEFAULT_DOCUMENT_TYPOGRAPHY,
): NativeDocument {
    if (
        document.root.attributes?.typography !== undefined ||
        (document.root.attributes?.blockVariables as readonly unknown[] | undefined)?.length ||
        (document.root.attributes?.floatingImages as readonly unknown[] | undefined)?.length ||
        !(document.root.children ?? []).every(
            (node) =>
                node.kind === 'paragraph' &&
                (node.children ?? []).every((child) => child.kind === 'text' && !child.text),
        )
    )
        return document;
    const next = setDocumentTypography(document, settings);
    return Object.freeze({ ...next, revision: document.revision });
}
