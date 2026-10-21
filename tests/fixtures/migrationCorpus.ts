type JSONContent = { type?: string; attrs?: Record<string, unknown>; content?: JSONContent[]; marks?: { type: string; attrs?: Record<string, unknown> }[]; text?: string };

export const CORPUS_VERSION = 1;
export const CORPUS_SIZES = [1, 10, 50, 100, 300] as const;
export const CORPUS_CASES = [
    { id: 'arabic', label: 'نص عربي مختلط', features: ['arabic', 'bidi', 'formatting', 'pagination'] },
    { id: 'tables', label: 'جداول طويلة', features: ['tables', 'merged-cells', 'pagination'] },
    { id: 'parallel', label: 'ثلاثة أعمدة لغوية', features: ['parallel-columns', 'arabic', 'bidi', 'pagination'] },
    {
        id: 'mixed',
        label: 'عقد شامل',
        features: ['clauses', 'variants', 'fields', 'images', 'parallel-columns', 'tables'],
    },
] as const;

export type CorpusCase = (typeof CORPUS_CASES)[number]['id'];
export type CorpusSize = (typeof CORPUS_SIZES)[number];

const arabic =
    'يَلْتَزِمُ الطرفُ الأوّل بتنفيذ الخدمات المتفق عليها، وفقًا لأحكام هذا العقد. ' +
    'تُسدَّد المستحقات خلال (30) يومًا من استلام الفاتورة رقم INV-2026/١٢٣، بقيمة 12,345.67 ريالًا. ' +
    'تُرسل الإشعارات إلى legal@example.test، وتُراجع المرفقات قبل التوقيع. ';
const english =
    'The parties agree to perform the services within thirty (30) days. ' +
    'Invoice INV-2026/123 includes SAR 12,345.67. Notices must identify the relevant clause and document revision. ';

export const LAB_IMAGE =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALQAAAA8CAIAAABATAfQAAABWElEQVR4nO3b0Q0CMQwEUbpwJVRD/3UcDWCkA8e7tkaaAkB+P0l8j3i+iD72kP8Csg0clAYOSgMHpYGD0sBBaeCgNBmO67rkf56+p8SBD/PEOPDhnB4HPmyzwIEPz5SnFXyYJz7K4sM5/T0HPmzT4wh8uGaBI/BhmQuOwIdfRjgCH2Z54Qh8OGWHI/BhkyOOwIdHpjgCHwb54gh8qLPGEfiQ5o4j8KFrAI7Ah6gZOAIfiv7F0TknfDRXgAMfW6vBgY+VleHAx74qceBjWQWnFXxsreYoi4+Vld1z4GNflZdg+FhW8Q0pPjZVf32OjzUdeVvBx45OPbzhY0EHX2XxMb2zT/b4GN3xfQ58zK1j2QcfQ2vaBMPHxPrWBPExrtYdUtWQwPFb3QvGqiGB44cE2+eqIYHjbppPE1RDAsetxny3Qv2Bg9LAQWngoDRwUBo4KA0clAYOSnsDY9M4LdkvGbcAAAAASUVORK5CYII=';

const text = (value: string): JSONContent => ({ type: 'text', text: value });
const paragraph = (id: string, value: string, dir = 'rtl'): JSONContent => ({
    type: 'paragraph',
    attrs: { id, dir },
    content: [text(value)],
});

function prose(index: number): JSONContent[] {
    return [
        {
            type: 'heading',
            attrs: { id: `heading-${index}`, level: 2, dir: 'rtl' },
            content: [text(`المادة ${index + 1}`)],
        },
        paragraph(`arabic-${index}`, arabic.repeat(2)),
        paragraph(`english-${index}`, english, 'ltr'),
        {
            type: 'paragraph',
            attrs: { id: `formatting-${index}`, dir: 'rtl', textAlign: 'justify' },
            content: [
                {
                    type: 'text',
                    text: 'تنسيق عربي ',
                    marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strike' }],
                },
                {
                    type: 'text',
                    text: 'نص ملوّن',
                    marks: [
                        {
                            type: 'textStyle',
                            attrs: {
                                fontFamily: 'Amiri',
                                fontSize: '18px',
                                color: '#17355b',
                                backgroundColor: '#fff4cc',
                                lineHeight: '1.5',
                            },
                        },
                    ],
                },
                { type: 'hardBreak', attrs: { id: `break-${index}` } },
                {
                    type: 'text',
                    text: 'Contract reference',
                    marks: [{ type: 'link', attrs: { href: 'https://example.test/contract' } }],
                },
            ],
        },
    ];
}

function table(index: number): JSONContent {
    return {
        type: 'table',
        attrs: { id: `table-${index}`, borderColor: '#17355b' },
        content: Array.from({ length: 12 }, (_, row) => ({
            type: 'tableRow',
            attrs: { id: `row-${index}-${row}` },
            content: Array.from({ length: row === 2 ? 2 : 3 }, (_, column) => ({
                type: row === 0 ? 'tableHeader' : 'tableCell',
                attrs: {
                    id: `table-cell-${index}-${row}-${column}`,
                    colspan: row === 2 && column === 0 ? 2 : 1,
                    rowspan: 1,
                },
                content: [paragraph(`cell-${index}-${row}-${column}`, `R${index}-${row}-${column} البند ${row + 1}`)],
            })),
        })),
    };
}

