export type EditorFontSizeOption = {
    value: `${number}px`;
    label: string;
};

export const EDITOR_FONT_SIZE_OPTIONS: EditorFontSizeOption[] = [
    { value: '8px', label: '8' },
    { value: '10px', label: '10' },
    { value: '12px', label: '12' },
    { value: '14px', label: '14' },
    { value: '16px', label: '16' },
    { value: '18px', label: '18' },
    { value: '20px', label: '20' },
    { value: '24px', label: '24' },
    { value: '28px', label: '28' },
    { value: '32px', label: '32' },
    { value: '36px', label: '36' },
    { value: '40px', label: '40' },
    { value: '44px', label: '44' },
    { value: '48px', label: '48' },
];

export const DEFAULT_EDITOR_FONT_SIZE = '14px';
export const EDITOR_DEFAULT_FONT_SIZE_CSS_VAR = '--editor-default-font-size';

export const HEADING_FONT_SIZES: Record<number, `${number}px`> = {
    1: '32px',
    2: '24px',
    3: '20px',
    4: '18px',
    5: '16px',
    6: '14px',
};

export const getHeadingFontSize = (level: unknown): `${number}px` => {
    const numeric = parseNumeric(level);
    if (numeric === null) {
        return DEFAULT_EDITOR_FONT_SIZE;
    }

    return HEADING_FONT_SIZES[numeric] ?? DEFAULT_EDITOR_FONT_SIZE;
};

const parseNumeric = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
};

export const getNearestEditorFontSizeOption = (value: unknown, fallback = DEFAULT_EDITOR_FONT_SIZE): string => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        const match = EDITOR_FONT_SIZE_OPTIONS.find((opt) => opt.value === trimmed);
        if (match) return match.value;
    }

    const numeric = parseNumeric(value);
    if (numeric === null) return fallback;

    const nearest = EDITOR_FONT_SIZE_OPTIONS.reduce((closest, option) => {
        const optionPx = parseNumeric(option.value) ?? 0;
        const closestPx = parseNumeric(closest.value) ?? 0;
        return Math.abs(optionPx - numeric) < Math.abs(closestPx - numeric) ? option : closest;
    }, EDITOR_FONT_SIZE_OPTIONS[0]);

    return nearest?.value ?? fallback;
};

export const applyEditorFontSizeDefaults = () => {
    if (typeof document === 'undefined') return;

    document.documentElement.style.setProperty(EDITOR_DEFAULT_FONT_SIZE_CSS_VAR, DEFAULT_EDITOR_FONT_SIZE);
};
