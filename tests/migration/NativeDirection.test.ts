import { inheritedDirection } from '@saad5400/midad/direction';
import { findNode, importDocument, type NativeNode } from '@saad5400/midad/document';
import { formatBlock } from '@saad5400/midad/formatting';
import { describe, expect, it } from 'vitest';

const paragraph = (text: string, attrs: Record<string, string | boolean> = {}): NativeNode => ({
    id: 'p',
    kind: 'paragraph',
    attributes: attrs,
    children: [{ id: 'text', kind: 'text', text }],
});
describe('native automatic text direction', () => {
    it('detects Arabic and English for automatic and unconfigured paragraphs', () => {
        expect(inheritedDirection(paragraph('... English العربية', { dir: 'auto' }), 'rtl')).toBe('ltr');
        expect(inheritedDirection(paragraph('... العربية English', { dir: 'auto' }), 'ltr')).toBe('rtl');
        expect(inheritedDirection(paragraph('English'), 'rtl')).toBe('ltr');
    });
    it('updates old unlocked paragraphs while preserving manual direction choices', () => {
        expect(inheritedDirection(paragraph('English', { dir: 'rtl', dirLocked: false }), 'rtl')).toBe('ltr');
        expect(inheritedDirection(paragraph('English', { dir: 'rtl', dirLocked: true }), 'ltr')).toBe('rtl');
        expect(inheritedDirection(paragraph('العربية', { dir: 'ltr' }), 'rtl')).toBe('ltr');
    });
    it('keeps the stored or inherited direction for paragraphs without a strong character', () => {
        expect(inheritedDirection(paragraph('123', { dir: 'ltr', dirLocked: false }), 'rtl')).toBe('ltr');
        expect(inheritedDirection(paragraph('', { dir: 'auto' }), 'rtl')).toBe('rtl');
    });
    it('locks an explicit native toolbar direction so later typing cannot replace it', () => {
        const original = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        attrs: { id: 'p', dir: 'auto', dirLocked: false },
                        content: [{ type: 'text', text: 'English' }],
                    },
                ],
            },
            'direction',
        );
        const document = formatBlock(original, 'p', { dir: 'rtl' });
        expect(findNode(document, 'p')!.attributes?.dirLocked).toBe(true);
        expect(inheritedDirection(findNode(document, 'p')!, 'ltr')).toBe('rtl');
    });
});
