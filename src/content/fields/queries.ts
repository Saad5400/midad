import { isRecord, type Attributes, type NativeDocument, type NativeNode } from '../../document/model.js';
import { isTextBlock } from '../../document/text.js';
import { color, DEFAULT_TEXT_STYLE, lineHeight, textSize, type TextStyle } from '../../typography/style.js';
import { getEffectiveWritingSettings, VARIABLE_CONFIGS, type VariableType } from './schema.js';

export const NATIVE_FIELD_TYPES = Object.freeze(Object.keys(VARIABLE_CONFIGS) as VariableType[]);
export const IMAGE_FIELD_TYPES = new Set(['signature', 'stamp', 'initials']);
export interface NativeField {
    readonly id: string;
    readonly attributes: Attributes;
    readonly blockId?: string;
    readonly offset?: number;
    readonly floating: boolean;
}
export function nativeFields(document: NativeDocument): readonly NativeField[] {
    const fields: NativeField[] = [];
    const visit = (node: NativeNode): void => {
        if (isTextBlock(node)) {
            let offset = 0;
            for (const child of node.children ?? []) {
                if (child.kind === 'variable')
                    fields.push({
                        id: child.id,
                        attributes: child.attributes ?? {},
                        blockId: node.id,
                        offset,
                        floating: false,
                    });
                offset += child.kind === 'text' ? (child.text?.length ?? 0) : 1;
            }
        } else node.children?.forEach(visit);
    };
    visit(document.root);
    const blocks = document.root.attributes?.blockVariables;
    if (Array.isArray(blocks))
        for (const attrs of blocks)
            if (isRecord(attrs) && typeof attrs.id === 'string')
                fields.push({ id: attrs.id, attributes: attrs, floating: true });
    return fields;
}

export function fieldSettings(attrs: Attributes): Attributes {
    return isRecord(attrs.settings) ? attrs.settings : {};
}

export function fieldDefinition(attrs: Attributes): Attributes {
    const mutable = new Set([
        'page',
        'relativeXPct',
        'relativeYPct',
        'widthPct',
        'heightPct',
        'x',
        'y',
        'width',
        'height',
        'filename',
        'signerAdjust',
    ]);
    return {
        v: 1,
        type: String(attrs.type ?? 'text'),
        name: attrs.name ?? '',
        settings: Object.fromEntries(
            Object.entries(fieldSettings(attrs))
                .filter(([key]) => !mutable.has(key))
                .sort(([a], [b]) => a.localeCompare(b)),
        ),
    };
}

export function fieldStyle(attrs: Attributes): TextStyle {
    const raw = fieldSettings(attrs),
        settings = getEffectiveWritingSettings(String(attrs.type) as VariableType, raw);
    return {
        ...DEFAULT_TEXT_STYLE,
        family: settings.fontFamily ?? DEFAULT_TEXT_STYLE.family,
        size: textSize(settings.fontSize, DEFAULT_TEXT_STYLE.size),
        bold: settings.fontWeight === 'bold',
        italic: settings.fontStyle === 'italic',
        underline: settings.textDecoration === 'underline',
        color: color(settings.color),
        strike: raw.strike === true,
        background: raw.backgroundColor ? color(raw.backgroundColor) : null,
        lineHeight: raw.lineHeight
            ? lineHeight(raw.lineHeight, textSize(settings.fontSize, DEFAULT_TEXT_STYLE.size))
            : null,
    };
}

export function fieldDisplayValue(attrs: Attributes): string {
    const value = typeof attrs.value === 'string' ? attrs.value : '';
    if (!value || IMAGE_FIELD_TYPES.has(String(attrs.type))) return '';
    if (attrs.type === 'attachment') return String(fieldSettings(attrs).filename ?? attrs.name ?? '');
    if (attrs.type !== 'date') return value;
    const settings = fieldSettings(attrs),
        match = /^(\d{1,4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/.exec(value);
    if (!match) return value;
    const [, year, month, day] = match;
    const format = settings.dateFormat ?? 'dd/mm/yyyy';
    const parts =
        format === 'yyyy-mm-dd'
            ? [year, month.padStart(2, '0'), day.padStart(2, '0')]
            : format === 'mm/dd/yyyy'
              ? [month.padStart(2, '0'), day.padStart(2, '0'), year]
              : [day.padStart(2, '0'), month.padStart(2, '0'), year];
    if ((settings.direction ?? 'rtl') === 'rtl') parts.reverse();
    return parts.join(format === 'yyyy-mm-dd' ? '-' : '/');
}
