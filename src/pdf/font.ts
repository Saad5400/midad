import fontkit from '@pdf-lib/fontkit';
import {
    CustomFontEmbedder,
    PDFContext,
    PDFDict,
    PDFName,
    appendBezierCurve,
    closePath,
    lineTo,
    moveTo,
    type PDFOperator,
    type PDFRef,
} from 'pdf-lib';

export class NativePdfFont extends CustomFontEmbedder {
    private readonly entries = new Map<number, { glyph: number; text: string }>();
    private readonly codes = new Map<number, Map<string, number>>();
    private nextCode = 65535;
    private readonly paths = new Map<string, PDFOperator[]>();

    outline(glyph: number, italic: boolean): PDFOperator[] {
        const key = `${glyph}:${italic}`;
        const cached = this.paths.get(key);
        if (cached) return cached;
        const operators: PDFOperator[] = [];
        const skew = (x: number, y: number): number => x + (italic ? y * 0.25 : 0);
        let x = 0,
            y = 0;
        const sink = {
            moveTo(toX: number, toY: number): void {
                operators.push(moveTo(skew(toX, toY), toY));
                x = toX;
                y = toY;
            },
            lineTo(toX: number, toY: number): void {
                operators.push(lineTo(skew(toX, toY), toY));
                x = toX;
                y = toY;
            },
            bezierCurveTo(x1: number, y1: number, x2: number, y2: number, toX: number, toY: number): void {
                operators.push(appendBezierCurve(skew(x1, y1), y1, skew(x2, y2), y2, skew(toX, toY), toY));
                x = toX;
                y = toY;
            },
            quadraticCurveTo(cx: number, cy: number, toX: number, toY: number): void {
                sink.bezierCurveTo(
                    x + ((cx - x) * 2) / 3,
                    y + ((cy - y) * 2) / 3,
                    toX + ((cx - toX) * 2) / 3,
                    toY + ((cy - toY) * 2) / 3,
                    toX,
                    toY,
                );
            },
            closePath(): void {
                operators.push(closePath());
            },
        };
        this.font.getGlyph(glyph).path.toFunction()(sink);
        this.paths.set(key, operators);
        return operators;
    }

    static async create(bytes: Uint8Array, glyphs: Iterable<{ glyph: number; text: string }>): Promise<NativePdfFont> {
        const parsed = await CustomFontEmbedder.for(fontkit, bytes);
        const result = new NativePdfFont(parsed.font, bytes);
        if (result.isCFF()) throw new Error('The native PDF renderer requires a TrueType font');
        const source = [...glyphs];
        const reserved = new Set(source.map((entry) => entry.glyph));
        for (const entry of source) {
            let variants = result.codes.get(entry.glyph);
            if (!variants) result.codes.set(entry.glyph, (variants = new Map()));
            if (variants.has(entry.text)) continue;
            let code = entry.glyph;
            if (variants.size) {
                while (reserved.has(result.nextCode) || result.entries.has(result.nextCode)) result.nextCode--;
                if (result.nextCode < 1) throw new Error('The document exceeds the font encoding capacity');
                code = result.nextCode--;
            }
            variants.set(entry.text, code);
            result.entries.set(code, entry);
        }
        return result;
    }

    code(glyph: number, text: string): number {
        const code = this.codes.get(glyph)?.get(text);
        if (code === undefined) throw new Error('The PDF glyph was not registered');
        return code;
    }

    protected computeWidths(): (number | number[])[] {
        return [...this.entries]
            .sort(([a], [b]) => a - b)
            .flatMap(([code, entry]) => [code, [this.font.getGlyph(entry.glyph).advanceWidth * this.scale]]);
    }

    protected async embedCIDFontDict(context: PDFContext): Promise<PDFRef> {
        const ref = await super.embedCIDFontDict(context);
        if ([...this.entries].some(([code, entry]) => code !== entry.glyph)) {
            const map = new Uint8Array((Math.max(...this.entries.keys()) + 1) * 2);
            for (const [code, entry] of this.entries) {
                map[code * 2] = entry.glyph >>> 8;
                map[code * 2 + 1] = entry.glyph & 255;
            }
            context.lookup(ref, PDFDict).set(PDFName.of('CIDToGIDMap'), context.register(context.flateStream(map)));
        }
        return ref;
    }

    protected embedUnicodeCmap(context: PDFContext): PDFRef {
        const hex = (value: number): string => value.toString(16).padStart(4, '0');
        const mappings = [...this.entries]
            .filter(([, entry]) => entry.text)
            .map(([code, entry]) => {
                let unicode = '';
                for (let index = 0; index < entry.text.length; index++) unicode += hex(entry.text.charCodeAt(index));
                return `<${hex(code)}> <${unicode}>`;
            });
        const chunks: string[] = [];
        for (let start = 0; start < mappings.length; start += 100) {
            const chunk = mappings.slice(start, start + 100);
            chunks.push(`${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar`);
        }
        return context.register(
            context.flateStream(
                [
                    '/CIDInit /ProcSet findresource begin',
                    '12 dict begin',
                    'begincmap',
                    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
                    '/CMapName /CLM-UCS def',
                    '/CMapType 2 def',
                    '1 begincodespacerange',
                    '<0000> <ffff>',
                    'endcodespacerange',
                    ...chunks,
                    'endcmap',
                    'CMapName currentdict /CMap defineresource pop',
                    'end',
                    'end',
                ].join('\n'),
            ),
        );
    }
}
