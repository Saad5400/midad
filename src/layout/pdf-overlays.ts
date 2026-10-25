import { floatingFieldPlacement } from '../content/fields/geometry.js';
import { fieldSettings } from '../content/fields/queries.js';
import { pageSize } from '../content/page-layout-queries.js';
import { documentPresentation } from '../content/presentation/queries.js';
import { isRecord, type Attributes, type NativeDocument } from '../document/model.js';
import type { NativeTextKernel } from '../rendering/kernel.js';
import type { ShapedParagraph } from '../rendering/text/model.js';
import { coverCommands } from './cover.js';
import { fieldPaintCommands } from './fields.js';
import { finalizePages } from './finalize.js';
import type { DocumentScene, PaintCommand } from './scene.js';

export interface PdfPageGeometry {
    readonly width: number;
    readonly height: number;
}
export function layoutPdfOverlays(
    document: NativeDocument,
    kernel: NativeTextKernel,
    boxes: readonly PdfPageGeometry[],
    legacyGap = 22.5,
): DocumentScene {
    if (
        !boxes.length ||
        boxes.some((box) => ![box.width, box.height].every((value) => Number.isFinite(value) && value > 0)) ||
        !Number.isFinite(legacyGap) ||
        legacyGap < 0
    )
        throw new Error('Invalid PDF page geometry');
    const pages = boxes.map((box) => ({ ...box, lines: [], commands: [] as PaintCommand[] }));
    const presentation = documentPresentation(document);
    if (presentation.header.enabled && presentation.header.src) {
        const asset = kernel.images.source(presentation.header.src);
        for (const page of pages)
            page.commands.push({
                kind: 'image',
                assetId: asset.id,
                x: 0,
                y: 0,
                width: page.width,
                height: (asset.height * page.width) / asset.width,
            });
    }
    const tops: number[] = [];
    let top = 0;
    for (const box of boxes) {
        tops.push(top);
        top += box.height + legacyGap;
    }
    const used = new Set<ShapedParagraph>();
    for (const key of ['blockVariables', 'floatingImages']) {
        const entries = document.root.attributes?.[key];
        if (!Array.isArray(entries)) continue;
        for (const attrs of entries) {
            if (!isRecord(attrs) || typeof attrs.id !== 'string') throw new Error('Invalid PDF overlay identity');
            if (attrs.surface === 'cover') continue;
            const settings = fieldSettings(attrs);
            const normalized =
                ['relativeXPct', 'relativeYPct', 'widthPct', 'heightPct'].every(
                    (key) => typeof settings[key] === 'number' && Number.isFinite(settings[key]),
                ) &&
                Number.isInteger(settings.page) &&
                Number(settings.page) > 0;
            const rawY = typeof attrs.y === 'number' ? attrs.y * 0.75 : 0;
            const index = normalized
                ? Number(settings.page) - 1
                : Math.max(
                      0,
                      tops.findLastIndex((value) => value <= rawY),
                  );
            const page = pages[index];
            if (!page) throw new Error('The PDF overlay page is unavailable');
            const position = normalized
                ? floatingFieldPlacement(attrs, page, top / 0.75)
                : {
                      page: index,
                      x: Number(attrs.x ?? 0) * 0.75,
                      y: rawY - tops[index],
                      width: Number(attrs.width ?? 200) * 0.75,
                      height: Number(attrs.height ?? 24) * 0.75,
                  };
            if (
                ![position.x, position.y, position.width, position.height].every(Number.isFinite) ||
                position.width <= 0 ||
                position.height <= 0
            )
                throw new Error('Invalid PDF overlay bounds');
            const { x, y, width, height } = position;
            page.commands.push({ kind: 'clipStart', x: 0, y: 0, width: page.width, height: page.height });
            if (key === 'floatingImages') {
                if (typeof attrs.src !== 'string' || !attrs.src) throw new Error('Invalid PDF overlay image');
                page.commands.push({
                    kind: 'image',
                    nodeId: attrs.id,
                    attributes: attrs as Attributes,
                    assetId: kernel.images.source(attrs.src).id,
                    x,
                    y,
                    width,
                    height,
                });
            } else
                page.commands.push(
                    ...fieldPaintCommands(
                        { kind: 'field', nodeId: attrs.id, attributes: attrs as Attributes, x, y, width, height },
                        kernel,
                        used,
                    ),
                );
            page.commands.push({ kind: 'clipEnd' });
        }
    }
    if (presentation.cover.enabled) {
        const { width, height } = pageSize('portrait');
        pages.unshift({ width, height, lines: [], commands: coverCommands(document, kernel, width, height, used) });
    }
    kernel.clearUnused(used);
    const frozen = finalizePages(pages);
    return Object.freeze({
        documentId: document.id,
        revision: document.revision,
        fontHash: kernel.fontHashFor(document),
        margin: 0,
        ...(presentation.cover.enabled ? { coverPages: 1 } : {}),
        glyphCount: frozen.reduce(
            (total, page) =>
                total +
                page.commands.reduce(
                    (sum, command) => sum + (!command.kind || command.kind === 'glyphs' ? command.glyphs.length : 0),
                    0,
                ),
            0,
        ),
        pages: Object.freeze(frozen),
    });
}
