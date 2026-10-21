import { exportDocument, importDocument } from '../document/codec.js';
import { type NativeNode } from '../document/model.js';
import { automaticDirection, inheritedDirection } from '../typography/direction.js';
import { fragmentHtml } from './clipboard.js';
import { plainText } from './plain-text.js';

export type MessageJson = null | boolean | number | string | MessageJson[] | { [key: string]: MessageJson };
export type MessageContent = Record<string, MessageJson>;
const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
const messageKinds = new Set([
    'doc',
    'paragraph',
    'text',
    'heading',
    'hardBreak',
    'horizontalRule',
    'blockquote',
    'codeBlock',
    'bulletList',
    'orderedList',
    'listItem',
]);
const messageNodes = (node: NativeNode): boolean =>
    messageKinds.has(node.kind) && (node.children?.every(messageNodes) ?? true);

const viewAttributes = new Set([
    'nativeEditor',
    'nativePresentation',
    'pageLayout',
    'blockVariables',
    'floatingImages',
]);

export function messageHtml(value: unknown, direction: 'rtl' | 'ltr' = 'rtl'): string {
    try {
        const document = importDocument(messageSource(value, direction), 'message-preview');
        if (!messageNodes(document.root)) throw new Error('Unsupported message document objects');
        return fragmentHtml(
            { blocks: document.root.children ?? [] },
            document.root.attributes?.dir === 'ltr' ? 'ltr' : 'rtl',
            false,
        );
    } catch {
        return plainText(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
    }
}

export function messageIdentities(value: unknown): ReadonlySet<string> {
    const ids = new Set<string>();
    const visit = (node: unknown): void => {
        if (!isRecord(node)) return;
        if (isRecord(node.attrs) && typeof node.attrs.id === 'string') ids.add(node.attrs.id);
        if (Array.isArray(node.content)) node.content.forEach(visit);
    };
    visit(value);
    return ids;
}

export function messageSource(value: unknown, direction: 'rtl' | 'ltr'): Record<string, unknown> {
    const document: Record<string, unknown> =
        isRecord(value) && value.type === 'doc' ? value : { type: 'doc', content: [{ type: 'paragraph' }] };
    const attrs = Object.fromEntries(
        Object.entries(isRecord(document.attrs) ? document.attrs : {}).filter(([key]) => !viewAttributes.has(key)),
    );
    return {
        ...document,
        attrs: {
            ...attrs,
            dir: isRecord(document.attrs) ? (document.attrs.dir ?? direction) : direction,
            pageLayout: { orientation: 'portrait', margins: { top: 38, bottom: 38, left: 38, right: 38 } },
        },
    };
}

export function messageContent(value: unknown, identities: ReadonlySet<string>, original: unknown): MessageContent {
    const originalDirection = isRecord(original) && isRecord(original.attrs) ? original.attrs.dir : undefined;
    const clean = (value: unknown, root = false): MessageJson => {
        if (Array.isArray(value)) return value.map((item) => clean(item));
        if (!isRecord(value)) return value as MessageJson;
        const result: MessageContent = {};
        for (const [key, item] of Object.entries(value)) {
            if (key === 'attrs' && isRecord(item)) {
                const attrs = Object.fromEntries(
                    Object.entries(item).filter(
                        ([name, entry]) =>
                            name !== 'nativeId' &&
                            (name !== 'id' || (typeof entry === 'string' && identities.has(entry))) &&
                            (!root || !viewAttributes.has(name)) &&
                            (!root || name !== 'dir' || originalDirection !== undefined),
                    ),
                );
                if (Object.keys(attrs).length) result.attrs = attrs as MessageContent;
            } else if (item !== undefined) result[key] = clean(item);
        }
        return result;
    };
    const document = importDocument(value, 'message-content');
    const directions = (node: NativeNode, parent: 'rtl' | 'ltr'): NativeNode => {
        const direction = inheritedDirection(node, parent);
        return {
            ...node,
            ...(automaticDirection(node)
                ? { attributes: { ...node.attributes, dir: direction, dirLocked: false } }
                : {}),
            ...(node.children ? { children: node.children.map((child) => directions(child, direction)) } : {}),
        };
    };
    return clean(exportDocument({ ...document, root: directions(document.root, 'rtl') }), true) as MessageContent;
}

export function sameMessageContent(a: unknown, b: unknown): boolean {
    const normalize = (value: unknown, root = false): unknown => {
        if (Array.isArray(value))
            return value
                .filter((node) => !isRecord(node) || node.type !== 'text' || node.text !== '')
                .map((item) => normalize(item));
        if (!isRecord(value)) return value;
        const source = root && value.type !== 'doc' ? { type: 'doc', content: [{ type: 'paragraph' }] } : value;
        return Object.fromEntries(
            Object.entries(source)
                .sort(([a], [b]) => a.localeCompare(b))
                .flatMap(([key, item]) => {
                    if (key === 'attrs' && isRecord(item)) {
                        const automatic = item.dir === 'auto' || item.dirLocked === false;
                        const attrs = Object.fromEntries(
                            Object.entries(item)
                                .filter(
                                    ([name, entry]) =>
                                        !['id', 'nativeId'].includes(name) &&
                                        (!automatic || !['dir', 'dirLocked'].includes(name)) &&
                                        (!root || !viewAttributes.has(name)) &&
                                        entry !== null &&
                                        entry !== undefined,
                                )
                                .sort(([a], [b]) => a.localeCompare(b)),
                        );
                        return Object.keys(attrs).length ? [[key, attrs]] : [];
                    }
                    const normalized = normalize(item);
                    if (key === 'content' && Array.isArray(normalized) && normalized.length === 0) return [];
                    return [[key, normalized]];
                }),
        );
    };
    return JSON.stringify(normalize(a, true)) === JSON.stringify(normalize(b, true));
}
