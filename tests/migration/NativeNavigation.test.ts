import { importDocument } from '@saad5400/midad/document';
import type { ShapedParagraph } from '@saad5400/midad/kernel';
import type { DocumentScene, SceneLine } from '@saad5400/midad/layout';
import { NativeNavigation, wordBoundary } from '@saad5400/midad/navigation';
import type { CanvasKit } from 'canvaskit-wasm';
import { describe, expect, it } from 'vitest';

const ltr = {},
    rtl = {};
const ck = {
    RectHeightStyle: { Tight: 0 },
    RectWidthStyle: { Tight: 0 },
    TextDirection: { LTR: ltr, RTL: rtl },
} as unknown as CanvasKit;

function shaped(
    text: string,
    direction: 'rtl' | 'ltr' = 'ltr',
    wrap = text.length,
    positions?: number[],
): ShapedParagraph {
    const segments = [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)];
    const rows = Array.from({ length: Math.max(1, Math.ceil(text.length / Math.max(1, wrap))) }, (_, index) => ({
        start: index * wrap,
        end: Math.min(text.length, (index + 1) * wrap),
        endWithBreak: Math.min(text.length, (index + 1) * wrap),
        left: 0,
        width: Math.min(wrap, text.length - index * wrap) * 10,
        top: index * 20,
        bottom: index * 20 + 12,
        baseline: index * 20 + 10,
        runs: [],
    }));
    const boxes = segments.map((part, index) => {
        const row = rows.find((row) => part.index >= row.start && part.index < row.end)!;
        const backward = /[\u0590-\u08ff]/.test(part.segment);
        const x =
            positions?.[index] ??
            (direction === 'rtl' ? row.end - part.index - part.segment.length : part.index - row.start) * 10;
        return {
            from: part.index,
            to: part.index + part.segment.length,
            dir: backward ? rtl : ltr,
            rect: [x, row.top, x + 10, row.bottom],
        };
    });
    return {
        text,
        direction,
        width: Math.max(...rows.map((row) => row.width)),
        lines: rows,
        sources: [],
        placeholders: [],
        paragraph: {
            getRectsForRange: (from: number, to: number) => boxes.filter((box) => box.from >= from && box.to <= to),
            getGlyphPositionAtCoordinate: (x: number, y: number) => {
                const box = boxes
                    .filter((box) => y >= box.rect[1] && y <= box.rect[3])
                    .find((box) => x >= box.rect[0] && x <= box.rect[2]);
                if (!box) return { pos: 0 };
                return { pos: x < (box.rect[0] + box.rect[2]) / 2 !== (box.dir === rtl) ? box.from : box.to };
            },
        },
    } as unknown as ShapedParagraph;
}

function navigation(shape: ShapedParagraph): NativeNavigation {
    const document = importDocument(
        {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    attrs: { id: 'p' },
                    content: shape.text ? [{ type: 'text', text: shape.text }] : [],
                },
            ],
        },
        'navigation',
    );
    const lines: SceneLine[] = shape.lines.map((line) => ({
        paragraphId: 'p',
        textNodeId: 'text',
        shaped: shape,
        left: 0,
        top: line.top,
        originalTop: line.top,
        height: line.bottom - line.top,
    }));
    const scene = {
        documentId: document.id,
        revision: 0,
        fontHash: '',
        margin: 0,
        glyphCount: 0,
        pages: [{ width: 100, height: 200, commands: [], lines }],
    } as DocumentScene;
    return new NativeNavigation(document, scene, ck);
}

describe('native text navigation', () => {
    it('moves through LTR and RTL text in the physical arrow direction', () => {
        const latin = navigation(shaped('abc'));
        expect(latin.horizontal({ blockId: 'p', offset: 0 }, 1, 'downstream').offset).toBe(1);
        const arabic = navigation(shaped('ابت', 'rtl'));
        expect(arabic.horizontal({ blockId: 'p', offset: 0 }, -1, 'downstream').offset).toBe(1);
        expect(arabic.horizontal({ blockId: 'p', offset: 1 }, 1, 'upstream').offset).toBe(0);
        expect(
            arabic.collapse({ anchor: { blockId: 'p', offset: 0 }, focus: { blockId: 'p', offset: 2 } }, -1).offset,
        ).toBe(2);
    });

    it('keeps both caret positions at a bidirectional boundary while walking logical text order', () => {
        const nav = navigation(shaped('aאבc', 'ltr', 4, [0, 20, 10, 30]));
        let caret = { blockId: 'p', offset: 0, affinity: 'downstream' as const } as ReturnType<
            NativeNavigation['horizontal']
        >;
        const seen: number[] = [nav.caret(caret, caret.affinity)!.x];
        for (let index = 0; index < 4; index++) {
            caret = nav.horizontal(caret, 1, caret.affinity);
            seen.push(nav.caret(caret, caret.affinity)!.x);
        }
        expect(seen).toEqual([0, 10, 20, 10, 40]);
        expect(nav.caret({ blockId: 'p', offset: 1 }, 'downstream')!.x).toBe(30);
        expect(nav.caret({ blockId: 'p', offset: 1 }, 'upstream')!.x).toBe(10);
    });

    it('crosses a soft wrap without stopping twice at the same source offset', () => {
        const nav = navigation(shaped('abcdef', 'ltr', 3));
        expect(nav.horizontal({ blockId: 'p', offset: 3 }, 1, 'upstream')).toMatchObject({ offset: 4 });
        expect(nav.horizontal({ blockId: 'p', offset: 3 }, -1, 'downstream')).toMatchObject({ offset: 2 });
        expect(nav.caret({ blockId: 'p', offset: 3 }, 'upstream')!.row.line.start).toBe(0);
        expect(nav.caret({ blockId: 'p', offset: 3 }, 'downstream')!.row.line.start).toBe(3);
    });

    it('does not split a Unicode grapheme during horizontal movement', () => {
        const nav = navigation(shaped('A👨‍👩‍👧B'));
        expect(nav.horizontal({ blockId: 'p', offset: 1 }, 1, 'downstream').offset).toBe(9);
    });

    it.each([
        ['Hello world', 0, 1, 5],
        ['Hello world', 5, 1, 11],
        ['Hello world', 11, -1, 6],
        ['مرحبا بالعالم', 0, 1, 5],
        ['مرحبا بالعالم', 13, -1, 6],
        ['', 0, 1, 0],
    ] as const)('finds word boundaries in %s', (text, offset, direction, expected) => {
        expect(wordBoundary(text, offset, direction)).toBe(expected);
    });
});
