import type { Surface } from 'canvaskit-wasm';
import { NativeTextKernel } from './kernel.js';
import type { ScenePage } from './layout.js';

export function paintPage(
    kernel: NativeTextKernel,
    surface: Surface,
    page: ScenePage,
    scale: number,
    transparent = false,
): void {
    const { ck } = kernel;
    const canvas = surface.getCanvas();
    canvas.clear(transparent ? ck.TRANSPARENT : ck.WHITE);
    canvas.save();
    canvas.scale(scale, scale);
    const paint = new ck.Paint();
    paint.setColor(ck.BLACK);
    paint.setAntiAlias(true);
    for (const command of page.commands) {
        if (command.kind === 'clipStart') {
            canvas.save();
            canvas.clipRect(
                ck.XYWHRect(command.x, command.y, command.width, command.height),
                ck.ClipOp.Intersect,
                false,
            );
            continue;
        }
        if (command.kind === 'clipEnd') {
            canvas.restore();
            continue;
        }
        if (command.kind === 'field' || command.kind === 'link') continue;
        if (command.kind === 'image') {
            const asset = kernel.images.get(command.assetId);
            paint.setColor(ck.WHITE);
            paint.setStyle(ck.PaintStyle.Fill);
            canvas.drawImageRect(
                asset.image,
                ck.XYWHRect(0, 0, asset.width, asset.height),
                ck.XYWHRect(command.x, command.y, command.width, command.height),
                paint,
            );
            continue;
        }
        paint.setStyle(ck.PaintStyle.Fill);
        const color = command.color ?? [0, 0, 0, 1];
        paint.setColor(ck.Color4f(color[0], color[1], color[2], color[3]));
        if (command.kind === 'rect') {
            canvas.drawRect(ck.XYWHRect(command.x, command.y, command.width, command.height), paint);
            continue;
        }
        if (command.kind === 'line') {
            paint.setStyle(ck.PaintStyle.Stroke);
            paint.setStrokeWidth(command.width);
            canvas.drawLine(command.x, command.y, command.toX, command.toY, paint);
            continue;
        }
        const font = new ck.Font(kernel.font(command.fontId).typeface, command.size);
        font.setHinting(ck.FontHinting.None);
        if (command.fauxItalic) font.setSkewX(-0.25);
        if (command.fauxBold) {
            for (let index = 0; index < command.glyphs.length; index++) {
                const glyphs = new Uint16Array([command.glyphs[index]]);
                const positions = new Float32Array(command.positions.slice(index * 2, index * 2 + 2));
                paint.setStyle(ck.PaintStyle.Fill);
                canvas.drawGlyphs(glyphs, positions, 0, 0, font, paint);
                paint.setStyle(ck.PaintStyle.Stroke);
                paint.setStrokeWidth(command.size / 35);
                canvas.drawGlyphs(glyphs, positions, 0, 0, font, paint);
            }
        } else
            canvas.drawGlyphs(new Uint16Array(command.glyphs), new Float32Array(command.positions), 0, 0, font, paint);
        font.delete();
    }
    paint.delete();
    canvas.restore();
    surface.flush();
}
