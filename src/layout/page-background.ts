import type { PageBackground } from '../content/page-layout-queries.js';
import type { NativeTextKernel } from '../rendering/kernel.js';
import { point } from '../typography/metrics.js';
import { color } from '../typography/style.js';
import type { PaintCommand } from './scene.js';

export function pageBackgroundCommands(
    background: PageBackground | null | undefined,
    width: number,
    height: number,
    kernel: NativeTextKernel,
): readonly PaintCommand[] | undefined {
    if (!background) return undefined;
    const commands: PaintCommand[] = [];
    if (background.color) commands.push({ kind: 'rect', x: 0, y: 0, width, height, color: color(background.color) });
    if (background.src) {
        const image = kernel.images.source(background.src);
        const ratio =
            background.fit === 'contain'
                ? Math.min(width / image.width, height / image.height)
                : Math.max(width / image.width, height / image.height);
        const imageWidth = background.fit === 'stretch' ? width : point(image.width * ratio);
        const imageHeight = background.fit === 'stretch' ? height : point(image.height * ratio);
        commands.push(
            { kind: 'clipStart', x: 0, y: 0, width, height },
            {
                kind: 'image',
                assetId: image.id,
                x: point((width - imageWidth) / 2),
                y: point((height - imageHeight) / 2),
                width: imageWidth,
                height: imageHeight,
            },
            { kind: 'clipEnd' },
        );
    }
    return commands.length ? Object.freeze(commands.map((command) => Object.freeze(command))) : undefined;
}
