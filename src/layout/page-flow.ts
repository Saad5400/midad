import type { NativeDocument } from '../document/model.js';
import { point } from '../typography/metrics.js';
import { isSpacing, requiredHeight, shiftBand, type Band } from './bands.js';
import type { LayoutContext } from './context.js';
import { FlowContinuation } from './continuation.js';
import { measureBlocks } from './measurement.js';
import type { PageGeometry } from './page-geometry.js';
import type { PaintCommand, SceneCell, SceneColumn, SceneLine, SceneTableRow } from './scene.js';

export interface FlowPage {
    width: number;
    height: number;
    commands: PaintCommand[];
    lines: SceneLine[];
    cells: SceneCell[];
    tableRows: SceneTableRow[];
    columns: SceneColumn[];
    blocks: SceneColumn[];
}
interface OwnedBand {
    band: Band;
    owner: string;
}
function finishBand(band: Band, owner: string): Band {
    const finished = (part: Band): Band => ({ ...part, completedNodes: [...(part.completedNodes ?? []), owner] });
    return band.split
        ? {
              ...band,
              split: (room) => {
                  const parts = band.split!(room);
                  if (!parts) return;
                  return {
                      head: parts.rest ? parts.head : finished(parts.head),
                      ...(parts.rest ? { rest: finishBand(parts.rest, owner) } : {}),
                  };
              },
          }
        : finished(band);
}

export function flowPages(
    document: NativeDocument,
    context: LayoutContext,
    first: { page: FlowPage; geometry: PageGeometry },
    createPage: () => { page: FlowPage; geometry: PageGeometry },
): void {
    const cursor = new FlowContinuation(document);
    const ctx = {
        ...context,
        tableColumns: cursor.tableColumns,
        fragments: cursor.fragments,
        completed: cursor.completed,
        listStarts: cursor.listStarts,
        listNumbers: cursor.listNumbers,
    };
    let current = first,
        y = current.geometry.top;
    const roots = document.root.children ?? [];
    const positions = new Map(roots.map((node, index) => [node.id, index]));
    let queue: OwnedBand[] = [],
        bands: Band[] = [],
        sourceIndex = 0,
        index = 0,
        continued = false,
        pages = 1;
    const append = (): boolean => {
        ctx.availableHeight = current.geometry.availableHeight;
        while (sourceIndex < roots.length) {
            const source = roots[sourceIndex++];
            const remaining = cursor.remaining(source);
            if (!remaining) continue;
            const measured = measureBlocks([remaining], current.geometry.area, ctx);
            if (!measured.length) {
                cursor.completed.add(source.id);
                continue;
            }
            measured.forEach((band, at) => {
                const entry = at === measured.length - 1 ? finishBand(band, source.id) : band;
                queue.push({ owner: source.id, band: entry });
                bands.push(entry);
            });
            return true;
        }
        return false;
    };
    const next = (): void => {
        if (++pages > 10000) throw new Error('The document exceeds the page limit');
        const previous = current.geometry;
        current = createPage();
        y = current.geometry.top;
        const geometry = current.geometry;
        if (previous.area !== geometry.area || previous.availableHeight !== geometry.availableHeight) {
            sourceIndex = positions.get(queue[index]?.owner) ?? sourceIndex;
            queue = [];
            bands = [];
            index = 0;
            continued = false;
        }
    };
    while (index < queue.length || sourceIndex < roots.length) {
        if (index >= queue.length) {
            queue = [];
            bands = [];
            index = 0;
            continued = false;
            if (!append()) break;
        }
        while (queue.at(-1)?.band.keepNext && append()) {}
        const entry = queue[index],
            band = entry.band,
            geometry = current.geometry;
        if (isSpacing(band)) {
            y = point(Math.min(geometry.height - geometry.bottom, y + band.height));
            cursor.accept(band);
            index++;
            continued = false;
            continue;
        }
        const required = continued
            ? (band.minimumHeight ?? band.height)
            : requiredHeight(bands, index, geometry.availableHeight);
        if (y + required > geometry.height - geometry.bottom && y > geometry.top) {
            next();
            continue;
        }
        const room = point(geometry.height - geometry.bottom - y);
        const parts = band.split?.(room);
        if ((band.split && !parts) || (!band.split && band.height > room)) {
            if (y === geometry.top) throw new Error('A document block exceeds the writable page height');
            next();
            continue;
        }
        const head = parts?.head ?? band;
        const shifted = shiftBand(head, geometry.left, y);
        current.page.commands.push(...shifted.commands);
        current.page.lines.push(...shifted.lines);
        current.page.cells.push(...(shifted.cells ?? []));
        current.page.tableRows.push(
            ...(shifted.tableRows ?? []).map((row) => ({ ...row, rowIndex: cursor.rowIndex(row.rowId, row.rowIndex) })),
        );
        current.page.columns.push(...(shifted.columns ?? []));
        if (head.height > 0)
            current.page.blocks.push({
                id: entry.owner,
                x: geometry.left,
                y,
                width: geometry.area,
                height: head.height,
            });
        cursor.accept(head);
        y = point(y + head.height);
        if (parts?.rest) {
            queue[index] = { ...entry, band: parts.rest };
            bands[index] = parts.rest;
            continued = true;
        } else {
            index++;
            continued = false;
        }
    }
}
