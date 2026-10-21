import type { CommandMenuGroup, CommandMenuItem } from './command-menu.js';

const entries = {
    insert: ['clause', 'separator', 'image', 'table', 'bilingual'],
    fields: ['field-text', 'field-date', 'field-choice', 'field-signature', 'field-stamp', 'field-initials'],
    format: ['bold', 'italic', 'underline', 'strike', 'clear-format'],
    paragraph: [
        'heading-1',
        'heading-2',
        'heading-3',
        'normal-text',
        'bullet-list',
        'ordered-list',
        'align-start',
        'align-center',
        'align-end',
        'align-justify',
        'direction-rtl',
        'direction-ltr',
    ],
} as const;
export type DocumentMenuId = (typeof entries)[keyof typeof entries][number];
export type DocumentMenuGroupId = keyof typeof entries;
export interface DocumentMenuItem<Icon extends string = string> extends CommandMenuItem<Icon> {
    readonly id: DocumentMenuId;
}
const keywords: Partial<Record<DocumentMenuId, readonly string[]>> = {
    separator: ['divider', 'hr', 'فاصل'],
    image: ['picture', 'photo', 'صورة'],
    bilingual: ['split', 'english', 'arabic', 'translate', 'ثنائي', 'تقسيم', 'ترجمة'],
    'field-text': ['input', 'متغير'],
    'field-choice': ['select', 'option', 'اختيار'],
    'field-signature': ['sign', 'توقيع'],
    'field-stamp': ['seal', 'ختم'],
    'clear-format': ['reset', 'plain'],
    'normal-text': ['body', 'paragraph'],
    'bullet-list': ['ul', 'list'],
    'ordered-list': ['ol', 'numbered', 'list'],
};

export function documentCommandMenu<Icon extends string>(options: {
    label: (id: DocumentMenuId | DocumentMenuGroupId) => string;
    icon?: (id: DocumentMenuId | DocumentMenuGroupId) => Icon | undefined;
    available?: (id: DocumentMenuId) => boolean;
    active?: (id: DocumentMenuId) => boolean;
    exclude?: readonly string[];
}): CommandMenuGroup<DocumentMenuItem<Icon>>[] {
    const excluded = new Set(options.exclude ?? []);
    return (Object.entries(entries) as [DocumentMenuGroupId, readonly DocumentMenuId[]][])
        .filter(([id]) => !excluded.has(id))
        .map(([id, ids]) => ({
            id,
            label: options.label(id),
            icon: options.icon?.(id),
            items: ids
                .filter((id) => !excluded.has(id) && (options.available?.(id) ?? true))
                .map((id) => ({
                    id,
                    label: options.label(id),
                    icon: options.icon?.(id),
                    ...(id.startsWith('heading-') ? { badge: `H${id.slice(-1)}` } : {}),
                    keywords: [
                        id.replaceAll('-', ' '),
                        ...(id.startsWith('heading-') ? [`h${id.slice(-1)}`, 'title'] : []),
                        ...(keywords[id] ?? []),
                    ],
                    active: options.active?.(id) ?? false,
                })),
        }))
        .filter((group) => group.items.length > 0);
}
