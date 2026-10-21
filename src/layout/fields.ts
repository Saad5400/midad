import { fieldDisplayValue, fieldSettings, fieldStyle, IMAGE_FIELD_TYPES } from '../content/fields/commands.js';
import type { Attributes } from '../document/model.js';
import { NativeTextKernel, point, type ShapedParagraph } from '../rendering/kernel.js';
import { DEFAULT_TEXT_STYLE, type TextStyle } from '../typography/style.js';
import type { FieldCommand, PaintCommand } from './scene.js';
import { readingRun } from './text-reading.js';

export function fieldPaintCommands(
    field: FieldCommand,
    kernel: NativeTextKernel,
    used: Set<ShapedParagraph>,
): PaintCommand[] {
    const attrs = field.attributes,
        settings = fieldSettings(attrs),
        commands: PaintCommand[] = [field];
    if (typeof attrs.value !== 'string' || !attrs.value) return commands;
    const box = { x: field.x, y: field.y, width: field.width, height: field.height };
    commands.push({ kind: 'clipStart', ...box });
    if (IMAGE_FIELD_TYPES.has(String(attrs.type))) {
        const asset = kernel.images.source(attrs.value),
            reference = typeof attrs.reference_id === 'string' ? attrs.reference_id : '';
        const contentHeight = Math.max(1, box.height - (reference ? 9 : 0));
        const scale = Math.min(box.width / asset.width, contentHeight / asset.height);
        commands.push({
            kind: 'image',
            assetId: asset.id,
            x: point(box.x + (box.width - asset.width * scale) / 2),
            y: point(box.y + (contentHeight - asset.height * scale) / 2),
            width: point(asset.width * scale),
            height: point(asset.height * scale),
        });
        if (reference)
            commands.push(
                ...textCommands(
                    reference,
                    { ...box, y: box.y + contentHeight, height: box.height - contentHeight },
                    { ...DEFAULT_TEXT_STYLE, size: 6 },
                    {},
                    kernel,
                    used,
                    field.nodeId,
                ),
            );
    } else
        commands.push(
            ...textCommands(
                fieldDisplayValue(attrs),
                { x: box.x + 4.5, y: box.y, width: Math.max(1, box.width - 9), height: box.height },
                fieldStyle(attrs),
                settings,
                kernel,
                used,
                field.nodeId,
            ),
        );
    commands.push({ kind: 'clipEnd' });
    return commands;
}

function textCommands(
    text: string,
    box: { x: number; y: number; width: number; height: number },
    style: TextStyle,
    settings: Attributes,
    kernel: NativeTextKernel,
    used: Set<ShapedParagraph>,
    id: string,
): PaintCommand[] {
    const direction = settings.direction === 'ltr' ? 'ltr' : 'rtl';
    const align =
        settings.textAlign === 'start'
            ? direction === 'rtl'
                ? 'right'
                : 'left'
            : settings.textAlign === 'end'
              ? direction === 'rtl'
                  ? 'left'
                  : 'right'
              : String(settings.textAlign ?? 'center');
    const multiline = settings.multiline === true;
    const value = kernel.shapeRich(
        [{ nodeId: '', text: multiline ? text : text.replace(/[\r\n]+/g, ' '), style, editable: false }],
        multiline ? box.width : Math.max(box.width, 100000),
        direction,
        multiline ? align : 'left',
    );
    used.add(value);
    const rows = multiline ? value.lines : value.lines.slice(0, 1);
    const height = rows.at(-1)!.bottom - rows[0].top,
        top = box.y + Math.max(0, (box.height - height) / 2);
    const commands: PaintCommand[] = [];
    for (const row of rows) {
        const offsetX = multiline
            ? 0
            : align === 'right'
              ? box.width - row.width
              : align === 'center'
                ? (box.width - row.width) / 2
                : 0;
        if (style.background)
            commands.push({
                kind: 'rect',
                x: point(box.x + offsetX),
                y: point(top + row.top - rows[0].top),
                width: row.width,
                height: point(row.bottom - row.top),
                color: style.background,
            });
        for (const run of row.runs) {
            const positions = run.positions
                .slice(0, run.glyphs.length * 2)
                .map((value, index) => point(value + (index % 2 ? top - rows[0].top : box.x + offsetX - row.left)));
            commands.push({
                kind: 'glyphs',
                fontId: run.fontId,
                size: run.size,
                glyphs: run.glyphs,
                text: run.text,
                positions,
                color: run.style.color,
                fauxBold: run.fauxBold,
                fauxItalic: run.fauxItalic,
                reading: readingRun(
                    JSON.stringify(['field', id, row.start]),
                    run,
                    top + row.top - rows[0].top,
                    row.bottom - row.top,
                    box.x + offsetX - row.left,
                ),
            });
        }
        if (style.underline) {
            const start = box.x + offsetX;
            commands.push({
                kind: 'line',
                x: point(start),
                y: point(top + row.baseline - rows[0].top + style.size * 0.1),
                toX: point(start + row.width),
                toY: point(top + row.baseline - rows[0].top + style.size * 0.1),
                width: Math.max(0.5, style.size / 16),
                color: style.color,
            });
        }
        if (style.strike)
            commands.push({
                kind: 'line',
                x: point(box.x + offsetX),
                y: point(top + row.baseline - rows[0].top - style.size * 0.3),
                toX: point(box.x + offsetX + row.width),
                toY: point(top + row.baseline - rows[0].top - style.size * 0.3),
                width: Math.max(0.5, style.size / 16),
                color: style.color,
            });
    }
    return commands;
}
