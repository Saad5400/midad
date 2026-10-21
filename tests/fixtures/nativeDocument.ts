export function makeNativeFixture(paragraphs: number): unknown {
    if (![1, 20, 100, 300, 600].includes(paragraphs)) throw new Error('Unsupported native fixture size');
    const arabic =
        'يَلْتَزِمُ الطرفُ الأوّل بتنفيذ الخدمات المتفق عليها، وفقًا لأحكام هذا العقد. تُسدَّد المستحقات خلال (30) يومًا من استلام الفاتورة رقم INV-2026/١٢٣، بقيمة 12,345.67 ريالًا. ';
    return {
        type: 'doc',
        content: Array.from({ length: paragraphs }, (_, index): unknown => ({
            type: index === 0 ? 'heading' : 'paragraph',
            attrs: { id: `native-paragraph-${index}`, dir: index % 4 === 3 ? 'ltr' : 'rtl' },
            content: [
                {
                    type: 'text',
                    attrs: { id: `native-text-${index}` },
                    text:
                        index === 0
                            ? 'عقد الخدمات — نواة المحرر المستقل'
                            : index % 4 === 3
                              ? `Section ${index}: The parties agree to perform the services within thirty (30) days. Invoice INV-2026/123 includes SAR 12,345.67. `.repeat(
                                    3,
                                )
                              : `${index}. ${arabic.repeat(3)}`,
                },
            ],
        })),
    };
}

export function makeNestedRichFixture(): unknown {
    const paragraph = (id: string, text: string) => ({
        type: 'paragraph',
        attrs: { id },
        content: [{ type: 'text', text }],
    });
    const rich = (id: string) => ({
        type: 'paragraph',
        attrs: { id, dir: 'auto' },
        content: [
            { type: 'text', text: 'نص عربي Arabic ', marks: [{ type: 'bold' }, { type: 'underline' }] },
            {
                type: 'text',
                text: 'rich content',
                marks: [
                    { type: 'italic' },
                    { type: 'textStyle', attrs: { color: '#123456', backgroundColor: '#fff4cc', fontSize: '22px' } },
                ],
            },
            { type: 'hardBreak' },
            { type: 'text', text: 'A second line 123' },
        ],
    });
    const split = (id: string) => ({
        type: 'parallelRow',
        attrs: { id },
        content: [
            {
                type: 'parallelCell',
                attrs: { id: `${id}-ar`, lang: 'ar' },
                content: [paragraph(`${id}-ar-text`, 'العربية داخل العمود')],
            },
            {
                type: 'parallelCell',
                attrs: { id: `${id}-en`, lang: 'en' },
                content: [paragraph(`${id}-en-text`, 'English inside column')],
            },
        ],
    });
    const table = (id: string) => ({
        type: 'table',
        attrs: { id },
        content: [
            {
                type: 'tableRow',
                content: [
                    {
                        type: 'tableHeader',
                        attrs: { id: `${id}-heading-cell`, colspan: 2 },
                        content: [
                            {
                                type: 'heading',
                                attrs: { id: `${id}-heading`, level: 2 },
                                content: [{ type: 'text', text: 'جدول مختلط Complex table' }],
                            },
                        ],
                    },
                ],
            },
            {
                type: 'tableRow',
                content: [
                    {
                        type: 'tableCell',
                        attrs: { id: `${id}-merged`, rowspan: 2, verticalAlign: 'middle', backgroundColor: '#eaf4ff' },
                        content: [
                            rich(`${id}-rich`),
                            {
                                type: 'table',
                                attrs: { id: `${id}-nested-table` },
                                content: [
                                    {
                                        type: 'tableRow',
                                        content: [
                                            {
                                                type: 'tableCell',
                                                attrs: { id: `${id}-inner-cell-a` },
                                                content: [paragraph(`${id}-inner-a`, 'داخل الجدول')],
                                            },
                                            {
                                                type: 'tableCell',
                                                attrs: { id: `${id}-inner-cell-b` },
                                                content: [paragraph(`${id}-inner-b`, 'Nested cell')],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    { type: 'tableCell', attrs: { id: `${id}-split-cell` }, content: [split(`${id}-split`)] },
                ],
            },
            {
                type: 'tableRow',
                content: [{ type: 'tableCell', attrs: { id: `${id}-last-cell` }, content: [rich(`${id}-last`)] }],
            },
        ],
    });
    return {
        type: 'doc',
        content: [
            paragraph('nested-intro', 'اختبار المحتوى المتداخل Nested content regression'),
            {
                type: 'parallelRow',
                attrs: { id: 'outer-split', widths: 'narrow-end', gap: 'lg' },
                content: [
                    { type: 'parallelCell', attrs: { id: 'outer-ar', lang: 'ar' }, content: [table('arabic-table')] },
                    { type: 'parallelCell', attrs: { id: 'outer-en', lang: 'en' }, content: [table('english-table')] },
                ],
            },
            paragraph('nested-end', 'النهاية End of nested content'),
        ],
    };
}

export function makeOversizedRichFixture(): unknown {
    const paragraph = (id: string, text: string, fontSize = '14px') => ({
        type: 'paragraph',
        attrs: { id, dir: 'ltr' },
        content: [{ type: 'text', text, marks: [{ type: 'textStyle', attrs: { fontSize } }] }],
    });
    return {
        type: 'doc',
        content: [
            paragraph('oversized-intro', 'Multi-page mixed columns'),
            {
                type: 'table',
                attrs: { id: 'oversized-table' },
                content: [
                    {
                        type: 'tableRow',
                        content: [
                            {
                                type: 'tableCell',
                                attrs: { id: 'oversized-cell', backgroundColor: '#f8fafc' },
                                content: [
                                    {
                                        type: 'parallelRow',
                                        attrs: { id: 'oversized-columns' },
                                        content: [
                                            {
                                                type: 'parallelCell',
                                                attrs: { id: 'small-column', lang: 'en' },
                                                content: Array.from({ length: 50 }, (_, index) =>
                                                    paragraph(`small-${index}`, `Small paragraph ${index}`),
                                                ),
                                            },
                                            {
                                                type: 'parallelCell',
                                                attrs: { id: 'large-column', lang: 'en' },
                                                content: Array.from({ length: 50 }, (_, index) =>
                                                    paragraph(`large-${index}`, 'Big', '48px'),
                                                ),
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            paragraph('nested-end', 'End of nested content'),
        ],
    };
}
