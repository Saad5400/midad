import { PDFBool, PDFDict, PDFDocument, PDFName } from 'pdf-lib';

export function assertSourceFormFields(source: PDFDocument, ids: readonly string[]): void {
    const native = new Set(ids);
    if (native.size !== ids.length) throw new Error('The native document contains duplicate field names');
    const fields = source.catalog.has(PDFName.of('AcroForm')) ? source.getForm().getFields() : [];
    const names = new Set<string>();
    for (const field of fields) {
        const name = field.getName();
        if (names.has(name)) throw new Error('The source PDF contains duplicate field names');
        if (native.has(name)) throw new Error('A native field conflicts with a source PDF field');
        names.add(name);
    }
    const form = source.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    if (ids.length && fields.length && form?.lookupMaybe(PDFName.of('NeedAppearances'), PDFBool) === PDFBool.True)
        throw new Error('Resolve source form appearances before native field export');
}
