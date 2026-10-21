import type { NativeDocument, NativeNode } from '../document/model.js';
import { isRecord } from '../document/model.js';
import type { TextStyle } from './style.js';

import { fontAssets } from './font-assets.js';

const byFile = new Map(Object.entries(fontAssets));
const scriptFonts = [
    [/\p{Script=Devanagari}/u, 'notosansdevanagari'],
    [/\p{Script=Bengali}/u, 'notosansbengali'],
    [/\p{Script=Malayalam}/u, 'notosansmalayalam'],
    [/\p{Script=Ethiopic}/u, 'notosansethiopic'],
] as const;
const families: Record<string, string> = {
    Amiri: 'amiri',
    Arial: 'liberationsans',
    'Times New Roman': 'liberationserif',
    'Courier New': 'liberationmono',
    Georgia: 'gelasio',
    Calibri: 'carlito',
    Cambria: 'caladea',
    'Comic Sans MS': 'comicrelief',
    'Trebuchet MS': 'opensans',
    Verdana: 'dejavusans',
    Impact: 'anton',
    Almarai: 'almarai',
    'Aref Ruqaa': 'arefruqaa',
    Cairo: 'cairo',
    Changa: 'changa',
    'El Messiri': 'elmessiri',
    Harmattan: 'harmattan',
    'IBM Plex Sans Arabic': 'ibmplexsansarabic',
    Lemonada: 'lemonada',
    Mada: 'mada',
    'Noto Naskh Arabic': 'notonaskharabic',
    'Noto Sans Arabic': 'notosansarabic',
    'Readex Pro': 'readexpro',
    Scheherazade: 'scheherazadenew',
    'Scheherazade New': 'scheherazadenew',
    Tajawal: 'tajawal',
    'Liberation Sans': 'liberationsans',
    'Liberation Serif': 'liberationserif',
    'Liberation Mono': 'liberationmono',
    Carlito: 'carlito',
    Caladea: 'caladea',
    Gelasio: 'gelasio',
    'Comic Relief': 'comicrelief',
    'Open Sans': 'opensans',
    'DejaVu Sans': 'dejavusans',
    Anton: 'anton',
    Times: 'liberationserif',
};
const familyFiles = new Map(Object.entries(families).map(([family, file]) => [family.toLowerCase(), file]));

export interface FontReplacement {
    readonly requested: string;
    readonly actual: string;
}
function importedFontFallback(family: string): { family: string; bold: boolean } | undefined {
    const name = family.trim().replace(/\s+/g, ' ');
    if (familyFiles.has(name.toLowerCase())) return;
    if (!name || name.length > 255 || !/^[\p{L}\p{N}\p{M}][\p{L}\p{N}\p{M} ._'+’\-]*$/u.test(name)) return;
    const generic = name.toLowerCase();
    return {
        family: generic === 'monospace' ? 'Courier New' : generic === 'serif' ? 'Times New Roman' : 'Arial',
        bold: /^din next (?:lt )?arabic bold$/i.test(name),
    };
}
export function documentFontReplacements(document: NativeDocument): readonly FontReplacement[] {
    const replacements = new Map<string, FontReplacement>();
    const collect = (value: unknown): void => {
        if (typeof value !== 'string') return;
        const requested = value
            .split(',')[0]
            .trim()
            .replace(/^["']|["']$/g, '')
            .trim();
        const fallback = importedFontFallback(requested);
        if (fallback)
            replacements.set(requested.replace(/\s+/g, ' ').toLowerCase(), { requested, actual: fallback.family });
    };
    const visit = (node: NativeNode): void => {
        collect(node.attributes?.fontFamily);
        const settings = node.attributes?.settings;
        if (isRecord(settings)) collect(settings.fontFamily);
        node.marks?.forEach((mark) => collect(mark.attributes?.fontFamily));
        node.children?.forEach(visit);
    };
    visit(document.root);
    return [...replacements.values()];
}

export interface FontChoice {
    readonly id: string;
    readonly file: string;
    readonly fauxBold: boolean;
    readonly fauxItalic: boolean;
}
const choices = new Map<string, FontChoice>();

export function fontUrl(file: string): string | undefined {
    return byFile.get(file);
}

export function chooseFont(style: TextStyle, allowImportedFallback = true): FontChoice {
    const family = style.family
        .split(',')[0]
        .trim()
        .replace(/^["']|["']$/g, '')
        .trim()
        .replace(/\s+/g, ' ');
    if (!allowImportedFallback && !familyFiles.has(family.toLowerCase()))
        throw new Error(`The document font is not registered: ${style.family}`);
    const key = `${style.family}:${Number(style.bold)}:${Number(style.italic)}`;
    const cached = choices.get(key);
    if (cached) return cached;
    const fallback = importedFontFallback(family);
    const bold = style.bold || !!fallback?.bold;
    const stem = familyFiles.get((fallback?.family ?? family).toLowerCase());
    if (!stem) throw new Error(`The document font is not registered: ${style.family}`);
    const requested = `${stem}${bold ? '-bold' : ''}${style.italic ? (bold ? 'italic' : '-italic') : ''}`;
    const file = fontUrl(requested) ? requested : bold && fontUrl(`${stem}-bold`) ? `${stem}-bold` : stem;
    if (!fontUrl(file)) throw new Error(`The document font file is missing: ${file}`);
    const choice = Object.freeze({
        id: file === 'amiri' ? 'amiri-regular' : file,
        file,
        fauxBold: bold && !file.includes('bold'),
        fauxItalic: style.italic && !file.includes('italic'),
    });
    if (choices.size >= 512) choices.delete(choices.keys().next().value!);
    choices.set(key, choice);
    return choice;
}

export function scriptFontFiles(text: string, bold: boolean): readonly string[] {
    return text
        ? scriptFonts
              .filter(([script]) => script.test(text))
              .map(([, file]) => (bold && fontUrl(`${file}-bold`) ? `${file}-bold` : file))
        : [];
}
