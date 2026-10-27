import parseColor from 'color';
import type { Attributes, NativeDocument, NativeNode } from '../document/model.js';
import { isRecord } from '../document/model.js';
import { chooseFont } from './fonts.js';

export type Color = readonly [number, number, number, number];
export interface TextStyle {
    readonly family: string;
    readonly size: number;
    readonly lineHeight: number | null;
    readonly bold: boolean;
    readonly italic: boolean;
    readonly underline: boolean;
    readonly strike: boolean;
    readonly color: Color;
    readonly background: Color | null;
    readonly href: string | null;
}

export interface TextSpan {
    readonly nodeId: string;
    readonly text: string;
    readonly style: TextStyle;
    readonly editable: boolean;
    readonly placeholder?: {
        readonly width: number;
        readonly height: number;
        readonly kind: 'variable' | 'image';
        readonly attributes?: Attributes;
    };
}

export const DEFAULT_TEXT_STYLE: TextStyle = Object.freeze({
    family: 'Arial',
    size: 10.5,
    lineHeight: null,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    color: [0, 0, 0, 1] as Color,
    background: null,
    href: null,
});

export function documentTextStyle(document: NativeDocument): TextStyle {
    const settings = document.root.attributes?.typography;
    if (settings === undefined) return DEFAULT_TEXT_STYLE;
    if (!isRecord(settings) || typeof settings.fontFamily !== 'string' || !settings.fontFamily.trim())
        throw new Error('Invalid document typography');
    const family = settings.fontFamily
        .split(',')[0]
        .replace(/^["']|["']$/g, '')
        .trim();
    const style = Object.freeze({ ...DEFAULT_TEXT_STYLE, family });
    chooseFont(style, false);
    return style;
}

const colors = new Map<string, Color>();
export function color(value: unknown, fallback: Color = [0, 0, 0, 1]): Color {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'string') throw new Error('Invalid document color');
    const text = value.trim().toLowerCase();
    if (!text) return fallback;
    const cached = colors.get(text);
    if (cached) return cached;
    const parsed = parseColor(text);
    const rgb = parsed.rgb().array();
    const result: Color = Object.freeze([rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, parsed.alpha()]);
    if (colors.size >= 256) colors.delete(colors.keys().next().value!);
    colors.set(text, result);
    return result;
}

export function textSize(value: unknown, fallback: number): number {
    if (value === undefined || value === null || value === '') return fallback;
    const match = String(value)
        .trim()
        .match(/^(\d+(?:\.\d+)?)(px|pt|em|rem|%)?$/);
    if (!match) throw new Error(`Invalid font size: ${String(value)}`);
    const size =
        +match[1] *
        (match[2] === 'pt'
            ? 1
            : match[2] === '%'
              ? fallback / 100
              : ['em', 'rem'].includes(match[2])
                ? fallback
                : 0.75);
    if (!(size > 0 && size <= 300)) throw new Error('Font size exceeds the document bounds');
    return size;
}

export function nodeTextStyle(node: NativeNode, base: TextStyle = DEFAULT_TEXT_STYLE): TextStyle {
    const style = { ...base };
    for (const mark of node.marks ?? []) {
        if (mark.kind === 'bold') style.bold = true;
        else if (mark.kind === 'italic') style.italic = true;
        else if (mark.kind === 'underline') style.underline = true;
        else if (mark.kind === 'strike') style.strike = true;
        else if (mark.kind === 'code') style.family = 'Courier New';
        else if (mark.kind === 'link')
            style.href = typeof mark.attributes?.href === 'string' ? mark.attributes.href : null;
        else if (mark.kind === 'textStyle') {
            const attrs = mark.attributes;
            if (typeof attrs?.fontFamily === 'string' && attrs.fontFamily) {
                const family = attrs.fontFamily
                    .split(',')[0]
                    .replace(/^["']|["']$/g, '')
                    .trim();
                if (family) style.family = family;
            }
            style.size = textSize(attrs?.fontSize, style.size);
            if (attrs?.fontWeight !== undefined && attrs.fontWeight !== null) {
                const weight = String(attrs.fontWeight);
                if (weight !== 'bold' && weight !== 'normal' && !/^\d{1,4}$/.test(weight))
                    throw new Error('Invalid font weight');
                style.bold = weight === 'bold' || Number(weight) >= 600;
            }
            if (attrs?.fontStyle !== undefined && attrs.fontStyle !== null) {
                if (attrs.fontStyle !== 'normal' && attrs.fontStyle !== 'italic') throw new Error('Invalid font style');
                style.italic = attrs.fontStyle === 'italic';
            }
            if (attrs?.lineHeight !== undefined && attrs.lineHeight !== null && attrs.lineHeight !== '')
                style.lineHeight = lineHeight(attrs.lineHeight, style.size);
            if (attrs?.color) style.color = color(attrs.color);
            if (attrs?.backgroundColor) style.background = color(attrs.backgroundColor);
        } else if (mark.kind !== 'ychange' && mark.kind !== 'aiAnalysis')
            throw new Error(`Unsupported text mark: ${mark.kind}`);
    }
    if (style.href) {
        style.underline = true;
        if (!node.marks?.some((mark) => mark.kind === 'textStyle' && mark.attributes?.color))
            style.color = [0.12, 0.35, 0.65, 1];
    }
    return Object.freeze(style);
}

export function lineHeight(value: unknown, size: number): number | null {
    if (value === 'normal') return null;
    const text = String(value).trim();
    const ratio = /^\d+(?:\.\d+)?$/.test(text)
        ? Number(text)
        : text.endsWith('%')
          ? Number(text.slice(0, -1)) / 100
          : textSize(text, size) / size;
    if (!Number.isFinite(ratio) || ratio < 0.25 || ratio > 20) throw new Error('Invalid line height');
    return ratio;
}

export function blockTextStyle(node: NativeNode, base = DEFAULT_TEXT_STYLE): TextStyle {
    if (node.kind === 'codeBlock') return { ...base, family: 'Courier New' };
    if (node.kind !== 'heading' && node.kind !== 'clauseTitle') return base;
    const level = numericAttribute(node.attributes, 'level', 1);
    return {
        ...base,
        bold: true,
        size: node.kind === 'clauseTitle' ? 15 : [24, 18, 15, 13.5, 12, 10.5][Math.max(0, Math.min(5, level - 1))],
    };
}

export function inlineSpans(node: NativeNode, base = DEFAULT_TEXT_STYLE): readonly TextSpan[] {
    const spans: TextSpan[] = [];
    const visit = (child: NativeNode): void => {
        if (child.kind === 'text')
            spans.push({ nodeId: child.id, text: child.text ?? '', style: nodeTextStyle(child, base), editable: true });
        else if (child.kind === 'hardBreak') spans.push({ nodeId: child.id, text: '\n', style: base, editable: false });
        else if (child.kind === 'variable' || child.kind === 'image')
            spans.push({
                nodeId: child.id,
                text: '\uFFFC',
                style: base,
                editable: false,
                placeholder: {
                    kind: child.kind,
                    width: numericAttribute(child.attributes, 'width', 200) * 0.75,
                    height: numericAttribute(child.attributes, 'height', child.kind === 'image' ? 100 : 24) * 0.75,
                    attributes: child.attributes,
                },
            });
        else throw new Error(`Inline layout is not implemented for ${child.kind}`);
    };
    for (const child of node.children ?? []) visit(child);
    return spans.length ? spans : [{ nodeId: node.id, text: '', style: base, editable: false }];
}

export function numericAttribute(attrs: Attributes | undefined, key: string, fallback: number): number {
    const value = Number(attrs?.[key]);
    return attrs?.[key] !== undefined && Number.isFinite(value) ? value : fallback;
}

export function documentTextNodes(document: NativeDocument): NativeNode[] {
    const result: NativeNode[] = [];
    const visit = (node: NativeNode): void => {
        if (node.kind === 'text') result.push(node);
        node.children?.forEach(visit);
    };
    visit(document.root);
    return result;
}
