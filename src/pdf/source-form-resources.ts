import {
    PDFDict,
    PDFDocument,
    PDFHexString,
    PDFName,
    PDFRawStream,
    PDFStream,
    PDFString,
    StandardFonts,
    decodePDFRawStream,
} from 'pdf-lib';

function fontNames(contents: string): readonly string[] {
    let operators = '';
    for (let index = 0; index < contents.length; index++) {
        const character = contents[index];
        if (character === '(') {
            let depth = 1;
            while (depth && ++index < contents.length) {
                if (contents[index] === '\\') index++;
                else if (contents[index] === '(') depth++;
                else if (contents[index] === ')') depth--;
            }
            operators += ' ';
        } else if (character === '%') {
            while (index < contents.length && !['\n', '\r'].includes(contents[index])) index++;
            operators += ' ';
        } else if (character === '<' && contents[index + 1] !== '<') {
            while (index < contents.length && contents[index] !== '>') index++;
            operators += ' ';
        } else if (character === '<') {
            operators += '<<';
            index++;
        } else operators += character;
    }
    return [...operators.matchAll(/\/([^\s/()[\]<>{}%]+)\s+[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s+Tf\b/g)].map((match) =>
        match[1].replace(/#([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
    );
}

export function missingAppearanceFonts(stream: PDFStream): boolean {
    if (!(stream instanceof PDFRawStream)) return false;
    const names = fontNames(new TextDecoder().decode(decodePDFRawStream(stream).decode()));
    const fonts = stream.dict.lookupMaybe(PDFName.of('Resources'), PDFDict)?.lookupMaybe(PDFName.of('Font'), PDFDict);
    return names.some((name) => !(stream.dict.context.lookup(fonts?.get(PDFName.of(name))) instanceof PDFDict));
}

export async function prepareSourceFormResources(source: PDFDocument): Promise<void> {
    const form = source.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    const resources = form.lookupMaybe(PDFName.of('DR'), PDFDict) ?? source.context.obj({});
    const fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict) ?? source.context.obj({});
    resources.set(PDFName.of('Font'), fonts);
    form.set(PDFName.of('DR'), resources);
    for (const field of source.getForm().getFields()) {
        const raw = source.context.lookup(
            field.acroField.getInheritableAttribute(PDFName.of('DA')) ?? form.get(PDFName.of('DA')),
        );
        const appearance = raw instanceof PDFString || raw instanceof PDFHexString ? raw.decodeText() : '';
        for (const name of fontNames(appearance)) {
            if (source.context.lookup(fonts.get(PDFName.of(name))) instanceof PDFDict) continue;
            const existing = field.acroField
                .getWidgets()
                .map((widget) => {
                    const normal = widget.dict.lookupMaybe(PDFName.of('AP'), PDFDict)?.lookup(PDFName.of('N'));
                    return normal instanceof PDFStream
                        ? normal.dict
                              .lookupMaybe(PDFName.of('Resources'), PDFDict)
                              ?.lookupMaybe(PDFName.of('Font'), PDFDict)
                              ?.get(PDFName.of(name))
                        : undefined;
                })
                .find((font) => source.context.lookup(font) instanceof PDFDict);
            if (existing) fonts.set(PDFName.of(name), existing);
            else {
                const standard =
                    name === 'Helv' ? StandardFonts.Helvetica : name === 'ZaDb' ? StandardFonts.ZapfDingbats : name;
                if (Object.values(StandardFonts).includes(standard as StandardFonts))
                    fonts.set(PDFName.of(name), (await source.embedFont(standard as StandardFonts)).ref);
            }
        }
    }
}
