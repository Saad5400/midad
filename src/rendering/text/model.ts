import type { Paragraph, Typeface } from 'canvaskit-wasm';
import type { TextSpan, TextStyle } from '../../typography/style.js';

export interface NativeFontAsset {
    readonly id: string;
    readonly bytes: Uint8Array;
    readonly hash: string;
    readonly typeface: Typeface;
    readonly family: string;
}

export interface ShapedRun {
    readonly fontId: string;
    readonly glyphs: readonly number[];
    readonly text: readonly string[];
    readonly positions: readonly number[];
    readonly offsets: readonly number[];
    readonly size: number;
    readonly style: TextStyle;
    readonly fauxBold: boolean;
    readonly fauxItalic: boolean;
}

export interface ShapedLine {
    readonly start: number;
    readonly end: number;
    readonly endWithBreak: number;
    readonly left: number;
    readonly width: number;
    readonly top: number;
    readonly bottom: number;
    readonly baseline: number;
    readonly runs: readonly ShapedRun[];
}

export interface TextSource {
    readonly nodeId: string;
    readonly from: number;
    readonly to: number;
    readonly editable: boolean;
}
export interface ShapedParagraph {
    readonly paragraph: Paragraph;
    readonly text: string;
    readonly width: number;
    readonly direction: 'rtl' | 'ltr';
    readonly lines: readonly ShapedLine[];
    readonly sources: readonly TextSource[];
    readonly placeholders: readonly {
        readonly span: TextSpan;
        readonly from: number;
        readonly left: number;
        readonly top: number;
        readonly width: number;
        readonly height: number;
    }[];
}

export function shapedLineAt(shaped: ShapedParagraph, offset: number): ShapedLine | undefined {
    return shaped.lines.find((line) => offset < line.endWithBreak) ?? shaped.lines[shaped.lines.length - 1];
}
