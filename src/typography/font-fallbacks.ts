export function symbolFontFiles(text: string, bold: boolean): readonly string[] {
    return [
        ...(text.includes('\u20c1') ? ['notonaskharabic'] : []),
        ...(/\p{S}/u.test(text.replaceAll('\u20c1', '')) ? [bold ? 'dejavusans-bold' : 'dejavusans'] : []),
    ];
}
