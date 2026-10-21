import { copyJson, type Attributes, type NativeDocument } from './document.js';
import { fieldAppearancePage, type FieldAppearance, type FrozenFieldBox } from './field-appearance.js';
import { IMAGE_FIELD_TYPES, nativeFields, type NativeField } from './fields.js';
import type { NativeTextKernel, ShapedParagraph } from './kernel.js';

export class FrozenFieldSession {
    readonly fields: readonly { box: FrozenFieldBox; field: NativeField }[];
    private readonly source = new Map<string, NativeField>();
    private readonly allowed: ReadonlySet<string>;
    private readonly values = new Map<string, string>();
    private readonly locked: ReadonlySet<string>;
    private readonly framed = new Set<string>();

    constructor(
        readonly document: NativeDocument,
        boxes: readonly FrozenFieldBox[],
        pages: readonly { width: number; height: number }[],
        editableIds: readonly string[],
        lockedIds: readonly string[] = [],
    ) {
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
        const entries = this.fields.filter((entry) => this.values.has(entry.box.id));
        return {
            ...this.document,
            root: {
                id: 'frozen-preview',
                kind: 'doc',
                children: [
                    {
                        id: 'frozen-preview-fields',
                        kind: 'paragraph',
                        children: entries.map((entry) => ({
                            id: entry.box.id,
                            kind: 'variable',
                            attributes: this.attributes(entry.box.id),
                        })),
                    },
                ],
            },
        };
    }
}
