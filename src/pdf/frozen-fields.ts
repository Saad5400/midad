import { IMAGE_FIELD_TYPES, nativeFields, type NativeField } from '../content/fields/queries.js';
import { copyJson, type Attributes, type NativeDocument } from '../document/model.js';
import { shiftCommand } from '../layout/bands.js';
import { finalizePages } from '../layout/finalize.js';
import type { DocumentScene, PaintCommand } from '../layout/scene.js';
import type { NativeTextKernel } from '../rendering/kernel.js';
import type { ShapedParagraph } from '../rendering/text/model.js';
import { fieldAppearancePage, type FieldAppearance, type FrozenFieldBox } from './field-appearance.js';

export class FrozenFieldSession {
    readonly fields: readonly { box: FrozenFieldBox; field: NativeField }[];
    private readonly source = new Map<string, NativeField>();
    private readonly allowed: ReadonlySet<string>;
    private readonly values = new Map<string, string>();
    private readonly locked: ReadonlySet<string>;
    private readonly framed = new Set<string>();
    private readonly pages: readonly { width: number; height: number }[];
    private preview?: NativeDocument;
    private pendingRevision = 0;

    constructor(
        readonly document: NativeDocument,
        boxes: readonly FrozenFieldBox[],
        pages: readonly { width: number; height: number }[],
        editableIds: readonly string[],
        lockedIds: readonly string[] = [],
    ) {
        if (
            !pages.length ||
            pages.some((page) => ![page.width, page.height].every((size) => Number.isFinite(size) && size > 0))
        )
            throw new Error('Invalid frozen page geometry');
        this.pages = Object.freeze(pages.map((page) => Object.freeze({ width: page.width, height: page.height })));
        for (const field of nativeFields(document)) {
            if (this.source.has(field.id)) throw new Error('Duplicate native field');
            this.source.set(field.id, field);
        }
        this.allowed = new Set(editableIds);
        this.locked = new Set(lockedIds);
        const seen = new Set<string>();
        this.fields = Object.freeze(
            boxes.map((box) => {
                const field = this.source.get(box.id),
                    page = pages[box.page - 1];
                if (
                    !field ||
                    seen.has(box.id) ||
                    !Number.isInteger(box.page) ||
                    !page ||
                    ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
                    box.x < 0 ||
                    box.y < 0 ||
                    box.width <= 0 ||
                    box.height <= 0 ||
                    box.x + box.width > page.width + 0.002 ||
                    box.y + box.height > page.height + 0.002
                )
                    throw new Error('Invalid frozen field layout');
                seen.add(box.id);
                return Object.freeze({ box: Object.freeze({ ...box }), field });
            }),
        );
        for (const id of this.allowed)
            if (!seen.has(id)) throw new Error('An editable field is missing from the frozen PDF');
    }

    value(id: string): string {
        return this.values.get(id) ?? String(this.source.get(id)?.attributes.value ?? '');
    }

    editable(id: string): boolean {
        return this.allowed.has(id) && !this.locked.has(id) && !this.source.get(id)?.attributes.value;
    }

    setValue(id: string, value: string, completeImage = false): void {
        if (!this.editable(id)) throw new Error('This frozen field cannot be changed');
        if (typeof value !== 'string' || value.length > 10000000) throw new Error('Invalid field value');
        this.values.set(id, value);
        if (completeImage) this.framed.add(id);
        else this.framed.delete(id);
        this.pendingRevision++;
        this.preview = undefined;
    }

    attributes(id: string): Attributes {
        const field = this.source.get(id);
        if (!field) throw new Error('Unknown frozen field');
        return copyJson({
            ...field.attributes,
            value: this.value(id),
            ...(field.attributes.type === 'attachment' && this.values.has(id)
                ? { settings: { ...(field.attributes.settings as Attributes), filename: this.value(id) } }
                : {}),
            ...(this.framed.has(id) && IMAGE_FIELD_TYPES.has(String(field.attributes.type))
                ? { reference_id: null }
                : {}),
        }) as Attributes;
    }

    valuesForSubmit(): Readonly<Record<string, string>> {
        return Object.freeze(Object.fromEntries(this.values));
    }

    appearance(id: string, kernel: NativeTextKernel, used: Set<ShapedParagraph>): FieldAppearance {
        const entry = this.fields.find((entry) => entry.box.id === id);
        if (!entry || !this.values.has(id)) throw new Error('No pending appearance for this field');
        return {
            field: entry.box,
            page: fieldAppearancePage(id, this.attributes(id), entry.box.width, entry.box.height, kernel, used),
        };
    }

    previewDocument(): NativeDocument {
        if (this.preview) return this.preview;
        const entries = this.fields.filter((entry) => this.values.has(entry.box.id));
        return (this.preview = Object.freeze({
            ...this.document,
            revision: this.document.revision + this.pendingRevision,
            root: Object.freeze({
                id: 'frozen-preview',
                kind: 'doc',
                children: Object.freeze([
                    Object.freeze({
                        id: 'frozen-preview-fields',
                        kind: 'paragraph',
                        children: Object.freeze(
                            entries.map((entry) =>
                                Object.freeze({
                                    id: entry.box.id,
                                    kind: 'variable',
                                    attributes: this.attributes(entry.box.id),
                                }),
                            ),
                        ),
                    }),
                ]),
            }),
        }));
    }

    pendingScene(kernel: NativeTextKernel): DocumentScene {
        const document = this.previewDocument(),
            fontHash = kernel.fontHashFor(document),
            used = new Set<ShapedParagraph>();
        const pages = this.pages.map((page) => ({ ...page, lines: [], commands: [] as PaintCommand[] }));
        for (const id of this.values.keys()) {
            const appearance = this.appearance(id, kernel, used),
                box = appearance.field;
            pages[box.page - 1].commands.push(
                ...appearance.page.commands.map((command) => shiftCommand(command, box.x, box.y)),
            );
        }
        return Object.freeze({
            documentId: document.id,
            revision: document.revision,
            fontHash,
            margin: 0,
            glyphCount: pages.reduce(
                (total, page) =>
                    total +
                    page.commands.reduce(
                        (count, command) => count + ('glyphs' in command ? command.glyphs.length : 0),
                        0,
                    ),
                0,
            ),
            pages: Object.freeze(finalizePages(pages)),
        });
    }
}
