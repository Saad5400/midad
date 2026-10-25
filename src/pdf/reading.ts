import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, type PDFPage, type PDFRef } from 'pdf-lib';
import type { TextReading } from '../layout/scene.js';
import { compareReading } from '../layout/text-reading.js';
import { EncodedReadingSpan } from './reading-span.js';

export class PdfReadingTree {
    private readonly root: PDFRef;
    private readonly kids: PDFRef[] = [];
    private readonly parents: Array<number | PDFRef[]> = [];
    private pages = 0;
    private readonly texts = new Map<string, PDFHexString>();

    constructor(
        private readonly pdf: PDFDocument,
        private readonly scalar: (value: number) => string = (value) => PDFNumber.of(value).toString(),
    ) {
        this.root = pdf.context.nextRef();
    }

    page(page: PDFPage, height: number): { span: (part: TextReading) => string; finish: () => void } {
        const index = this.pages++;
        const groups = new Map<string, { ref: PDFRef; spans: Array<{ ref: PDFRef; order: readonly number[] }> }>();
        const owners: PDFRef[] = [];
        return {
            span: (part) => {
                let group = groups.get(part.group);
                if (!group) {
                    group = { ref: this.pdf.context.nextRef(), spans: [] };
                    groups.set(part.group, group);
                    this.kids.push(group.ref);
                }
                let actualText = this.texts.get(part.text);
                if (!actualText) {
                    actualText = PDFHexString.fromText(part.text);
                    if (this.texts.size < 4096) this.texts.set(part.text, actualText);
                }
                const id = owners.length;
                const { x, y, width, height: lineHeight } = part.box;
                const ref = this.pdf.context.register(
                    new EncodedReadingSpan(
                        `<< /Type /StructElem /S /Span /P ${group.ref} /Pg ${page.ref} /K ${id} /ActualText ${actualText} /A << /O /Layout /BBox [${[x, height - y - lineHeight, x + width, height - y].map(this.scalar).join(' ')}] >> >>`,
                    ),
                );
                owners.push(ref);
                group.spans.push({ ref, order: part.order });
                return `/Span << /MCID ${id} /ActualText ${actualText} >> BDC`;
            },
            finish: () => {
                if (!owners.length) return;
                page.node.set(PDFName.of('StructParents'), PDFNumber.of(index));
                this.parents.push(index, owners);
                for (const group of groups.values()) {
                    group.spans.sort((a, b) => compareReading(a.order, b.order));
                    this.pdf.context.assign(
                        group.ref,
                        this.pdf.context.obj({
                            Type: 'StructElem',
                            S: 'P',
                            P: this.root,
                            Pg: page.ref,
                            K: group.spans.map((span) => span.ref),
                        }),
                    );
                }
            },
        };
    }

    finish(): void {
        if (!this.kids.length) return;
        this.pdf.context.assign(
            this.root,
            this.pdf.context.obj({
                Type: 'StructTreeRoot',
                K: this.kids,
                ParentTree: this.pdf.context.register(this.pdf.context.obj({ Nums: this.parents })),
                ParentTreeNextKey: this.pages,
            }),
        );
        this.pdf.catalog.set(PDFName.of('StructTreeRoot'), this.root);
        this.pdf.catalog.set(PDFName.of('MarkInfo'), this.pdf.context.obj({ Marked: true }));
        this.pdf.context
            .lookup(this.pdf.context.trailerInfo.Info, PDFDict)
            .set(PDFName.of('CLMReadingOrder'), PDFString.of('1'));
    }
}
