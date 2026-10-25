// @vitest-environment node
import { pdfSourcePages, preparePdfSourceForms } from '@saad5400/midad/pdf';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const options = { standardFontDataUrl: join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts/') };
async function source() {
    const pdf = await PDFDocument.create(),
        page = pdf.addPage([400, 600]);
    page.setRotation(degrees(90));
    page.setCropBox(10, 20, 300, 400);
    const form = pdf.getForm(),
        text = form.createTextField('name');
    text.setText('Old value');
    text.addToPage(page, { x: 30, y: 80, width: 220, height: 35 });
    const check = form.createCheckBox('checked');
    check.addToPage(page, { x: 40, y: 150, width: 20, height: 20 });
    check.check();
    const choice = form.createDropdown('choice');
    choice.addOptions(['Alpha', 'Beta']);
    choice.select('Alpha');
    choice.addToPage(page, { x: 40, y: 200, width: 180, height: 30 });
    const multi = form.createOptionList('multi');
    multi.addOptions(['One', 'Two', 'Three']);
    multi.enableMultiselect();
    multi.select(['One', 'Three']);
    multi.addToPage(page, { x: 40, y: 250, width: 180, height: 70 });
    const radio = form.createRadioGroup('radio');
    radio.addOptionToPage('First', page, { x: 40, y: 340, width: 15, height: 15 });
    radio.addOptionToPage('Second', page, { x: 70, y: 340, width: 15, height: 15 });
    radio.select('Second');
    const bytes = await pdf.save();
    const stale = await PDFDocument.load(bytes);
    stale
        .getForm()
        .getTextField('name')
        .acroField.dict.set(PDFName.of('V'), PDFHexString.fromText('Current actual value'));
    stale.catalog.lookup(PDFName.of('AcroForm'), PDFDict).set(PDFName.of('NeedAppearances'), PDFBool.True);
    stale.getForm().getDropdown('choice').acroField.dict.set(PDFName.of('V'), PDFHexString.fromText('Beta'));
    return stale.save({ updateFieldAppearances: false });
}
it('prepares current values through the supplied PDF reader while preserving values, pages and widget flags', async () => {
    const original = await source(),
        before = new Uint8Array(original);
    const started = performance.now();
    const prepared = await preparePdfSourceForms(original, (bytes) => getDocument({ data: bytes, ...options }).promise);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(original).toEqual(before);
    const pdf = await PDFDocument.load(prepared);
    expect(pdf.getForm().getTextField('name').getText()).toBe('Current actual value');
    expect(pdf.getForm().getCheckBox('checked').isChecked()).toBe(true);
    expect(pdf.getForm().getDropdown('choice').getSelected()).toEqual(['Beta']);
    expect(pdf.getForm().getOptionList('multi').getSelected()).toEqual(['One', 'Three']);
    expect(pdf.getForm().getRadioGroup('radio').getSelected()).toBe('Second');
    expect(await pdfSourcePages(prepared)).toEqual(await pdfSourcePages(original));
    expect(pdf.catalog.lookup(PDFName.of('AcroForm'), PDFDict).lookup(PDFName.of('NeedAppearances'))).toBe(
        PDFBool.False,
    );
    const normalize = (value: unknown): unknown =>
        typeof value === 'string'
            ? value.replace(/g_d\d+_/g, 'g_d_')
            : Array.isArray(value)
              ? value.map(normalize)
              : value && typeof value === 'object'
                ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))
                : value;
    const ops = async (data: Uint8Array) => {
        const reader = await getDocument({ data: new Uint8Array(data), ...options }).promise;
        try {
            return normalize(await (await reader.getPage(1)).getOperatorList({ intent: 'print' }));
        } finally {
            await reader.destroy();
        }
    };
    expect(await ops(prepared)).toEqual(await ops(original));
});
it('does not start a reader or rewrite a source with resolved appearances', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save();
    const open = vi.fn();
    expect(await preparePdfSourceForms(bytes, open)).toBe(bytes);
    expect(open).not.toHaveBeenCalled();
});

it('rejects unencodable source values without dropping their text or changing the original bytes', async () => {
    const original = await source(),
        pdf = await PDFDocument.load(original);
    pdf.getForm()
        .getTextField('name')
        .acroField.dict.set(PDFName.of('V'), PDFHexString.fromText('قيمة عربية غير موجودة في خط المصدر'));
    const bytes = await pdf.save({ updateFieldAppearances: false }),
        before = new Uint8Array(bytes);
    await expect(preparePdfSourceForms(bytes, (data) => getDocument({ data, ...options }).promise)).rejects.toThrow(
        'could not be prepared',
    );
    expect(bytes).toEqual(before);
    expect((await PDFDocument.load(bytes)).getForm().getTextField('name').getText()).toBe(
        'قيمة عربية غير موجودة في خط المصدر',
    );
});

it('disposes the reader and refuses a preparation that changes canonical values', async () => {
    const original = await source(),
        destroy = vi.fn();
    await expect(
        preparePdfSourceForms(original, async (data) => {
            const reader = await getDocument({ data, ...options }).promise;
            return {
                numPages: reader.numPages,
                annotationStorage: reader.annotationStorage,
                getPage: (number) => reader.getPage(number),
                saveDocument: async () => {
                    const pdf = await PDFDocument.load(await reader.saveDocument());
                    pdf.getForm()
                        .getTextField('name')
                        .acroField.dict.set(PDFName.of('V'), PDFHexString.fromText('Lost value'));
                    return pdf.save({ updateFieldAppearances: false });
                },
                destroy: async () => {
                    destroy();
                    await reader.destroy();
                },
            };
        }),
    ).rejects.toThrow('values changed');
    expect(destroy).toHaveBeenCalledOnce();
});

it.each([
    [undefined, 'AP'],
    [false, 'AP'],
    [undefined, 'N'],
    [false, 'N'],
])('prepares missing source widget %s/%s appearances', async (flag, missing) => {
    const pdf = await PDFDocument.load(await source());
    const form = pdf.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    if (flag === undefined) form.delete(PDFName.of('NeedAppearances'));
    else form.set(PDFName.of('NeedAppearances'), PDFBool.False);
    for (const name of ['name', 'choice', 'multi'])
        for (const widget of pdf.getForm().getField(name).acroField.getWidgets()) {
            if (missing === 'AP') widget.dict.delete(PDFName.of('AP'));
            else widget.dict.lookup(PDFName.of('AP'), PDFDict).delete(PDFName.of('N'));
        }
    const original = await pdf.save({ updateFieldAppearances: false });
    await expect(pdfSourcePages(original, ['overlay-field'])).rejects.toThrow('Resolve source form appearances');
    const open = vi.fn((data: Uint8Array) => getDocument({ data, ...options }).promise);
    const prepared = await preparePdfSourceForms(original, open);
    expect(open).toHaveBeenCalledOnce();
    const result = await PDFDocument.load(prepared);
    for (const name of ['name', 'choice', 'multi'])
        for (const widget of result.getForm().getField(name).acroField.getWidgets())
            expect(widget.getAppearances()?.normal).toBeDefined();
    expect(result.getForm().getTextField('name').getText()).toBe('Current actual value');
    expect(result.getForm().getDropdown('choice').getSelected()).toEqual(['Beta']);
    expect(result.getForm().getOptionList('multi').getSelected()).toEqual(['One', 'Three']);
    expect(await pdfSourcePages(prepared, ['overlay-field'])).toEqual(await pdfSourcePages(original));
    const noReader = vi.fn();
    expect(await preparePdfSourceForms(prepared, noReader)).toBe(prepared);
    expect(noReader).not.toHaveBeenCalled();
});
