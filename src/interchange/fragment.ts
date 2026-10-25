import { copyJson } from '../document/model.js';

const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
const viewKeys = ['dir', 'pageLayout', 'nativePresentation', 'nativeEditor', 'nativeId', 'id'];
function decode(value: unknown): { document: Record<string, unknown>; array: boolean; encoded: boolean } {
    const encoded = typeof value === 'string' && value.trim() !== '';
    if (encoded) value = JSON.parse(value as string);
    if (value === null || value === undefined || value === '')
        return { document: { type: 'doc', content: [] }, array: false, encoded };
    if (Array.isArray(value)) return { document: { type: 'doc', content: copyJson(value) }, array: true, encoded };
    if (!record(value) || value.type !== 'doc' || (value.content !== undefined && !Array.isArray(value.content)))
        throw new Error('Expected a rich document fragment');
    return { document: copyJson(value) as Record<string, unknown>, array: false, encoded };
}
export function fragmentSource(value: unknown, direction: 'rtl' | 'ltr' = 'rtl'): Record<string, unknown> {
    const { document } = decode(value),
        attrs = record(document.attrs) ? document.attrs : {};
    return {
        ...document,
        attrs: {
            ...attrs,
            dir: attrs.dir ?? direction,
            nativePresentation: { cover: { enabled: false, src: null }, header: { enabled: false, src: null } },
            pageLayout: { orientation: 'portrait', margins: { top: 38, bottom: 38, left: 38, right: 38 } },
        },
    };
}
export function fragmentIsEmpty(value: unknown): boolean {
    const visible = (value: unknown): boolean => {
        if (!record(value)) return false;
        if (value.type === 'text') return typeof value.text === 'string' && !!value.text.trim();
        if (['variable', 'image', 'table', 'parallelRow', 'horizontalRule', 'pdfPage'].includes(String(value.type)))
            return true;
        return Array.isArray(value.content) && value.content.some(visible);
    };
    return !visible(decode(value).document);
}
export function fragmentContent(value: unknown, original: unknown): unknown {
    const source = decode(original),
        edited = decode(value).document;
    const attrs = record(edited.attrs) ? { ...edited.attrs } : {};
    const initial = record(source.document.attrs) ? source.document.attrs : {};
    for (const key of viewKeys) {
        if (initial[key] === undefined) delete attrs[key];
        else attrs[key] = initial[key];
    }
    const document: Record<string, unknown> = { ...edited };
    if (Object.keys(attrs).length) document.attrs = attrs;
    else delete document.attrs;
    const result = source.array ? (document.content ?? []) : document;
    return source.encoded ? JSON.stringify(result) : result;
}
function signature(value: unknown): string {
    const canonical = (value: unknown): unknown =>
        Array.isArray(value)
            ? value.map(canonical)
            : record(value)
              ? Object.fromEntries(
                    Object.entries(value)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([key, value]) => [key, canonical(value)]),
                )
              : value;
    return JSON.stringify(canonical(decode(value).document));
}
export class FragmentContentController {
    protected original: unknown;
    protected current: string;
    constructor(
        value: unknown,
        private readonly direction: 'rtl' | 'ltr' = 'rtl',
    ) {
        this.current = signature(value);
        this.original = value === undefined ? undefined : copyJson(value);
    }
    source(): Record<string, unknown> {
        return fragmentSource(this.original, this.direction);
    }
    accept(value: unknown): boolean {
        const next = signature(value),
            changed = next !== this.current;
        this.original = value === undefined ? undefined : copyJson(value);
        this.current = next;
        return changed;
    }
    publish(value: unknown): unknown {
        const result = fragmentContent(value, this.original);
        this.current = signature(result);
        return result;
    }
}

export class DocumentContentController extends FragmentContentController {
    source(): Record<string, unknown> {
        const source = decode(this.original).document;
        return {
            ...source,
            ...(!Array.isArray(source.content) || !source.content.length ? { content: [{ type: 'paragraph' }] } : {}),
        };
    }
    publish(value: unknown): unknown {
        const source = decode(this.original),
            document = decode(value).document;
        const result = source.encoded ? JSON.stringify(document) : document;
        this.current = signature(result);
        return result;
    }
}
