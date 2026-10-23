import { fieldDisplayValue, fieldStyle, nativeFields } from '../content/fields/queries.js';
import type { NativeDocument, NativeNode } from '../document/model.js';
import { chooseFont, scriptFontFiles } from '../typography/fonts.js';
import { symbolFontFiles } from '../typography/font-fallbacks.js';
import { DEFAULT_TEXT_STYLE, blockTextStyle, nodeTextStyle, type TextStyle } from '../typography/style.js';

export function neededFontFiles(document: NativeDocument): ReadonlySet<string> {
    const files = new Set([chooseFont(DEFAULT_TEXT_STYLE).file]);
    const visit = (node: NativeNode, inherited: TextStyle): void => {
        const style = nodeTextStyle(node, blockTextStyle(node, inherited));
        files.add(chooseFont(style).file);
        files.add(chooseFont({ ...style, family: DEFAULT_TEXT_STYLE.family }).file);
        const text = node.text ?? '';
        for (const file of [...scriptFontFiles(text, style.bold), ...symbolFontFiles(text, style.bold)])
            files.add(file);
        node.children?.forEach((child) => visit(child, style));
    };
    visit(document.root, DEFAULT_TEXT_STYLE);
    for (const field of nativeFields(document)) {
        const style = fieldStyle(field.attributes);
        files.add(chooseFont(style).file);
        const text = fieldDisplayValue(field.attributes);
        for (const file of [...scriptFontFiles(text, style.bold), ...symbolFontFiles(text, style.bold)])
            files.add(file);
    }
    return files;
}
