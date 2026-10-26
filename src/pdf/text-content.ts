import type { GlyphCommand, TextReading } from '../layout/scene.js';
import type { NativePdfFont } from './font.js';

const black = [0, 0, 0, 1] as const;
const exact = (value: number) => Math.abs(value) <= 1024 && Number.isInteger(value * 4096);

export interface PdfTextFont {
    name: string;
    font: NativePdfFont;
}

export class PdfTextContent {
    private style?: { size: number; bold: boolean; color: readonly number[] };
    private activeFont?: string;
    private activeItalic?: boolean;
    private previousX?: number;
    private previousY?: number;

    constructor(
        private readonly content: string[],
        private readonly height: number,
        private readonly fonts: ReadonlyMap<string, PdfTextFont>,
        private readonly scalar: (value: number) => string,
        private readonly alpha: (value: number) => string,
        private readonly span: (part: TextReading) => string,
    ) {}

    append(command: GlyphCommand): void {
        const color = command.color ?? black;
        if (
            color[3] !== 1 ||
            !this.style ||
            this.style.size !== command.size ||
            this.style.bold !== !!command.fauxBold ||
            !this.style.color.every((value, at) => value === color[at])
        ) {
            this.finish();
            const ink = color.slice(0, 3).map(this.scalar).join(' ');
            this.content.push(
                `q ${this.alpha(color[3])}BT ${ink} rg ${ink} RG ${this.scalar(command.size / 35)} w 4 M ${command.fauxBold ? 2 : 0} Tr`,
            );
            this.style = { size: command.size, bold: !!command.fauxBold, color };
        }
        const face = this.fonts.get(command.fontId);
        if (!face) throw new Error('The PDF text font is not registered');
        if (this.activeFont !== command.fontId) {
            this.content.push(`${face.name} ${this.scalar(command.size)} Tf`);
            this.activeFont = command.fontId;
            this.previousX = this.previousY = undefined;
        }
        if (this.activeItalic !== !!command.fauxItalic) this.previousX = this.previousY = undefined;
        this.activeItalic = !!command.fauxItalic;
        const simple = !command.reading || command.reading.length <= 1;
        const part = command.reading?.[0];
        for (let index = 0; index < command.glyphs.length; index++) {
            const start = simple
                ? part?.from === index && part.text
                    ? part
                    : undefined
                : command.reading?.find((part) => part.from === index && part.text);
            const close = simple
                ? part?.to === index + 1 && !!part.text
                : command.reading?.some((part) => part.to === index + 1 && part.text);
            if (start) this.content.push(this.span(start));
            const x = command.positions[index * 2];
            const y = this.height - command.positions[index * 2 + 1];
            if (!command.text[index]) {
                this.previousX = this.previousY = undefined;
                const scale = this.scalar(command.size / face.font.font.unitsPerEm);
                this.content.push(
                    `ET q ${scale} 0 0 ${scale} ${this.scalar(x)} ${this.scalar(y)} cm ${this.scalar(face.font.font.unitsPerEm / 35)} w`,
                    ...face.font.outlineContent(command.glyphs[index], !!command.fauxItalic),
                    `${command.fauxBold ? 'B' : 'f'} Q BT`,
                );
            } else {
                const code = face.font.hexCode(command.glyphs[index], command.text[index]);
                const dy = this.previousY === undefined ? 0 : y - this.previousY;
                const dx = this.previousX === undefined ? 0 : x - this.previousX - (command.fauxItalic ? 0.25 * dy : 0);
                if (
                    this.previousX !== undefined &&
                    this.previousY !== undefined &&
                    exact(x) &&
                    exact(y) &&
                    exact(this.previousX) &&
                    exact(this.previousY) &&
                    exact(dx) &&
                    exact(dy)
                )
                    this.content.push(`${this.scalar(dx)} ${this.scalar(dy)} Td <${code}> Tj`);
                else
                    this.content.push(
                        `1 0 ${command.fauxItalic ? 0.25 : 0} 1 ${this.scalar(x)} ${this.scalar(y)} Tm <${code}> Tj`,
                    );
                this.previousX = x;
                this.previousY = y;
            }
            if (close) this.content.push('EMC');
        }
    }

    finish(): void {
        if (!this.style) return;
        this.content.push('ET Q');
        this.style = undefined;
        this.activeFont = undefined;
        this.activeItalic = undefined;
        this.previousX = this.previousY = undefined;
    }
}
