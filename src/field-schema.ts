import { DEFAULT_EDITOR_FONT_SIZE, getNearestEditorFontSizeOption } from './font-sizes.js';
import { DEFAULT_EDITOR_FONT, getNearestEditorFontOption } from './font-options.js';
export type VariableType =
    | 'text'
    | 'date'
    | 'signature'
    | 'initials'
    | 'stamp'
    | 'attachment'
    | 'choice'
    | 'single'
    | 'multi';
interface VariableSetting {
    key: string;
    type: 'select' | 'checkbox' | 'repeater';
    options?: { value: string }[];
    defaultValue?: string | boolean;
    min?: number;
    max?: number;
}
interface VariableConfig {
    id: VariableType;
    display?: string;
    settings: VariableSetting[];
}
export const VARIABLE_CONFIGS: Record<VariableType, VariableConfig> = {
    signature: {
        id: 'signature',
        display: 'block',
        settings: [
            {
                key: 'required',
                type: 'checkbox',
                defaultValue: true,
            },
        ],
    },
    initials: {
        id: 'initials',
        display: 'block',
        settings: [
            {
                key: 'required',
                type: 'checkbox',
                defaultValue: true,
            },
        ],
    },
    text: {
        id: 'text',
        settings: [
            {
                key: 'required',
                type: 'checkbox',
                defaultValue: true,
            },
        ],
    },
    date: {
        id: 'date',
        settings: [
            {
                key: 'calendarType',
                type: 'select',
                options: [
                    { value: 'gregorian' },
                    { value: 'hijri' },
                ],
                defaultValue: 'gregorian',
            },
            {
                key: 'dateFormat',
                type: 'select',
                options: [
                    { value: 'dd/mm/yyyy' },
                    { value: 'mm/dd/yyyy' },
                    { value: 'yyyy-mm-dd' },
                ],
                defaultValue: 'dd/mm/yyyy',
            },
            {
                key: 'required',
                type: 'checkbox',
                defaultValue: true,
            },
        ],
    },
    attachment: {
        id: 'attachment',
        settings: [
            {
                key: 'required',
                type: 'checkbox',
                defaultValue: true,
            },
        ],
    },
    stamp: {
        id: 'stamp',
        display: 'block',
        settings: [
            {
                key: 'required',
                type: 'checkbox',
                defaultValue: true,
            },
        ],
    },
    choice: {
        id: 'choice',
        settings: [
            {
                key: 'options',
                type: 'repeater',
                min: 1,
            },
            {
                key: 'allowOther',
                type: 'checkbox',
                defaultValue: false,
            },
            {
                key: 'required',
                type: 'checkbox',
                defaultValue: true,
            },
        ],
    },
    single: {
        id: 'single',
        settings: [
            {
                key: 'options',
                type: 'repeater',
                min: 1,
            },
            {
                key: 'allowOther',
                type: 'checkbox',
                defaultValue: false,
            },
            {
                key: 'required',
                type: 'checkbox',
                defaultValue: true,
            },
        ],
    },
    multi: {
        id: 'multi',
        settings: [
            {
                key: 'options',
                type: 'repeater',
                min: 1,
            },
            {
                key: 'allowOther',
                type: 'checkbox',
                defaultValue: false,
            },
            {
                key: 'required',
                type: 'checkbox',
                defaultValue: true,
            },
        ],
    },
};
export const MIN_VARIABLE_WIDTH = 100;
export const MIN_VARIABLE_HEIGHT = 10;
export const MAX_VARIABLE_WIDTH = 800;
export const MAX_VARIABLE_HEIGHT = 600;
export const DEFAULT_VARIABLE_WIDTH = 200;
export const DEFAULT_VARIABLE_HEIGHT = 24;
export const MAX_SELECTION_NAME_LENGTH = 80;
export const DEFAULT_DATE_WIDTH = 92;
export const DEFAULT_SIGNATURE_WIDTH = 250;
export const DEFAULT_SIGNATURE_HEIGHT = 80;
export const DEFAULT_INITIALS_WIDTH = 129;
export const DEFAULT_INITIALS_HEIGHT = 43;

export function getDefaultVariableDimensions(type: VariableType): { width: number; height: number } {
    if (type === 'signature' || type === 'stamp') {
        return { width: DEFAULT_SIGNATURE_WIDTH, height: DEFAULT_SIGNATURE_HEIGHT };
    }
    if (type === 'initials') {
        return { width: DEFAULT_INITIALS_WIDTH, height: DEFAULT_INITIALS_HEIGHT };
    }
    if (type === 'date') {
        return { width: DEFAULT_DATE_WIDTH, height: DEFAULT_VARIABLE_HEIGHT };
    }
    return { width: DEFAULT_VARIABLE_WIDTH, height: DEFAULT_VARIABLE_HEIGHT };
}

