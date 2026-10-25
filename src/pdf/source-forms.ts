import { PDFBool, PDFDict, PDFDocument, PDFName, PDFStream } from 'pdf-lib';

export function sourceFormsNeedPreparation(source: PDFDocument): boolean {
    const form = source.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    if (!form) return false;
    if (form.lookupMaybe(PDFName.of('NeedAppearances'), PDFBool) === PDFBool.True) return true;
    return source
        .getForm()
        .getFields()
        .some((field) => {
            const type = source.context.lookup(field.acroField.getInheritableAttribute(PDFName.of('FT')));
            if (!['/Tx', '/Ch'].includes(type?.toString() ?? '')) return false;
            return field.acroField.getWidgets().some((widget) => {
                const appearance = widget.dict.lookupMaybe(PDFName.of('AP'), PDFDict);
                return !(source.context.lookup(appearance?.get(PDFName.of('N'))) instanceof PDFStream);
            });
        });
}

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
    if (ids.length && fields.length && sourceFormsNeedPreparation(source))
        throw new Error('Resolve source form appearances before native field export');
}
