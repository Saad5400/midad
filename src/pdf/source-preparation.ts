import {
    PDFArray,
    PDFBool,
    PDFDict,
    PDFDocument,
    PDFHexString,
    PDFName,
    PDFString,
    type PDFContext,
    type PDFField,
    type PDFObject,
} from 'pdf-lib';
import { sourceFormsNeedPreparation } from './source-forms.js';
import { sourcePageViewports } from './source-pages.js';

export interface SourceFormAnnotation {
    readonly id: string;
    readonly fieldType?: string;
    readonly fieldValue?: unknown;
    readonly rotation?: number;
    readonly checkBox?: boolean;
    readonly radioButton?: boolean;
    readonly exportValue?: string;
    readonly buttonValue?: string;
}
export interface SourceFormReader {
    readonly numPages: number;
    readonly annotationStorage: { setValue(id: string, value: { value: unknown; rotation: number }): void };
    getPage(number: number): Promise<{ getAnnotations(): Promise<readonly SourceFormAnnotation[]> }>;
    saveDocument(): Promise<Uint8Array>;
    destroy(): Promise<void>;
}
export type SourceFormOpener = (bytes: Uint8Array) => Promise<SourceFormReader>;

function value(object: PDFObject | undefined, context: PDFContext): unknown {
    object = context.lookup(object);
    if (object instanceof PDFString || object instanceof PDFHexString) return object.decodeText();
    if (object instanceof PDFArray) return object.asArray().map((item) => value(item, context));
    if (object instanceof PDFName) return object.decodeText();
    return object?.toString() ?? null;
}

function fieldValue(field: PDFField): unknown {
    const context = field.acroField.dict.context;
    const type = context.lookup(field.acroField.getInheritableAttribute(PDFName.of('FT')))?.toString();
    const stored = value(field.acroField.getInheritableAttribute(PDFName.of('V')), context);
    if (type === '/Ch') return stored === null ? [] : Array.isArray(stored) ? stored : [stored];
    if (type === '/Btn') return stored ?? 'Off';
    return type === '/Tx' ? (stored ?? '') : stored;
}

export async function preparePdfSourceForms(original: Uint8Array, open: SourceFormOpener): Promise<Uint8Array> {
    const source = await PDFDocument.load(new Uint8Array(original), { updateMetadata: false });
    if (!sourceFormsNeedPreparation(source)) return original;
    const form = source.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    const fields = source.getForm().getFields();
    const before = new Map(
        fields.map((field) => [field.getName(), { value: fieldValue(field), flags: field.acroField.getFlags() }]),
    );
    if (before.size !== fields.length) throw new Error('The source form contains duplicate field names');
    const pages = JSON.stringify(sourcePageViewports(source));
    form.set(PDFName.of('NeedAppearances'), PDFBool.False);
    const reader = await open(await source.save({ updateFieldAppearances: false }));
    try {
        for (let number = 1; number <= reader.numPages; number++) {
            for (const field of await (await reader.getPage(number)).getAnnotations()) {
                if (!['Tx', 'Ch', 'Btn'].includes(field.fieldType ?? '') || field.fieldValue === undefined) continue;
                const checked = field.checkBox
                    ? field.fieldValue === field.exportValue
                    : field.radioButton
                      ? field.fieldValue === field.buttonValue
                      : (field.fieldValue ?? '');
                reader.annotationStorage.setValue(field.id, { value: checked, rotation: field.rotation ?? 0 });
            }
        }
        const bytes = await reader.saveDocument();
        const prepared = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
        if (sourceFormsNeedPreparation(prepared))
            throw new Error('The source form contains values whose appearances could not be prepared');
        const fields = prepared.getForm().getFields();
        if (
            fields.length !== before.size ||
            fields.some(
                (field) =>
                    !before.has(field.getName()) ||
                    JSON.stringify({ value: fieldValue(field), flags: field.acroField.getFlags() }) !==
                        JSON.stringify(before.get(field.getName())),
            )
        )
            throw new Error('The source form values changed during appearance preparation');
        if (JSON.stringify(sourcePageViewports(prepared)) !== pages)
            throw new Error('The source pages changed during appearance preparation');
        return bytes;
    } finally {
        await reader.destroy();
    }
}