export function getMinVariableDimensions(type: VariableType): { width: number; height: number } {
    if (type === 'signature' || type === 'stamp') {
        return { width: 120, height: 60 };
    }
    if (type === 'initials') {
        return { width: 64, height: 28 };
    }
    return { width: MIN_VARIABLE_WIDTH, height: MIN_VARIABLE_HEIGHT };
}


export const WRITING_SETTINGS_TYPES: readonly VariableType[] = ['text', 'date', 'choice', 'single', 'multi'];

export const DEFAULT_WRITING_SETTINGS = {
    fontFamily: DEFAULT_EDITOR_FONT,
    fontSize: DEFAULT_EDITOR_FONT_SIZE,
    color: '#000000',
    textAlign: 'center',
    direction: 'rtl',
    fontWeight: 'normal',
    fontStyle: 'normal',
    textDecoration: 'none',
} as const;

export function getDefaultVariableSettings(
    type: VariableType,
    display: 'inline' | 'block' = 'inline',
): Record<string, any> {
    const config = VARIABLE_CONFIGS[type];
    const settings: Record<string, any> = {};

    if (WRITING_SETTINGS_TYPES.includes(type)) {
        Object.assign(settings, DEFAULT_WRITING_SETTINGS);
    }

    for (const setting of config.settings) {
        if (setting.type === 'select' || setting.type === 'checkbox') {
            if (setting.defaultValue !== undefined) {
                settings[setting.key] = setting.defaultValue;
            }
        }
    }
    return settings;
}

export const COVER_VARIABLE_FONT_SIZE = '24px';
export const DEFAULT_COVER_VARIABLE_WIDTH = 320;

export function getCoverVariableDefaults(type: VariableType): { width: number; settings: Record<string, any> } {
    const settings = getDefaultVariableSettings(type, 'block');
    if (WRITING_SETTINGS_TYPES.includes(type)) {
        settings.fontSize = COVER_VARIABLE_FONT_SIZE;
    }
    return {
        width: Math.max(getDefaultVariableDimensions(type).width, DEFAULT_COVER_VARIABLE_WIDTH),
        settings,
    };
}

const VALID_TEXT_ALIGN = ['start', 'center', 'end', 'left', 'right', 'justify'] as const;
const VALID_DIRECTION = ['rtl', 'ltr'] as const;
const VALID_FONT_WEIGHT = ['normal', 'bold'] as const;
const VALID_FONT_STYLE = ['normal', 'italic'] as const;
const VALID_TEXT_DECORATION = ['none', 'underline'] as const;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

const validHexColor = (value: unknown, fallback: string): string =>
    typeof value === 'string' && HEX_COLOR.test(value.trim()) ? value.trim() : fallback;

export function getEffectiveWritingSettings(
    type: VariableType,
    settings: Record<string, any> | null | undefined,
): Record<string, any> {
    const fontSize = getNearestEditorFontSizeOption(settings?.fontSize, DEFAULT_WRITING_SETTINGS.fontSize);
    if (!WRITING_SETTINGS_TYPES.includes(type)) {
        return { fontSize };
    }
    const s = settings ?? {};
    const direction = oneOf(s.direction, VALID_DIRECTION, DEFAULT_WRITING_SETTINGS.direction);
    const rawAlign = oneOf(s.textAlign, VALID_TEXT_ALIGN, DEFAULT_WRITING_SETTINGS.textAlign);
    const textAlign =
        rawAlign === 'left' ? (direction === 'rtl' ? 'end' : 'start')
            : rawAlign === 'right' ? (direction === 'rtl' ? 'start' : 'end')
                : rawAlign;
    return {
        fontFamily: getNearestEditorFontOption(s.fontFamily, DEFAULT_WRITING_SETTINGS.fontFamily),
        fontSize,
        color: validHexColor(s.color, DEFAULT_WRITING_SETTINGS.color),
        textAlign,
        direction,
        fontWeight: oneOf(s.fontWeight, VALID_FONT_WEIGHT, DEFAULT_WRITING_SETTINGS.fontWeight),
        fontStyle: oneOf(s.fontStyle, VALID_FONT_STYLE, DEFAULT_WRITING_SETTINGS.fontStyle),
        textDecoration: oneOf(s.textDecoration, VALID_TEXT_DECORATION, DEFAULT_WRITING_SETTINGS.textDecoration),
    };
}

