import { floatingFieldPlacement } from '../content/fields/geometry.js';
import { documentPresentation } from '../content/presentation/queries.js';
import { isRecord, type NativeDocument } from '../document/model.js';
import type { NativeTextKernel } from '../rendering/kernel.js';
import type { ShapedParagraph } from '../rendering/text/model.js';
import { point } from '../typography/metrics.js';
import { fieldPaintCommands } from './fields.js';
import type { PaintCommand } from './scene.js';

export function coverCommands(
    document: NativeDocument,
    kernel: NativeTextKernel,
    width: number,
    height: number,
    used: Set<ShapedParagraph>,
): PaintCommand[] {
    const commands: PaintCommand[] = [];
    const cover = documentPresentation(document).cover;
    if (cover.src) {
        const asset = kernel.images.source(cover.src);
        commands.push(
            { kind: 'clipStart', x: 0, y: 0, width, height },
            {
                kind: 'image',
                assetId: asset.id,
                x: 0,
                y: 0,
                width,
                height: point((asset.height * width) / asset.width),
            },
            { kind: 'clipEnd' },
        );
    }
    for (const key of ['floatingImages', 'blockVariables']) {
        const entries = document.root.attributes?.[key];
        for (const entry of Array.isArray(entries) ? entries : []) {
            if (!isRecord(entry) || entry.surface !== 'cover') continue;
            const { page: ignored, ...bounds } = floatingFieldPlacement(entry, { width, height }, height / 0.75 + 30);
            void ignored;
            commands.push(
                ...(typeof entry.src === 'string'
                    ? [
                          {
                              kind: 'image' as const,
                              nodeId: String(entry.id),
                              attributes: entry,
                              assetId: kernel.images.source(entry.src).id,
                              ...bounds,
                          },
                      ]
                    : fieldPaintCommands(
                          { kind: 'field', nodeId: String(entry.id), attributes: entry, ...bounds },
                          kernel,
                          used,
                      )),
            );
        }
    }
    return commands;
}
