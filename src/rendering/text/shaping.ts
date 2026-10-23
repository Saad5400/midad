import type { CanvasKit } from 'canvaskit-wasm';
import { chooseFont, scriptFontFiles } from '../../typography/fonts.js';
import { symbolFontFiles } from '../../typography/font-fallbacks.js';
import { point } from '../../typography/metrics.js';
import { DEFAULT_TEXT_STYLE, type TextSpan, type TextStyle } from '../../typography/style.js';
import { NATIVE_FONT_ID, type TextFonts } from './fonts.js';
import type { ShapedLine, ShapedParagraph, ShapedRun } from './model.js';

export function shapeParagraph(
    ck: CanvasKit,
    fonts: TextFonts,
    spans: readonly TextSpan[],
    width: number,
    direction: 'rtl' | 'ltr',
    alignment?: string,
    heightMultiplier?: number,
): ShapedParagraph {
    const align =
        alignment === 'justify'
            ? ck.TextAlign.Justify
            : alignment === 'center'
              ? ck.TextAlign.Center
              : alignment === 'left'
                ? ck.TextAlign.Left
                : alignment === 'right'
                  ? ck.TextAlign.Right
                  : direction === 'rtl'
                    ? ck.TextAlign.Right
                    : ck.TextAlign.Left;
    const builder = ck.ParagraphBuilder.MakeFromFontCollection(
        new ck.ParagraphStyle({
            disableHinting: true,
            applyRoundingHack: false,
            replaceTabCharacters: true,
            textStyle: {
                fontFamilies: [`Native-${chooseFont(spans[0]?.style ?? DEFAULT_TEXT_STYLE).id}`],
                fontSize: spans[0]?.style.size ?? DEFAULT_TEXT_STYLE.size,
                color: ck.BLACK,
                ...(spans[0]?.style.lineHeight ? { heightMultiplier: spans[0].style.lineHeight } : {}),
            },
            textDirection: direction === 'rtl' ? ck.TextDirection.RTL : ck.TextDirection.LTR,
            textAlign: align,
            ...(heightMultiplier ? { heightMultiplier } : {}),
        }),
        fonts.collectionForShaping(),
    );
    let text = '';
    let bytes = 0;
    const ranges = spans.map((span) => {
        const choice = chooseFont(span.style);
        fonts.get(choice.id);
        const from = text.length;
        const byteStart = bytes;
        text += span.text;
        bytes += new TextEncoder().encode(span.text).length;
        const fallback = [
            ...new Set([
                NATIVE_FONT_ID,
                ...scriptFontFiles(span.text, span.style.bold),
                chooseFont({ ...span.style, family: DEFAULT_TEXT_STYLE.family }).id,
                ...symbolFontFiles(span.text, span.style.bold),
            ]),
        ].filter((id) => id !== choice.id);
        builder.pushStyle(
            new ck.TextStyle({
                fontFamilies: [`Native-${choice.id}`, ...fallback.map((id) => `Native-${id}`)],
                fontSize: span.style.size,
                color: ck.BLACK,
                ...(span.style.lineHeight === null ? {} : { heightMultiplier: span.style.lineHeight }),
            }),
        );
        if (span.placeholder)
            builder.addPlaceholder(
                span.placeholder.width,
                span.placeholder.height,
                ck.PlaceholderAlignment.Baseline,
                ck.TextBaseline.Alphabetic,
                span.placeholder.height * 0.8,
            );
        else builder.addText(span.text);
        builder.pop();
        return { span, choice, from, to: text.length, byteStart, byteEnd: bytes };
    });
    if (!text) builder.addText(' ');
    const paragraph = builder.build();
    builder.delete();
    paragraph.layout(width);
    const rawLines = paragraph.getShapedLines();
    const metrics = paragraph.getLineMetrics();
    const byLine = new Map<number, (typeof rawLines)[number]>();
    let metricIndex = 0;
    for (const line of rawLines) {
        while (
            metricIndex + 1 < metrics.length &&
            Math.abs(metrics[metricIndex + 1].baseline - line.baseline) <
                Math.abs(metrics[metricIndex].baseline - line.baseline)
        )
            metricIndex++;
        byLine.set(metricIndex, line);
    }
    const encodedText = new TextEncoder().encode(text);
    const clusterOffsets = [...new Set(rawLines.flatMap((line) => line.runs.flatMap((run) => Array.from(run.offsets))))]
        .filter((offset) => offset >= 0 && offset <= encodedText.length)
        .sort((a, b) => a - b);
    const clusterText = new Map<number, string>();
    const decoder = new TextDecoder();
    for (let index = 0; index < clusterOffsets.length; index++)
        clusterText.set(
            clusterOffsets[index],
            decoder
                .decode(encodedText.subarray(clusterOffsets[index], clusterOffsets[index + 1] ?? encodedText.length))
                .replace(/[\r\n\uFFFC]/g, ''),
        );
    const assignedClusters = new Set<number>();
    const explicitHeight = spans.some((span) => span.style.lineHeight !== null);
    let lines: ShapedLine[];
    try {
        lines = metrics.map((metric, index) => {
            const line = byLine.get(index);
            const runs: ShapedRun[] = [];
            for (const raw of line?.runs ?? []) {
                const rawAsset = raw.typeface ? fonts.match(raw.typeface) : undefined;
                if (raw.typeface && !rawAsset) throw new Error('The shaped font is not part of the document');
                let group:
                    | {
                          fontId: string;
                          glyphs: number[];
                          text: string[];
                          positions: number[];
                          offsets: number[];
                          size: number;
                          style: TextStyle;
                          fauxBold: boolean;
                          fauxItalic: boolean;
                          sourceStart: number;
                      }
                    | undefined;
                let range = ranges[0];
                for (let index = 0; index < raw.glyphs.length; index++) {
                    if (raw.glyphs[index] === 0) {
                        const missing = Array.from(
                            clusterText.get(raw.offsets[index]) ?? '',
                            (character) => `U+${character.codePointAt(0)!.toString(16).toUpperCase()}`,
                        ).join(', ');
                        throw new Error(
                            `The registered fonts cannot display ${missing || 'an unmapped glyph'} (${rawAsset?.id ?? 'unknown font'})`,
                        );
                    }
                    const offset = raw.offsets[index];
                    if (!range || offset < range.byteStart || offset >= range.byteEnd) {
                        let low = 0,
                            high = ranges.length;
                        while (low < high) {
                            const middle = (low + high) >>> 1;
                            if (ranges[middle].byteEnd <= offset) low = middle + 1;
                            else high = middle;
                        }
                        range = ranges[Math.min(low, ranges.length - 1)];
                    }
                    const style = range?.span.style ?? DEFAULT_TEXT_STYLE;
                    const asset = rawAsset ?? fonts.get(range?.choice.id ?? NATIVE_FONT_ID);
                    if (!group || group.fontId !== asset.id || group.sourceStart !== (range?.byteStart ?? 0)) {
                        if (group)
                            runs.push(
                                Object.freeze({
                                    ...group,
                                    glyphs: Object.freeze(group.glyphs),
                                    text: Object.freeze(group.text),
                                    positions: Object.freeze(group.positions),
                                    offsets: Object.freeze(group.offsets),
                                }),
                            );
                        group = {
                            sourceStart: range?.byteStart ?? 0,
                            fontId: asset.id,
                            glyphs: [],
                            text: [],
                            positions: [],
                            offsets: [],
                            size: raw.size,
                            style,
                            fauxBold: style.bold && !asset.id.includes('bold'),
                            fauxItalic: style.italic && !asset.id.includes('italic'),
                        };
                    }
                    group.glyphs.push(raw.glyphs[index]);
                    group.text.push(assignedClusters.has(offset) ? '' : (clusterText.get(offset) ?? ''));
                    assignedClusters.add(offset);
                    group.positions.push(point(raw.positions[index * 2]), point(raw.positions[index * 2 + 1]));
                    group.offsets.push(raw.offsets[index]);
                    if (
                        index === raw.glyphs.length - 1 ||
                        raw.offsets[index + 1] < (range?.byteStart ?? 0) ||
                        raw.offsets[index + 1] >= (range?.byteEnd ?? Infinity)
                    ) {
                        group.positions.push(
                            point(raw.positions[(index + 1) * 2]),
                            point(raw.positions[(index + 1) * 2 + 1]),
                        );
                        group.offsets.push(raw.offsets[index + 1]);
                        runs.push(
                            Object.freeze({
                                ...group,
                                glyphs: Object.freeze(group.glyphs),
                                text: Object.freeze(group.text),
                                positions: Object.freeze(group.positions),
                                offsets: Object.freeze(group.offsets),
                            }),
                        );
                        group = undefined;
                    }
                }
            }
            return Object.freeze({
                start: Math.min(text.length, index ? metrics[index - 1].endIncludingNewline : 0),
                end: Math.max(
                    Math.min(text.length, index ? metrics[index - 1].endIncludingNewline : 0),
                    Math.min(text.length, metric.endIndex - (text[metric.endIndex - 1] === '\n' ? 1 : 0)),
                ),
                endWithBreak: Math.min(text.length, metric.endIncludingNewline),
                left: point(metric.left),
                width: point(metric.width),
                top: point(explicitHeight || !line ? metric.baseline - metric.ascent : line.top),
                bottom: point(explicitHeight || !line ? metric.baseline - metric.ascent + metric.height : line.bottom),
                baseline: point(line?.baseline ?? metric.baseline),
                runs: Object.freeze(runs),
            });
        });
    } catch (error) {
        paragraph.delete();
        throw error;
    } finally {
        for (const face of new Set(rawLines.flatMap((line) => line.runs.map((run) => run.typeface)))) face?.delete();
    }
    const rectangles = paragraph.getRectsForPlaceholders();
    const placeholders = ranges
        .filter(({ span }) => span.placeholder)
        .map(({ span, from }, index) => {
            const rect = rectangles[index]?.rect;
            if (!rect) throw new Error('The inline object could not be positioned');
            return Object.freeze({
                span,
                from,
                left: point(rect[0]),
                top: point(rect[1]),
                width: point(rect[2] - rect[0]),
                height: point(rect[3] - rect[1]),
            });
        });
    const bounds = lines.map((line) => ({ top: line.top, bottom: line.bottom }));
    for (const placeholder of placeholders) {
        let low = 0,
            high = lines.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (lines[middle].start <= placeholder.from) low = middle + 1;
            else high = middle;
        }
        const box = bounds[Math.max(0, low - 1)];
        box.top = Math.min(box.top, placeholder.top);
        box.bottom = Math.max(box.bottom, placeholder.top + placeholder.height);
    }
    lines = lines.map((line, index) =>
        Object.freeze({ ...line, top: point(bounds[index].top), bottom: point(bounds[index].bottom) }),
    );
    const shaped = Object.freeze({
        width,
        direction,
        paragraph,
        text,
        lines: Object.freeze(lines),
        sources: Object.freeze(
            ranges.map(({ span, from, to }) => ({ nodeId: span.nodeId, editable: span.editable, from, to })),
        ),
        placeholders: Object.freeze(placeholders),
    });
    return shaped;
}
