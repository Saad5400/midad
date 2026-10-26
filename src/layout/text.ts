import type { NativeNode } from '../document/model.js';
import { point } from '../typography/metrics.js';
import { blockTextStyle, DEFAULT_TEXT_STYLE, inlineSpans, numericAttribute } from '../typography/style.js';
import { blank, shiftBand, type Band } from './bands.js';
import { scope, type LayoutContext as Context } from './context.js';
import { fieldPaintCommands } from './fields.js';
import type { GlyphCommand, PaintCommand } from './scene.js';
import { readingRun } from './text-reading.js';

export function glyphBands(
    node: NativeNode,
    width: number,
    ctx: Context,
    base = ctx.defaultStyle ?? DEFAULT_TEXT_STYLE,
    prefix = '',
): Band[] {
    const fragment = ctx.fragments?.get(node.id);
    if (fragment?.from) prefix = '';
    const style = blockTextStyle(node, base);
    let spans = [...inlineSpans(node, style)];
    if (prefix) spans.unshift({ nodeId: node.id, text: prefix, style, editable: false });
    spans = spans.map((span) => {
        if (span.placeholder?.kind !== 'image') return span;
        const source = span.placeholder.attributes?.src;
        if (typeof source !== 'string') throw new Error('An inline image has no source');
        const asset = ctx.kernel.images.source(source);
        const desired = Math.min(width, span.placeholder.width);
        return {
            ...span,
            placeholder: {
                ...span.placeholder,
                width: desired,
                height: span.placeholder.attributes?.height
                    ? (span.placeholder.height * desired) / span.placeholder.width
                    : (desired * asset.height) / asset.width,
            },
        };
    });
    const direction = scope(node, ctx).direction;
    const indent = Math.max(0, Math.min(width - 36, numericAttribute(node.attributes, 'indent', 0) * 18));
    const shaped = ctx.kernel.shapeRich(
        spans,
        width - indent,
        direction,
        typeof node.attributes?.textAlign === 'string' ? node.attributes.textAlign : undefined,
    );
    ctx.used.add(shaped);
    const explicitHeight = spans.some((span) => span.style.lineHeight !== null);
    const textNodeId = shaped.sources.find((source) => source.editable)?.nodeId ?? node.id;
    const bands = shaped.lines.map((line): Band => {
        const height = point(Math.max(explicitHeight ? 0 : style.size * 1.6, line.bottom - line.top));
        const commands: PaintCommand[] = [];
        const readingGroup = JSON.stringify(['paragraph', node.id, line.start + (fragment?.from ?? 0)]);
        for (const run of line.runs) {
            let x1 = Infinity,
                x2 = -Infinity;
            if (run.style.background || run.style.underline || run.style.strike || run.style.href)
                for (let index = 0; index < run.positions.length; index += 2) {
                    x1 = Math.min(x1, run.positions[index]);
                    x2 = Math.max(x2, run.positions[index]);
                }
            if (run.style.background)
                commands.push({
                    kind: 'rect',
                    x: x1,
                    y: 0,
                    width: point(x2 - x1),
                    height,
                    color: run.style.background,
                });
            const positions = new Array<number>(run.glyphs.length * 2);
            for (let index = 0; index < positions.length; index++)
                positions[index] = point(run.positions[index] - (index % 2 ? line.top : 0));
            const glyph: GlyphCommand = {
                kind: 'glyphs',
                fontId: run.fontId,
                size: run.size,
                glyphs: run.glyphs,
                text: run.text,
                positions,
                color: run.style.color,
                fauxBold: run.fauxBold,
                fauxItalic: run.fauxItalic,
                reading: readingRun(readingGroup, run, 0, height).map((part) =>
                    fragment ? { ...part, order: [part.order[0] + fragment.byteFrom, ...part.order.slice(1)] } : part,
                ),
            };
            commands.push(glyph);
            for (const offset of [
                ...(run.style.underline ? [run.size * 0.12] : []),
                ...(run.style.strike ? [-run.size * 0.3] : []),
            ]) {
                const baseline = point(line.baseline - line.top + offset);
                commands.push({
                    kind: 'line',
                    x: x1,
                    y: baseline,
                    toX: x2,
                    toY: baseline,
                    width: point(Math.max(0.4, run.size / 20)),
                    color: run.style.color,
                });
            }
            if (run.style.href)
                commands.push({ kind: 'link', href: run.style.href, x: x1, y: 0, width: point(x2 - x1), height });
        }
        for (const placeholder of shaped.placeholders) {
            if (placeholder.from < line.start || placeholder.from >= line.endWithBreak) continue;
            const box = {
                x: placeholder.left,
                y: point(placeholder.top - line.top),
                width: placeholder.width,
                height: placeholder.height,
            };
            const attrs = placeholder.span.placeholder!.attributes ?? {};
            if (placeholder.span.placeholder!.kind === 'image') {
                commands.push({
                    kind: 'image',
                    nodeId: placeholder.span.nodeId,
                    attributes: attrs,
                    assetId: ctx.kernel.images.source(String(attrs.src)).id,
                    ...box,
                });
            } else {
                const fieldCommands = fieldPaintCommands(
                    { kind: 'field', nodeId: placeholder.span.nodeId, attributes: attrs, ...box },
                    ctx.kernel,
                    ctx.used,
                );
                const offset = new TextEncoder().encode(shaped.text.slice(0, placeholder.from)).length;
                commands.push(
                    ...fieldCommands.map((command) =>
                        'glyphs' in command && command.reading
                            ? {
                                  ...command,
                                  reading: command.reading.map((part) => ({
                                      ...part,
                                      group: readingGroup,
                                      order: [offset + (fragment?.byteFrom ?? 0), ...part.order],
                                  })),
                              }
                            : command,
                    ),
                );
            }
        }
        return {
            height,
            commands,
            lines: [
                {
                    ...(fragment
                        ? {
                              fragmentFrom: fragment.from,
                              fragmentByteFrom: fragment.byteFrom,
                              sourceNodeOffsets: fragment.nodeOffsets,
                          }
                        : {}),
                    paragraphId: node.id,
                    textNodeId,
                    left: 0,
                    top: 0,
                    height,
                    originalTop: line.top,
                    shaped,
                },
            ],
        };
    });
    if (indent && direction === 'ltr')
        bands.forEach((band, index) => {
            bands[index] = shiftBand(band, indent);
        });
    const heading = node.kind === 'heading' || node.kind === 'clauseTitle';
    if (heading) for (const band of bands) band.keepNext = true;
    bands.push({ ...blank(node.kind === 'heading' ? 10 : 6), ...(heading ? { keepNext: true } : {}) });
    return bands;
}