function parallel(index: number): JSONContent {
    return {
        type: 'parallelRow',
        attrs: { id: `parallel-${index}`, widths: 'even', gap: 'sm', divider: true, show: null },
        content: ['ar', 'en', 'ur'].map((lang) => ({
            type: 'parallelCell',
            attrs: { id: `parallel-cell-${index}-${lang}`, lang },
            content: [
                paragraph(
                    `parallel-${index}-${lang}`,
                    lang === 'en'
                        ? english
                        : lang === 'ar'
                          ? arabic
                          : 'فریقین اس معاہدے کی شرائط پر عمل کرنے پر متفق ہیں۔',
                    lang === 'en' ? 'ltr' : 'rtl',
                ),
            ],
        })),
    };
}

function clause(index: number): JSONContent {
    const body: JSONContent = {
        type: 'clauseBody',
        attrs: { id: `clause-body-${index}` },
        content: [paragraph(`clause-text-${index}`, arabic)],
    };
    return {
        type: 'clause',
        attrs: {
            id: `variant-${index}-a`,
            groupId: `group-${index}`,
            activeVariantId: `variant-${index}-a`,
            ordered: true,
            optional: true,
            optionalValue: true,
            variantCount: 2,
            variants: [
                { id: `variant-${index}-a`, isDefault: true, bodyContent: body },
                {
                    id: `variant-${index}-b`,
                    isDefault: false,
                    description: 'صيغة بديلة محفوظة',
                    bodyContent: {
                        type: 'clauseBody',
                        content: [paragraph(`alternative-${index}`, 'يُحفظ هذا البديل دون فقدان محتواه.')],
                    },
                },
            ],
            explanation: { type: 'doc', content: [paragraph(`explanation-${index}`, 'شرح البند')] },
        },
        content: [
            {
                type: 'clauseTitle',
                attrs: { id: `clause-title-${index}` },
                content: [text(`بند الخدمات ${index + 1}`)],
            },
            body,
        ],
    };
}

const inlineTypes = ['text', 'date', 'single', 'multi', 'attachment', 'choice'] as const;

export function createMigrationFixture(kind: CorpusCase = 'mixed', sections: number = 1): JSONContent {
    if (!CORPUS_CASES.some((entry) => entry.id === kind) || !CORPUS_SIZES.some((size) => size === sections)) {
        throw new Error('Unknown migration fixture or size');
    }

    const content = Array.from({ length: sections }, (_, index) => {
        if (kind === 'tables') return [table(index)];
        if (kind === 'parallel') return [parallel(index)];
        if (kind === 'arabic') return prose(index);
        return [...prose(index), clause(index), parallel(index), table(index)];
    }).flat();

    if (kind === 'mixed') {
        content.push({
            type: 'paragraph',
            attrs: { id: 'field-paragraph', dir: 'rtl' },
            content: inlineTypes.flatMap((type, index) => [
                text(' '),
                {
                    type: 'variable',
                    attrs: {
                        id: `field-${type}`,
                        type,
                        name: `حقل ${type}`,
                        description: 'بيانات اصطناعية للاختبار',
                        value: type === 'text' ? 'شركة الاختبار' : '',
                        participant_id: 'lab-participant',
                        display: 'inline',
                        width: 120,
                        height: 28,
                        settings: { required: true, options: ['الخيار الأول', 'الخيار الثاني'], allowOther: true },
                        reference_id: `reference-${index}`,
                    },
                },
            ]),
        });
        content.push({
            type: 'paragraph',
            attrs: { id: 'image-paragraph' },
            content: [
                {
                    type: 'image',
                    attrs: { id: 'inline-image', src: LAB_IMAGE, width: 180, height: 60, alt: 'Synthetic logo' },
                },
            ],
        });
    }

    return {
        type: 'doc',
        attrs: {
            pageLayout: { orientation: 'portrait', margins: { top: 96, bottom: 96, left: 96, right: 96 } },
            blockVariables:
                kind === 'mixed'
                    ? ['signature', 'initials', 'stamp'].map((type, index) => ({
                          id: `field-${type}`,
                          name: `حقل ${type}`,
                          type,
                          display: 'block',
                          participant_id: 'lab-participant',
                          x: 100 + index * 190,
                          y: 1035,
                          width: 160,
                          height: 70,
                          settings: { required: true },
                      }))
                    : [],
            floatingImages:
                kind === 'mixed'
                    ? [
                          {
                              id: 'floating-image',
                              src: LAB_IMAGE,
                              attachmentId: null,
                              alt: 'Synthetic logo',
                              title: null,
                              x: 96,
                              y: 40,
                              width: 180,
                              height: 60,
                              locked: true,
                          },
                      ]
                    : [],
        },
        content,
    };
}

export const INTEGRATION_GATES = [
    'Collaboration, presence, concurrent changes and local undo',
    'Autosave, conflicts, reconnect and version restoration',
    'Review notes, replies, proposed fields and accepted/rejected edits',
    'AI mutations, anchors and revision preconditions',
    'Template and clause administration, optional clauses and variants',
    'Brand covers, letterheads and cover fields',
    'Word imports and original PDFs with mixed page sizes and rotation',
    'Participant permissions, signatures, initials and stamps',
    'Signed originals, share copies, compression and validity appendices',
    'Arabic composition, clipboard, keyboard selection and accessibility',
] as const;
