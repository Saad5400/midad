import { DocumentSession, importDocument } from '@saad5400/midad/document';
import { blockTextStyle, color, inlineSpans, lineHeight, nodeTextStyle, textSize } from '@saad5400/midad/typography';
import { describe, expect, it } from 'vitest';

describe('native rich text semantics', () => {
    it('accepts standard CSS color names, HSL and percentage RGB without losing opacity', () => {
        expect(color('green')).toEqual([0, 128 / 255, 0, 1]);
        expect(color('hsl(120, 100%, 25%)')).toEqual([0, 0.5, 0, 1]);
        expect(color('rgba(100%, 0%, 0%, 0.4)')).toEqual([1, 0, 0, 0.4]);
        expect(() => color({ red: 1 })).toThrow();
    });
    it('inherits heading and code styles while preserving explicit text styles', () => {
        const heading = blockTextStyle({ id: 'heading', kind: 'heading', attributes: { level: 2 } });
        expect(nodeTextStyle({ id: 'text', kind: 'text', text: 'عنوان' }, heading)).toMatchObject({
            bold: true,
            size: 18,
        });
        expect(blockTextStyle({ id: 'code', kind: 'codeBlock' }).family).toBe('Courier New');
    });

    it('normalizes explicit line spacing before layout', () => {
        expect(lineHeight('1.5', 12)).toBe(1.5);
        expect(lineHeight('150%', 12)).toBe(1.5);
        expect(lineHeight('24px', 12)).toBe(1.5);
        expect(lineHeight('normal', 12)).toBeNull();
        expect(() => lineHeight('0', 12)).toThrow();
        expect(() => lineHeight('-1', 12)).toThrow();
    });
    it('keeps font formatting and independent color/background channels', () => {
        const style = nodeTextStyle({
            id: 'text',
            kind: 'text',
            text: 'نص',
            marks: [
                { kind: 'bold' },
                { kind: 'italic' },
                { kind: 'underline' },
                { kind: 'strike' },
                {
                    kind: 'textStyle',
                    attributes: { fontFamily: 'Arial', fontSize: '18px', color: '#17355b', backgroundColor: '#fff4cc' },
                },
            ],
        });
        expect(style).toMatchObject({
            family: 'Arial',
            size: 13.5,
            bold: true,
            italic: true,
            underline: true,
            strike: true,
        });
        expect(style.color).toEqual([23 / 255, 53 / 255, 91 / 255, 1]);
        expect(style.background).toEqual([1, 244 / 255, 204 / 255, 1]);
    });

    it('uses Unicode object placeholders for inline fields and images', () => {
        const spans = inlineSpans({
            id: 'paragraph',
            kind: 'paragraph',
            children: [
                { id: 'text', kind: 'text', text: 'عقد' },
                {
                    id: 'field',
                    kind: 'variable',
                    attributes: { type: 'text', width: 120, height: 24, participant_id: 'participant' },
                },
                { id: 'break', kind: 'hardBreak' },
                { id: 'image', kind: 'image', attributes: { src: 'data:image/png;base64,AA', width: 80, height: 40 } },
            ],
        });
        expect(spans.map((span) => span.text).join('')).toBe('عقد\uFFFC\n\uFFFC');
        expect(spans[1]).toMatchObject({
            nodeId: 'field',
            editable: false,
            placeholder: { width: 90, height: 18, attributes: { participant_id: 'participant' } },
        });
        expect(spans[3].placeholder).toMatchObject({ kind: 'image', width: 60, height: 30 });
    });

    it.each([
        ['18px', 13.5],
        ['18pt', 18],
        ['150%', 18],
        ['1.5em', 18],
    ])('converts %s to canonical PDF points', (value, expected) => {
        expect(textSize(value, 12)).toBe(expected);
    });

    it('rejects malformed document styles instead of silently changing their appearance', () => {
        expect(() => textSize('infinity', 12)).toThrow();
        expect(() => color('javascript:bad')).toThrow();
        expect(color('#fff0')).toEqual([1, 1, 1, 0]);
    });

    it('discards old undo history when an authoritative document replaces the session', () => {
        const source = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'قديم' }] }] };
        const session = new DocumentSession(importDocument(source, 'document'));
        session.replace({ nodeId: 'document:root.0.0', from: 0, to: 0, text: 'نص ', expectedRevision: 0 });
        session.reset(
            importDocument(
                { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'جديد' }] }] },
                'document',
            ),
        );
        expect(session.document.revision).toBe(2);
        expect(session.undo()).toBe(false);
        expect(session.redo()).toBe(false);
    });
});
