import type { NativeNode } from '../document/model.js';

const RTL_CHAR = /[֑-߿‏‫‮יִ-﷽ﹰ-ﻼ]/;
// First strongly-LTR character: Latin, Greek, Cyrillic, Armenian, etc.
const LTR_CHAR = /[A-Za-zÀ-ÖØ-öø-ʸ]/;

export function detectStrongDirection(text: string): 'rtl' | 'ltr' | null {
    for (const char of text) {
        if (RTL_CHAR.test(char)) return 'rtl';
        if (LTR_CHAR.test(char)) return 'ltr';
    }
    return null;
}

const rtlLanguages = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'yi', 'ckb', 'sd', 'ug', 'dv']);
export function languageDirection(language: string, fallback: 'rtl' | 'ltr' = 'rtl'): 'rtl' | 'ltr' {
    if (language.toLowerCase().startsWith('x-c')) return fallback;
    return rtlLanguages.has(language.split('-')[0].toLowerCase()) ? 'rtl' : 'ltr';
}
const automaticKinds = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'clause', 'clauseTitle']);
function contentDirection(node: NativeNode): 'rtl' | 'ltr' | null {
    if (node.kind === 'text') return detectStrongDirection(node.text ?? '');
    for (const child of node.children ?? []) {
        const direction = contentDirection(child);
        if (direction) return direction;
    }
    return null;
}
export function automaticDirection(node: NativeNode): boolean {
    return (
        automaticKinds.has(node.kind) &&
        (!(node.attributes?.dir === 'ltr' || node.attributes?.dir === 'rtl') || node.attributes?.dirLocked === false)
    );
}
export function inheritedDirection(node: NativeNode, parent: 'rtl' | 'ltr'): 'rtl' | 'ltr' {
    const explicit = node.attributes?.dir === 'ltr' || node.attributes?.dir === 'rtl' ? node.attributes.dir : undefined;
    if (automaticDirection(node)) return contentDirection(node) ?? explicit ?? parent;
    return (
        explicit ??
        (node.kind === 'parallelCell' && typeof node.attributes?.lang === 'string'
            ? languageDirection(node.attributes.lang, parent)
            : parent)
    );
}
