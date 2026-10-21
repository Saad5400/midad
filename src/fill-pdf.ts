import {
    PDFArray,
    PDFDict,
    PDFDocument,
    PDFHexString,
    PDFName,
    PDFNumber,
    PDFString,
    type PDFField,
    type PDFObject,
} from 'pdf-lib';
import type { NativeDocument, NativeNode } from './document.js';
import { fieldAppearancePage } from './field-appearance.js';
import { fieldDefinition, fieldDisplayValue, IMAGE_FIELD_TYPES, isRecord, nativeFields } from './fields.js';
import { appendPdfRevision, loadIncrementalPdf, snapshotPdfObjects } from './incremental-pdf.js';
import type { NativeTextKernel, ShapedParagraph } from './kernel.js';
import type { DocumentScene } from './layout.js';
import { writeScenePdf } from './pdf.js';
import { NATIVE_RENDERER_VERSION } from './version.js';

function storedValue(value: PDFObject | undefined): string {
    if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
    if (value instanceof PDFArray) return value.asArray().map(storedValue).join(',');
    if (!value) return '';
    throw new Error('The native field has an unsupported stored value');
}

export async function fillNativePdf(
    original: Uint8Array,
    document: NativeDocument,
    kernel: NativeTextKernel,
    ids: readonly string[],
): Promise<{ bytes: Uint8Array; fields: readonly string[] }> {
    if (!ids.length || ids.length > 10000 || new Set(ids).size !== ids.length)
        throw new Error('Choose unique native fields to fill');
    const pdf = await loadIncrementalPdf(original);
    const identity = JSON.parse(storedValue(pdf.catalog.lookup(PDFName.of('CLMNative'))));
    const marker = document.root.attributes?.nativeEditor;
    if (
        identity.schema !== 1 ||
        (isRecord(marker) && marker.schema !== 1) ||
        identity.document !== document.id ||
        identity.renderer !== (isRecord(marker) ? marker.renderer : NATIVE_RENDERER_VERSION)
    )
        throw new Error('The native PDF does not match the current document renderer');
    const before = snapshotPdfObjects(pdf);
    const existing = new Map<string, PDFField>();
    for (const field of pdf.getForm().getFields()) {
        if (existing.has(field.getName())) throw new Error('The native PDF contains duplicate field names');
        existing.set(field.getName(), field);
    }
    const originalFonts = (node: NativeNode): NativeNode => {
        let attributes = node.attributes;
        if (node.kind === 'variable' && existing.has(node.id)) attributes = { ...attributes, value: '' };
        if (node.kind === 'doc' && Array.isArray(attributes?.blockVariables))
            attributes = {
                ...attributes,
                blockVariables: attributes.blockVariables.map((field) =>
                    isRecord(field) && typeof field.id === 'string' && existing.has(field.id)
                        ? { ...field, value: '' }
                        : field,
                ),
            };
        return {
            ...node,
            ...(attributes ? { attributes } : {}),
            ...(node.children ? { children: node.children.map(originalFonts) } : {}),
        };
    };
    const fingerprint = await kernel.fontFingerprint({ ...document, root: originalFonts(document.root) });
    if (identity.fontHash !== fingerprint)
        throw new Error('The native PDF does not match the current document renderer');
    const sourceFields = nativeFields(document);
    const source = new Map(sourceFields.map((field) => [field.id, field]));
    if (source.size !== sourceFields.length) throw new Error('The native document contains duplicate field names');
    const targets = ids.map((id) => {
        const node = source.get(id),
            field = existing.get(id);
        if (!node || !field || IMAGE_FIELD_TYPES.has(String(node.attributes.type)))
            throw new Error('The requested native text field is missing or unsupported');
        const value = fieldDisplayValue(node.attributes);
        if (!value) throw new Error('A native field value is required');
        const widgets = field.acroField.getWidgets();
        if (widgets.length !== 1) throw new Error('Native fields require one unambiguous widget');
        const widget = widgets[0];
        const pages = pdf.getPages().filter((page) =>
            page.node
                .Annots()
                ?.asArray()
                .some((ref) => pdf.context.lookup(ref) === widget.dict),
        );
        const occurrences = pages.reduce(
            (count, page) =>
                count +
                (page.node
                    .Annots()
                    ?.asArray()
                    .filter((ref) => pdf.context.lookup(ref) === widget.dict).length ?? 0),
            0,
        );
        if (occurrences !== 1 || widget.P() !== pages[0]?.ref)
            throw new Error('Native fields require one unambiguous page annotation');
        const definition = JSON.parse(storedValue(widget.dict.lookup(PDFName.of('PdfEngineMeta')))).clm;
        if (
            !definition ||
            JSON.stringify(fieldDefinition({ ...definition, settings: definition.settings })) !==
                JSON.stringify(fieldDefinition(node.attributes))
        )
            throw new Error('The native field definition changed after the PDF was prepared');
        const rect = widgets[0].getRectangle();
        if (!(rect.width > 0 && rect.height > 0 && rect.width <= 3000 && rect.height <= 3000))
            throw new Error('The native field has invalid geometry');
        const locked = field.isReadOnly();
        if (locked && storedValue(field.acroField.dict.lookup(PDFName.of('V'))) !== value)
            throw new Error('An already filled native field cannot be changed');
        return { id, node, field, value, rect, locked };
    });
    const pending = targets.filter((target) => !target.locked);
    if (!pending.length) return { bytes: original, fields: ids };
    const used = new Set<ShapedParagraph>();
    const scene: DocumentScene = {
        documentId: document.id,
        revision: document.revision,
        fontHash: kernel.fontHash,
        glyphCount: 0,
        margin: 0,
        pages: pending.map(({ id, node, rect }) =>
            fieldAppearancePage(id, node.attributes, rect.width, rect.height, kernel, used),
        ),
    };
    const appearances = await PDFDocument.load(await writeScenePdf(scene, kernel, () => document));
    const embedded = await pdf.embedPages(appearances.getPages());
    await pdf.flush();
    pending.forEach(({ field, value }, index) => {
        const widget = field.acroField.getWidgets()[0];
        widget.setNormalAppearance(embedded[index].ref);
        field.acroField.dict.set(PDFName.of('V'), PDFHexString.fromText(value));
        field.acroField.dict.set(PDFName.of('Ff'), PDFNumber.of(field.acroField.getFlags() | 1));
        field.acroField.dict.delete(PDFName.of('I'));
    });
    const acroForm = pdf.catalog.lookup(PDFName.of('AcroForm'));
    if (acroForm instanceof PDFDict) acroForm.delete(PDFName.of('NeedAppearances'));
    return { bytes: appendPdfRevision(original, pdf, before), fields: ids };
}
