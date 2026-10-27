import type { BilingualOptions } from '@saad5400/midad/bilingual';
import { languageDirection } from '@saad5400/midad/direction';
import { BILINGUAL_LABELS } from './labels.js';

export type Lang = string;
export type ColumnGap = BilingualOptions['gap'];
export type ColumnWidths = BilingualOptions['widths'];
export type RowShow = BilingualOptions['show'];
export type BilingualFill = 'manual' | 'auto';
export const isCustomLang = (language: Lang): boolean => language.toLowerCase().startsWith('x-c');
export function nextCustomLang(used: readonly Lang[]): Lang {
    let index = 1;
    while (used.includes(`x-c${index}`)) index++;
    return `x-c${index}`;
}
export function langDir(language: Lang, fallback?: 'rtl' | 'ltr'): 'rtl' | 'ltr' {
    return languageDirection(
        language,
        fallback ?? (typeof document !== 'undefined' && document.documentElement.dir === 'ltr' ? 'ltr' : 'rtl'),
    );
}

export type BilingualLayoutId = 'none' | 'two' | 'three' | 'narrow-start' | 'narrow-end';

export type BilingualSettings = {
    layout: BilingualLayoutId;
    languages: Lang[];
    divider: boolean;
    widths: ColumnWidths;
    gap: ColumnGap;
};

export const CUSTOM = 'custom';

export const bilingualT = (key: string, replacements?: Record<string, string>): string =>
    Object.entries(replacements ?? {}).reduce(
        (text, [name, value]) => text.replace(`:${name}`, value),
        String((BILINGUAL_LABELS[uiLocale().startsWith('ar') ? 'ar' : 'en'] as Record<string, string>)[key] ?? key),
    );

const uiLocale = (): string => document.documentElement.lang || 'ar';

export const languageName = (lang: Lang): string => {
    if (isCustomLang(lang)) return bilingualT('custom_numbered', { number: lang.slice(3) });
    if (lang === CUSTOM) return bilingualT('custom');
    try {
        return new Intl.DisplayNames([uiLocale()], { type: 'language' }).of(lang) ?? lang;
    } catch {
        return lang;
    }
};

// Browsers don't all know every language's own name, so the offered ones are spelled out.
const NATIVE: Record<Lang, string> = {
    ar: 'العربية',
    en: 'English',
    ur: 'اردو',
    hi: 'हिन्दी',
    bn: 'বাংলা',
    ml: 'മലയാളം',
    fil: 'Filipino',
    id: 'Bahasa Indonesia',
    ne: 'नेपाली',
    am: 'አማርኛ',
};

export const nativeName = (lang: Lang): string => {
    if (isCustomLang(lang) || lang === CUSTOM) {
        return bilingualT('custom_native');
    }
    if (NATIVE[lang]) {
        return NATIVE[lang];
    }
    try {
        return new Intl.DisplayNames([lang], { type: 'language' }).of(lang) ?? lang;
    } catch {
        return lang;
    }
};

export const languageList = (langs: Lang[]): string => {
    const names = langs.map(languageName);
    try {
        return new Intl.ListFormat(uiLocale(), { type: 'conjunction' }).format(names);
    } catch {
        return names.join('، ');
    }
};
