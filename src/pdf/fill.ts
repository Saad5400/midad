import {
    PDFArray,
    PDFDict,
    PDFDocument,
    PDFHexString,
    PDFName,
    PDFNumber,
    PDFStream,
    PDFString,
    type PDFField,
    type PDFObject,
} from 'pdf-lib';
import { fieldDefinition, fieldDisplayValue, IMAGE_FIELD_TYPES, nativeFields } from '../content/fields/queries.js';
import type { NativeDocument, NativeNode } from '../document/model.js';
import { isRecord } from '../document/model.js';
import type { DocumentScene } from '../layout/scene.js';
import type { NativeTextKernel } from '../rendering/kernel.js';
import type { ShapedParagraph } from '../rendering/text/model.js';
import { NATIVE_RENDERER_VERSION } from '../rendering/version.js';
import { writeScenePdf } from './document.js';
import { fieldAppearancePage, type FrozenFieldBox } from './field-appearance.js';
import { FrozenFieldSession } from './frozen-fields.js';
import { appendPdfRevision, loadIncrementalPdf, snapshotPdfObjects } from './incremental.js';
import { overlayMatrix, transformRectangle } from './source-geometry.js';
import { sourcePageViewports } from './source-pages.js';

function storedValue(value: PDFObject | undefined): string {
    if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
    if (value instanceof PDFArray) return value.asArray().map(storedValue).join(',');
    if (!value) return '';
    throw new Error('The native field has an unsupported stored value');
}

export interface FrozenPdfLayout {
    readonly fields: readonly FrozenFieldBox[];
    readonly pages: readonly { width: number; height: number }[];
}

export async function fillNativePdf(
    original: Uint8Array,
    document: NativeDocument,
    kernel: NativeTextKernel,
    ids: readonly string[],
    frozen?: FrozenPdfLayout,
): Promise<{ bytes: Uint8Array; fields: readonly string[] }> {
    if (!ids.length || ids.length > 10000 || new Set(ids).size !== ids.length)
        throw new Error('Choose unique native fields to fill');
    const pdf = await loadIncrementalPdf(original);
    const storedIdentity = pdf.catalog.lookup(PDFName.of('CLMNative'));
    const identity = storedIdentity === undefined ? undefined : JSON.parse(storedValue(storedIdentity));
    const marker = document.root.attributes?.nativeEditor;
    if (
        storedIdentity !== undefined &&
        (identity.schema !== 1 ||
            (isRecord(marker) && marker.schema !== 1) ||
            identity.document !== document.id ||
            identity.renderer !== (isRecord(marker) ? marker.renderer : NATIVE_RENDERER_VERSION))
    )
        throw new Error('The native PDF does not match the current document renderer');
    const before = snapshotPdfObjects(pdf);
    const viewports = sourcePageViewports(pdf);
    const storedBoxes = new Map<string, FrozenFieldBox>();
    if (storedIdentity === undefined) {
        if (
            !frozen ||
            frozen.pages.length !== viewports.length ||
            frozen.pages.some(
                (page, index) =>
                    Math.abs(page.width - viewports[index].width) > 0.002 ||
                    Math.abs(page.height - viewports[index].height) > 0.002,
            )
        )
            throw new Error('The stored PDF layout does not match its source pages');
        const frame = new FrozenFieldSession(document, frozen.fields, frozen.pages, ids);
        for (const { box } of frame.fields) storedBoxes.set(box.id, box);
        if (ids.some((id) => !storedBoxes.has(id))) throw new Error('The requested stored PDF field is unavailable');
    }

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
    if (storedIdentity !== undefined && identity.fontHash !== fingerprint)
        throw new Error('The native PDF does not match the current document renderer');
    const sourceFields = nativeFields(document);
    const source = new Map(sourceFields.map((field) => [field.id, field]));
    if (source.size !== sourceFields.length) throw new Error('The native document contains duplicate field names');
    const targets = ids.map((id) => {
        const node = source.get(id);
        let field = existing.get(id);
        const box = storedBoxes.get(id);
        if (node && !field && box) {
            const viewport = viewports[box.page - 1];
            const rectangle = transformRectangle(
                { x: box.x, y: viewport.height - box.y - box.height, width: box.width, height: box.height },
                overlayMatrix(viewport),
            );
            const created = pdf.getForm().createTextField(id);
            created.addToPage(pdf.getPages()[box.page - 1], { ...rectangle, borderWidth: 0 });
            field = created;
            existing.set(id, field);
        }
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
        if (storedIdentity !== undefined) {
            const definition = JSON.parse(storedValue(widget.dict.lookup(PDFName.of('PdfEngineMeta')))).clm;
            if (
                !definition ||
                JSON.stringify(fieldDefinition({ ...definition, settings: definition.settings })) !==
                    JSON.stringify(fieldDefinition(node.attributes))
            )
                throw new Error('The native field definition changed after the PDF was prepared');
        }
        const pageIndex = pdf.getPages().indexOf(pages[0]);
        const rect = transformRectangle(widgets[0].getRectangle(), viewports[pageIndex].transform);
        if (
            box &&
            (box.page !== pageIndex + 1 ||
                (['x', 'y', 'width', 'height'] as const).some((key) => Math.abs(rect[key] - box[key]) > 0.002))
        )
            throw new Error('The stored PDF field does not match its frozen geometry');
        if (!(rect.width > 0 && rect.height > 0 && rect.width <= 3000 && rect.height <= 3000))
            throw new Error('The native field has invalid geometry');
        const locked = field.isReadOnly();
        if (locked && storedValue(field.acroField.dict.lookup(PDFName.of('V'))) !== value)
            throw new Error('An already filled native field cannot be changed');
        return { id, node, field, value, rect, locked, matrix: overlayMatrix(viewports[pageIndex]) };
    });
    const pending = targets.filter((target) => !target.locked);
    if (!pending.length) return { bytes: original, fields: ids };
    const used = new Set<ShapedParagraph>();
    const scene: DocumentScene = {
        documentId: document.id,
        revision: document.revision,
        fontHash: kernel.fontHashFor(document),
        glyphCount: 0,
        margin: 0,
        pages: pending.map(({ id, node, rect }) =>
            fieldAppearancePage(id, node.attributes, rect.width, rect.height, kernel, used),
        ),
    };
    const appearances = await PDFDocument.load(await writeScenePdf(scene, kernel, () => document));
    const embedded = await pdf.embedPages(appearances.getPages());
    await pdf.flush();
    pending.forEach(({ field, value, matrix }, index) => {
        const widget = field.acroField.getWidgets()[0];
        const appearance = pdf.context.lookup(embedded[index].ref);
        if (!(appearance instanceof PDFStream)) throw new Error('The native appearance is unavailable');
        appearance.dict.set(PDFName.of('Matrix'), pdf.context.obj([...matrix.slice(0, 4), 0, 0]));
        widget.setNormalAppearance(embedded[index].ref);
        field.acroField.dict.set(PDFName.of('V'), PDFHexString.fromText(value));
        field.acroField.dict.set(PDFName.of('Ff'), PDFNumber.of(field.acroField.getFlags() | 1));
        field.acroField.dict.delete(PDFName.of('I'));
    });
    const acroForm = pdf.catalog.lookup(PDFName.of('AcroForm'));
    if (acroForm instanceof PDFDict) acroForm.delete(PDFName.of('NeedAppearances'));
    return { bytes: appendPdfRevision(original, pdf, before), fields: ids };
}
