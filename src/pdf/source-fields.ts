import { PDFArray, PDFDict, PDFDocument, PDFName, PDFObjectCopier, PDFStream, PDFString } from 'pdf-lib';
import { transformRectangle } from './source-geometry.js';

export function retainSourceFields(
    source: PDFDocument,
    overlay: PDFDocument,
    matrices: readonly (readonly number[])[],
    offset: number,
): void {
    const existing = new Set<string>();
    for (const field of source.getForm().getFields()) {
        if (existing.has(field.getName())) throw new Error('The source PDF contains duplicate field names');
        existing.add(field.getName());
    }
    const form = source.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    const fields = form.lookup(PDFName.of('Fields'), PDFArray);
    const resources = form.lookupMaybe(PDFName.of('DR'), PDFDict) ?? source.context.obj({});
    const fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict) ?? source.context.obj({});
    resources.set(PDFName.of('Font'), fonts);
    form.set(PDFName.of('DR'), resources);
    const copier = PDFObjectCopier.for(overlay.context, source.context);
    const names = new Map<string, string>();
    const incoming = overlay.catalog
        .lookupMaybe(PDFName.of('AcroForm'), PDFDict)
        ?.lookupMaybe(PDFName.of('DR'), PDFDict)
        ?.lookupMaybe(PDFName.of('Font'), PDFDict);
    for (const [name, reference] of incoming?.entries() ?? []) {
        let index = names.size;
        while (fonts.has(PDFName.of(`MidadForm${index}`))) index++;
        const next = `MidadForm${index}`;
        fonts.set(PDFName.of(next), copier.copy(reference));
        names.set(name.decodeText(), next);
    }
    const pages = source.getPages(),
        sourcePages = overlay.getPages();
    for (const field of overlay.getForm().getFields()) {
        const name = field.getName();
        if (existing.has(name)) throw new Error('A native field conflicts with a source PDF field');
        existing.add(name);
        const widgets = field.acroField.getWidgets();
        if (widgets.length !== 1) throw new Error('Native fields require one widget');
        const widget = widgets[0],
            index = sourcePages.findIndex((page) => page.ref === widget.P());
        if (index < 0) throw new Error('The native field page is unavailable');
        const matrix = index < offset ? [1, 0, 0, 1, 0, 0] : matrices[index - offset];
        const original = widget.dict.clone();
        original.delete(PDFName.of('P'));
        const copied = copier.copy(original);
        const rect = transformRectangle(widget.getRectangle(), matrix);
        copied.set(PDFName.of('Rect'), source.context.obj([rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]));
        copied.set(PDFName.of('P'), pages[index].ref);
        const da = copied.lookupMaybe(PDFName.of('DA'), PDFString);
        if (da)
            copied.set(
                PDFName.of('DA'),
                PDFString.of(
                    da
                        .asString()
                        .replace(/\/([^\s]+)(?=\s)/, (token, font: string) =>
                            names.has(font) ? `/${names.get(font)}` : token,
                        ),
                ),
            );
        const appearance = copied.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
        if (!(appearance instanceof PDFStream)) throw new Error('The native appearance is unavailable');
        appearance.dict.set(PDFName.of('Matrix'), source.context.obj([...matrix.slice(0, 4), 0, 0]));
        const reference = source.context.register(copied);
        const annotations = pages[index].node.Annots();
        if (annotations) annotations.push(reference);
        else pages[index].node.set(PDFName.of('Annots'), source.context.obj([reference]));
        fields.push(reference);
    }
    if (overlay.getForm().getFields().length) form.delete(PDFName.of('NeedAppearances'));
    const identity = overlay.catalog.lookup(PDFName.of('CLMNative'));
    if (!identity) throw new Error('The native PDF identity is unavailable');
    source.catalog.set(PDFName.of('CLMNative'), copier.copy(identity));
}
