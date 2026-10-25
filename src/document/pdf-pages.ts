import type { NativeDocument } from './model.js';

export function pdfPageNumbers(document: NativeDocument): readonly number[] | undefined {
    const pages = document.root.children;
    if (
        !pages?.length ||
        pages.some(
            (page, index) =>
                page.kind !== 'pdfPage' ||
                Boolean(page.children?.length) ||
                Number(page.attributes?.number) !== index + 1,
        )
    )
        return undefined;
    return Object.freeze(pages.map((page) => Number(page.attributes?.number)));
}
