import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, type PDFObject } from 'pdf-lib';

const encoder = new TextEncoder();
function previousRevision(original: Uint8Array): { offset: number; size: number } {
    const tail = new TextDecoder('latin1').decode(original.subarray(Math.max(0, original.length - 1024 * 1024)));
    const match = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
    const offset = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= original.length)
        throw new Error('The native PDF has no valid previous cross-reference');
    const section = new TextDecoder('latin1').decode(original.subarray(offset));
    const size = Number(/\/Size\s+(\d+)\b/.exec(section)?.[1]);
    if (!Number.isSafeInteger(size) || size < 1) throw new Error('The native PDF has no valid object count');
    return { offset, size };
}
export async function loadIncrementalPdf(original: Uint8Array): Promise<PDFDocument> {
    const revision = previousRevision(original);
    const pdf = await PDFDocument.load(original, { updateMetadata: false });
    pdf.context.largestObjectNumber = Math.max(pdf.context.largestObjectNumber, revision.size - 1);
    return pdf;
}
export function pdfObjectBytes(object: PDFObject): Uint8Array {
    const bytes = new Uint8Array(object.sizeInBytes());
    object.copyBytesInto(bytes, 0);
    return bytes;
}
export function snapshotPdfObjects(pdf: PDFDocument): ReadonlyMap<string, Uint8Array> {
    return new Map(
        pdf.context.enumerateIndirectObjects().map(([ref, object]) => [ref.toString(), pdfObjectBytes(object)]),
    );
}
function equal(a: Uint8Array | undefined, b: Uint8Array): boolean {
    return !!a && a.length === b.length && a.every((byte, index) => byte === b[index]);
}
export function appendPdfRevision(
    original: Uint8Array,
    pdf: PDFDocument,
    before: ReadonlyMap<string, Uint8Array>,
): Uint8Array {
    if (pdf.context.trailerInfo.Encrypt) throw new Error('Encrypted native PDF revisions are not supported');
    const previous = previousRevision(original).offset;
    const changed = pdf.context
        .enumerateIndirectObjects()
        .flatMap(([ref, object]) => {
            const bytes = pdfObjectBytes(object);
            return equal(before.get(ref.toString()), bytes) ? [] : [{ ref, bytes }];
        })
        .sort((a, b) => a.ref.objectNumber - b.ref.objectNumber);
    if (!changed.length) return original;
    const parts: Uint8Array[] = [original, encoder.encode('\n')];
    let offset = original.length + 1;
    const entries: Array<{ ref: PDFRef; offset: number }> = [];
    for (const { ref, bytes } of changed) {
        const header = encoder.encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`);
        const footer = encoder.encode('\nendobj\n');
        entries.push({ ref, offset });
        parts.push(header, bytes, footer);
        offset += header.length + bytes.length + footer.length;
    }
    let xref = 'xref\n';
    for (let index = 0; index < entries.length; ) {
        let end = index + 1;
        while (end < entries.length && entries[end].ref.objectNumber === entries[end - 1].ref.objectNumber + 1) end++;
        xref += `${entries[index].ref.objectNumber} ${end - index}\n`;
        for (const entry of entries.slice(index, end)) {
            if (entry.offset >= 10_000_000_000 || entry.ref.generationNumber > 99999)
                throw new Error('The native PDF revision exceeds cross-reference bounds');
            xref += `${String(entry.offset).padStart(10, '0')} ${String(entry.ref.generationNumber).padStart(5, '0')} n \n`;
        }
        index = end;
    }
    const trailer = PDFDict.withContext(pdf.context);
    for (const key of ['Root', 'Info', 'ID'] as const) {
        const value = pdf.context.trailerInfo[key];
        if (value) trailer.set(PDFName.of(key), value);
    }
    trailer.set(PDFName.of('Size'), PDFNumber.of(pdf.context.largestObjectNumber + 1));
    trailer.set(PDFName.of('Prev'), PDFNumber.of(previous));
    parts.push(encoder.encode(`${xref}trailer\n${trailer.toString()}\nstartxref\n${offset}\n%%EOF\n`));
    const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let cursor = 0;
    for (const part of parts) {
        output.set(part, cursor);
        cursor += part.length;
    }
    return output;
}
