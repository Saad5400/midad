export type EditorFontOption = {
    label: string;
    value: string;
};

const formatFontName = (name: string) => (/\s/.test(name) ? `"${name}"` : name);

export const DEFAULT_EDITOR_FONT = 'Arial';
export const DEFAULT_EDITOR_FONT_LABEL = 'Arial';

// Visible picker options.
export const EDITOR_FONT_OPTIONS: EditorFontOption[] = [
    { label: 'Arial', value: 'Arial' },
    { label: 'Almarai', value: 'Almarai' },
    { label: 'Amiri', value: 'Amiri' },
    { label: 'Aref Ruqaa', value: 'Aref Ruqaa' },
    { label: 'Cairo', value: 'Cairo' },
    { label: 'Changa', value: 'Changa' },
    { label: 'Comic Sans MS', value: 'Comic Sans MS' },
    { label: 'Courier New', value: 'Courier New' },
    { label: 'El Messiri', value: 'El Messiri' },
    { label: 'Georgia', value: 'Georgia' },
    { label: 'Harmattan', value: 'Harmattan' },
    { label: 'IBM Plex Sans Arabic', value: 'IBM Plex Sans Arabic' },
    { label: 'Impact', value: 'Impact' },
    { label: 'Lemonada', value: 'Lemonada' },
    { label: 'Mada', value: 'Mada' },
    { label: 'Noto Naskh Arabic', value: 'Noto Naskh Arabic' },
    { label: 'Noto Sans Arabic', value: 'Noto Sans Arabic' },
    { label: 'Readex Pro', value: 'Readex Pro' },
    { label: 'Scheherazade', value: 'Scheherazade New' },
    { label: 'Tajawal', value: 'Tajawal' },
    { label: 'Times New Roman', value: 'Times New Roman' },
    { label: 'Trebuchet MS', value: 'Trebuchet MS' },
];

const LEGACY_EDITOR_FONTS = ['Calibri', 'Cambria', 'Verdana', 'Times', 'Noto Sans Symbols 2'];

export const ALL_EDITOR_FONT_OPTIONS: EditorFontOption[] = [
    ...EDITOR_FONT_OPTIONS,
    ...LEGACY_EDITOR_FONTS.map((value) => ({ label: value, value })),
];

export const getNearestEditorFontOption = (value: unknown, fallback = DEFAULT_EDITOR_FONT): string => {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const match = ALL_EDITOR_FONT_OPTIONS.find((opt) => opt.value === trimmed || opt.label === trimmed);
    return match?.value ?? fallback;
};

// Bundled faces (editor-script-fonts.css) for glyphs the chosen font lacks, so no system font fills them.
export const SCRIPT_FALLBACK_FONT = 'CLM Script Fallback';

// Unknown imported families keep falling to the browser default, which the fallback would otherwise replace.
export const withScriptFallback = (font: string): string => {
    const name = font.trim().replace(/^['"]|['"]$/g, '');
    const known = ALL_EDITOR_FONT_OPTIONS.some((option) => option.value === name);

    return known ? `${formatFontName(name)}, "${SCRIPT_FALLBACK_FONT}"` : font;
};

const buildFontStack = (font: string) => {
    const family = formatFontName(font);
    return family ? `${withScriptFallback(font)}, sans-serif` : 'sans-serif';
};

export const EDITOR_DEFAULT_FONT_STACK = buildFontStack(DEFAULT_EDITOR_FONT);
export const EDITOR_DEFAULT_FONT_CSS_VAR = '--editor-default-font';

export const applyEditorFontDefaults = () => {
    if (typeof document === 'undefined') return;

    document.documentElement.style.setProperty(EDITOR_DEFAULT_FONT_CSS_VAR, EDITOR_DEFAULT_FONT_STACK);
};
