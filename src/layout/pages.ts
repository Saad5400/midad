import { clauseNumbers } from '../content/clauses/numbering.js';
import { floatingFieldPlacement } from '../content/fields/geometry.js';
import { floatingAnchorIndex, resolveFloatingAnchor } from '../content/floating-anchors.js';
import { documentPageLayout, pageSize } from '../content/page-layout.js';
import { documentPresentation, headerTile } from '../content/presentation/queries.js';
import { isRecord, type NativeDocument } from '../document/model.js';
import type { NativeTextKernel } from '../rendering/kernel.js';
import { point } from '../typography/metrics.js';
import { isSpacing, shiftBand, type Band, type BandParts } from './bands.js';
import type { LayoutContext as Context } from './context.js';
import { coverCommands } from './cover.js';
import { fieldPaintCommands } from './fields.js';
import { finalizePages } from './finalize.js';
import { measureBlocks, pruneMeasurements } from './measurement.js';
import type { DocumentScene, PaintCommand, SceneCell, SceneColumn, SceneLine, SceneTableRow } from './scene.js';
import { readingRun } from './text-reading.js';

export function createDocumentScene(
    document: NativeDocument,
    kernel: NativeTextKernel,
    surfaceWidth?: number,
): DocumentScene {
    const presentation = documentPresentation(document);
    const coverPages = presentation.cover.enabled ? 1 : 0;
    const layout = documentPageLayout(document);
    const landscape = layout.orientation === 'landscape';
    const size = pageSize(layout.orientation);
    const width = point(surfaceWidth ?? size.width),
        height = point(size.height);
    if (!Number.isFinite(width) || width < 100 || width > 2000) throw new Error('Invalid layout surface width');
    const margin = (key: keyof typeof layout.margins) => {
        const value = layout.margins[key];
        if (!Number.isFinite(value) || value < 0) throw new Error('Invalid page margins');
        return value * 0.75;
    };
    const left = margin('left'),
        right = margin('right'),
        top = margin('top'),
        bottom = margin('bottom');
    const area = width - left - right;
    if (area < 36 || height - top - bottom < 36) throw new Error('Page margins leave no writable area');
    const ctx: Context = {
        kernel,
        fontHash: kernel.fontHashFor(document),
        used: new Set(),
        numbers: clauseNumbers(document),
        measured: new Set(),
        direction: document.root.attributes?.dir === 'ltr' ? 'ltr' : 'rtl',
        availableHeight: point(height - top - bottom),
    };
    const pages: Array<{
        width: number;
        height: number;
        commands: PaintCommand[];
        lines: SceneLine[];
        cells: SceneCell[];
        tableRows: SceneTableRow[];
        columns: SceneColumn[];
        blocks: SceneColumn[];
    }> = [];
    const newPage = () => {
        const page = {
            width,
            height,
            commands: [] as PaintCommand[],
            lines: [] as SceneLine[],
            cells: [] as SceneCell[],
            tableRows: [] as SceneTableRow[],
            columns: [] as SceneColumn[],
            blocks: [] as SceneColumn[],
        };
        pages.push(page);
        if (presentation.header.enabled && presentation.header.src) {
            const asset = kernel.images.source(presentation.header.src);
            const size = headerTile(asset.width, asset.height, width, height);
            page.commands.push({
                kind: 'image',
                assetId: asset.id,
                x: 0,
                y: 0,
                width: point(size.width),
                height: point(size.height),
            });
        }
        return page;
    };
    let page = newPage();
    let y = top;
    const owners = new Map<Band, string>();
    const content = (document.root.children ?? []).flatMap((node) => {
        const bands = measureBlocks([node], area, ctx);
        for (const band of bands) owners.set(band, node.id);
        return bands;
    });
    pruneMeasurements(kernel, ctx.measured);
    const requiredSpace = new Array<number>(content.length);
    for (let start = 0; start < content.length; ) {
        let end = start,
            total = content[start].minimumHeight ?? content[start].height;
        while (content[end].keepNext && end + 1 < content.length) {
            const next = content[++end];
            total += next.minimumHeight ?? next.height;
        }
        let remaining = total;
        for (let index = start; index <= end; index++) {
            const minimum = content[index].minimumHeight ?? content[index].height;
            requiredSpace[index] = total > height - top - bottom ? minimum : remaining;
            remaining -= minimum;
        }
        start = end + 1;
    }
    content.forEach((original, index) => {
        if (isSpacing(original)) {
            y = point(Math.min(height - bottom, y + original.height));
            return;
        }
        let pending: Band | undefined = original;
        while (pending) {
            const required = pending === original ? requiredSpace[index] : (pending.minimumHeight ?? pending.height);
            if (y + required > height - bottom && y > top) {
                page = newPage();
                y = top;
            }
            const room = point(height - bottom - y);
            const parts: BandParts | undefined = pending.split?.(room);
            if ((pending.split && !parts) || (!pending.split && pending.height > room)) {
                if (y === top) throw new Error('A document block exceeds the writable page height');
                page = newPage();
                y = top;
                continue;
            }
            const band = parts?.head ?? pending;
            const shifted = shiftBand(band, left, y);
            page.commands.push(...shifted.commands);
            page.lines.push(...shifted.lines);
            page.cells.push(...(shifted.cells ?? []));
            page.tableRows.push(...(shifted.tableRows ?? []));
            page.columns.push(...(shifted.columns ?? []));
            if (band.height > 0)
                page.blocks.push({ id: owners.get(original)!, x: left, y, width: area, height: band.height });
            y = point(y + band.height);
            pending = parts?.rest;
        }
    });
    const floating = document.root.attributes?.floatingImages;
    const variables = document.root.attributes?.blockVariables;
    let anchors: ReturnType<typeof floatingAnchorIndex> | undefined;
    for (const entry of [
        ...(Array.isArray(floating) ? floating : []),
        ...(Array.isArray(variables) ? variables : []),
    ]) {
        if (!isRecord(entry) || entry.surface === 'cover') continue;
        const stride = (landscape ? 794 : 1123) + 30;
        const { page: index, ...position } = resolveFloatingAnchor(
            entry,
            floatingFieldPlacement(entry, { width, height }, stride),
            (anchors ??= floatingAnchorIndex(document, { pages })),
        );
        if (index > 10000) throw new Error('The floating object page is out of range');
        while (pages.length <= index) newPage();
        const bounds = {
            x: point(position.x),
            y: point(position.y),
            width: point(position.width),
            height: point(position.height),
        };
        pages[index].commands.push(
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
                      ctx.used,
                  )),
        );
    }
    pages.forEach((entry, index) => {
        const footer = kernel.shape(String(index + 1), area, 8, 'ltr');
        ctx.used.add(footer);
        for (const line of footer.lines)
            for (const run of line.runs)
                entry.commands.push({
                    kind: 'glyphs',
                    fontId: run.fontId,
                    size: run.size,
                    glyphs: run.glyphs,
                    text: run.text,
                    positions: run.positions
                        .slice(0, run.glyphs.length * 2)
                        .map((value, coordinate) =>
                            point(value + (coordinate % 2 ? height - Math.min(bottom / 2, 27) - line.baseline : left)),
                        ),
                    color: run.style.color,
                    reading: readingRun(
                        JSON.stringify(['footer', index]),
                        run,
                        line.top + height - Math.min(bottom / 2, 27) - line.baseline,
                        line.bottom - line.top,
                        left,
                    ),
                });
    });
    if (coverPages) {
        const commands = coverCommands(document, kernel, width, height, ctx.used);
        pages.unshift({ width, height, commands, lines: [], cells: [], tableRows: [], columns: [], blocks: [] });
    }
    kernel.clearUnused(ctx.used);
    const immutable = finalizePages(pages);
    const glyphCount = immutable.reduce(
        (sum, entry) =>
            sum +
            entry.commands.reduce(
                (count, command) => count + (!command.kind || command.kind === 'glyphs' ? command.glyphs.length : 0),
                0,
            ),
        0,
    );
    return Object.freeze({
        documentId: document.id,
        revision: document.revision,
        fontHash: ctx.fontHash,
        margin: left,
        glyphCount,
        coverPages,
        pages: Object.freeze(immutable),
    });
}
