import type { CanvasKit } from 'canvaskit-wasm';
import { selectionRanges, type NativeSelection } from '../../editing/selection.js';
import { tableRectangle } from '../../editing/table-grid.js';
import type { CaretAffinity, NativeNavigation } from '../input/navigation.js';
import { caretViewportRect } from './caret-geometry.js';
import type { OverlayCaret, OverlayPoint, OverlayRect } from './editing-overlay.js';
import { selectionViewportRectangles } from './selection-geometry.js';

export interface SelectionOverlayGeometry {
    readonly caret: OverlayCaret | null;
    readonly rectangles: OverlayRect[];
    readonly handles: Array<OverlayCaret & { readonly endpoint: 'start' | 'end' }>;
}

export function selectionOverlayGeometry(
    navigation: NativeNavigation | undefined,
    selected: NativeSelection,
    options: {
        canvasKit: CanvasKit;
        scale: number;
        pageOrigin: (pageIndex: number) => OverlayPoint | undefined;
        pages?: ReadonlySet<number>;
        affinity?: CaretAffinity;
        touch?: boolean;
        hideCaret?: boolean;
    },
): SelectionOverlayGeometry {
    const geometry: SelectionOverlayGeometry = { caret: null, rectangles: [], handles: [] };
    if (!navigation || !Number.isFinite(options.scale) || options.scale <= 0) return geometry;
    const { document, scene } = navigation;
    if (selected.cells) {
        const cells = tableRectangle(document, selected.cells);
        const ids = new Set(cells?.cells.map((cell) => cell.node.id));
        scene.pages.forEach((page, index) => {
            if (options.pages && !options.pages.has(index)) return;
            const origin = options.pageOrigin(index);
            if (!origin) return;
            for (const cell of page.cells ?? []) {
                if (!ids.has(cell.cellId)) continue;
                geometry.rectangles.push({
                    left: origin.left + cell.x * options.scale,
                    top: origin.top + cell.y * options.scale,
                    width: cell.width * options.scale,
                    height: cell.height * options.scale,
                });
            }
        });
        return geometry;
    }
    const ranges = selectionRanges(document, selected);
    const selectedRanges = new Map(
        ranges.filter((range) => range.from !== range.to || ranges.length > 1).map((range) => [range.blockId, range]),
    );
    geometry.rectangles.push(...selectionViewportRectangles(document, scene, selected, options));
    scene.pages.forEach((page, index) => {
        if (!selectedRanges.size || (options.pages && !options.pages.has(index))) return;
        const origin = options.pageOrigin(index);
        if (!origin) return;
        for (const line of page.lines) {
            const range = selectedRanges.get(line.paragraphId);
            const row = line.shaped.lines.find((row) => row.top === line.originalTop);
            if (!range || !row) continue;
            const first = line.shaped.sources[0];
            const prefix =
                (first?.nodeId === range.blockId && !first.editable ? first.to : 0) - (line.fragmentFrom ?? 0);
            const lineBreak =
                line.shaped.text.slice(row.end, row.endWithBreak).includes('\n') &&
                range.from + prefix <= row.end &&
                range.to + prefix > row.end;
            const paragraphBreak =
                range !== ranges.at(-1) &&
                row === line.shaped.lines.at(-1) &&
                range.to + prefix === line.shaped.text.length;
            if (!lineBreak && !paragraphBreak) continue;
            const endpoint = navigation.caret(
                { blockId: range.blockId, offset: Math.max(0, row.end - prefix) },
                'upstream',
            );
            if (!endpoint) continue;
            geometry.rectangles.push({
                left:
                    origin.left +
                    ((line.left ?? 0) + endpoint.x - (line.shaped.direction === 'rtl' ? 4 : 0)) * options.scale,
                top: origin.top + (line.top + row.top - line.originalTop) * options.scale,
                width: 4 * options.scale,
                height: Math.max(2, (row.bottom - row.top) * options.scale),
            });
        }
    });
    const expanded = selectedRanges.size > 0 || options.hideCaret;
    if (!expanded) {
        return {
            ...geometry,
            caret: caretViewportRect(navigation, selected.focus, options.pageOrigin, options.scale, options.affinity),
        };
    }
    if (options.touch && ranges.length) {
        const first = ranges[0],
            last = ranges.at(-1)!;
        for (const [endpoint, target] of [
            ['start', { blockId: first.blockId, offset: first.from }],
            ['end', { blockId: last.blockId, offset: last.to }],
        ] as const) {
            const caret = caretViewportRect(
                navigation,
                target,
                options.pageOrigin,
                options.scale,
                endpoint === 'end' ? 'upstream' : 'downstream',
            );
            if (caret) geometry.handles.push({ ...caret, endpoint });
        }
    }
    return geometry;
}
