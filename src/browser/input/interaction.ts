import type { Affinity } from 'canvaskit-wasm';
import { findNode, type NativeDocument } from '../../document/model.js';
import {
    selectNodeText,
    selectionRanges,
    selectionRegion,
    wordRange,
    type NativeSelection,
} from '../../editing/selection.js';
import { tableRectangle, type TableCellSelection } from '../../editing/table-grid.js';
import { blockText, isTextBlock, type TextCaret } from '../../editing/text.js';
import { cellAt, hitTest, type DocumentScene } from '../../layout/scene.js';
import type { CaretAffinity, NativeNavigation, NavigationCaret } from './navigation.js';
import { emptyWritingPosition, type EmptyWritingPosition } from './writing-position.js';

export interface NavigationKey {
    readonly key: string;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly altKey: boolean;
    readonly shiftKey: boolean;
    readonly isComposing?: boolean;
}
export interface NavigationResult {
    readonly selection?: NativeSelection;
    readonly pageDirection?: -1 | 1;
}

export function keyboardShortcut(event: { readonly key: string; readonly code?: string }): string {
    return event.code?.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
}

export function initialTextCaret(
    document: NativeDocument,
    scene: DocumentScene,
    preferredPage = 0,
): TextCaret | undefined {
    for (const page of [scene.pages[preferredPage], ...scene.pages])
        for (const line of page?.lines ?? []) {
            const block = findNode(document, line.paragraphId);
            if (!block || !isTextBlock(block)) continue;
            const first = line.shaped?.sources[0];
            const prefix = (first?.nodeId === block.id && !first.editable ? first.to : 0) - (line.fragmentFrom ?? 0);
            const shapedLine = line.shaped?.lines.find((row) => row.top === line.originalTop);
            return { blockId: block.id, offset: Math.max(0, (shapedLine?.start ?? 0) - prefix) };
        }
}

export interface PointSelectionRequest {
    page: number;
    x: number;
    y: number;
    extend?: boolean;
    clicks?: number;
    shift?: boolean;
    pointerType?: string;
    held?: boolean;
}
export interface PointSelectionOptions {
    selection: NativeSelection | null;
    selectingCells?: boolean;
    allowEmpty?: boolean;
    navigation?: NativeNavigation;
    upstreamAffinity: Affinity;
}
export type PointSelectionResult =
    | { kind: 'none'; selectingCells: boolean }
    | { kind: 'empty'; position: EmptyWritingPosition; selectingCells: false }
    | { kind: 'cells'; selection: NativeSelection; selectingCells: true }
    | {
          kind: 'text';
          selection: NativeSelection;
          hit: NonNullable<ReturnType<typeof hitTest>>;
          clicks: number;
          selectingCells: false;
      };
export interface SelectionPageBounds {
    left: number;
    top: number;
    bottom: number;
}
export interface SelectionPointer {
    pointerId: number;
    clientX: number;
    clientY: number;
}

export class SelectionController {
    anchor?: TextCaret;
    private dragRange?: { from: number; to: number };
    private lastTouchBlockClick?: { id: string; count: number };
    private handleDrag?: SelectionPointer & {
        endpoint: 'start' | 'end';
        start: TextCaret;
        end: TextCaret;
        offsetX: number;
        offsetY: number;
    };
    affinity: CaretAffinity = 'downstream';
    column?: number;
    region?: string;
    private lastSelection?: string;

    cells(document: NativeDocument, selected: TableCellSelection): NativeSelection | undefined {
        const rectangle = tableRectangle(document, selected);
        if (!rectangle) return;
        const anchor = rectangle.grid.cells.find((cell) => cell.node.id === selected.anchorId);
        const focus = rectangle.grid.cells.find((cell) => cell.node.id === selected.focusId);
        const first = anchor && selectNodeText(anchor.node),
            last = focus && selectNodeText(focus.node);
        if (first && last) return { anchor: first.anchor, focus: last.focus, cells: selected };
    }

    selectAll(document: NativeDocument, current: NativeSelection | null): NativeSelection | null {
        if (this.region && this.lastSelection !== this.selectionKey(current)) this.region = undefined;
        const rectangle = current?.cells && tableRectangle(document, current.cells);
        if (!this.region && rectangle) {
            const grid = rectangle.grid;
            const selected = this.cells(document, {
                tableId: grid.table.id,
                anchorId: grid.cells[0].node.id,
                focusId: grid.cells.at(-1)!.node.id,
            });
            if (selected) this.region = grid.table.id;
            this.lastSelection = this.selectionKey(selected ?? null);
            return selected ?? null;
        }
        const blockId = current?.focus.blockId;
        const region = this.region || !blockId ? document.root : selectionRegion(document.root, blockId);
        const range = selectNodeText(region);
        this.region = range ? region.id : undefined;
        this.lastSelection = this.selectionKey(range);
        return range;
    }

    private selectionKey(selection: NativeSelection | null): string | undefined {
        if (!selection) return;
        return JSON.stringify([
            selection.anchor.blockId,
            selection.anchor.offset,
            selection.focus.blockId,
            selection.focus.offset,
            selection.scopeId,
            selection.cells?.tableId,
            selection.cells?.anchorId,
            selection.cells?.focusId,
        ]);
    }

    point(
        document: NativeDocument,
        scene: DocumentScene,
        request: PointSelectionRequest,
        options: PointSelectionOptions,
    ): PointSelectionResult {
        const { page, x, y, extend = false, shift = false, pointerType = 'mouse', held = false } = request;
        let { clicks = 1 } = request;
        if (options.selectingCells) {
            const cell = cellAt(scene, page, x, y);
            if (cell) {
                const current = options.selection?.cells;
                const selected = this.cells(document, {
                    tableId: cell.tableId,
                    anchorId: (extend || shift) && current?.tableId === cell.tableId ? current.anchorId : cell.cellId,
                    focusId: cell.cellId,
                });
                return selected
                    ? { kind: 'cells', selection: selected, selectingCells: true }
                    : { kind: 'none', selectingCells: true };
            }
            if (extend) return { kind: 'none', selectingCells: true };
        }
        const hit = hitTest(scene, page, x, y);
        if (!hit) {
            const position =
                !extend && !shift && options.allowEmpty !== false
                    ? emptyWritingPosition(document, scene, page, { x, y })
                    : undefined;
            return position
                ? { kind: 'empty', position, selectingCells: false }
                : { kind: 'none', selectingCells: false };
        }
        const originalHit = { ...hit };
        if (pointerType === 'touch' && !extend && !shift) {
            clicks = held
                ? 2
                : clicks > 1 && this.lastTouchBlockClick?.id === hit.blockId
                  ? this.lastTouchBlockClick.count + 1
                  : 1;
            this.lastTouchBlockClick = { id: hit.blockId, count: clicks };
        }
        this.region = undefined;
        this.column = undefined;
        this.affinity = hit.affinity === options.upstreamAffinity ? 'upstream' : 'downstream';
        hit.blockOffset =
            options.navigation?.caret({ blockId: hit.blockId, offset: hit.blockOffset }, this.affinity)?.offset ??
            hit.blockOffset;
        if (extend || shift) {
            this.anchor ??= options.selection?.anchor ?? { blockId: hit.blockId, offset: 0 };
            let offset = hit.blockOffset;
            if (extend && clicks > 1) {
                const text = blockText(findNode(document, hit.blockId)!);
                const range = clicks > 2 ? { from: 0, to: text.length } : wordRange(text, offset);
                const backward =
                    hit.blockId === this.anchor.blockId && offset < (this.dragRange?.from ?? this.anchor.offset);
                offset = backward ? range.from : range.to;
                if (hit.blockId === this.anchor.blockId && this.dragRange)
                    this.anchor = { ...this.anchor, offset: backward ? this.dragRange.to : this.dragRange.from };
            }
            return {
                kind: 'text',
                selection: { anchor: this.anchor, focus: { blockId: hit.blockId, offset } },
                hit: originalHit,
                clicks,
                selectingCells: false,
            };
        }
        const text = blockText(findNode(document, hit.blockId)!);
        const range =
            clicks >= 3
                ? { from: 0, to: text.length }
                : clicks === 2
                  ? wordRange(text, hit.blockOffset)
                  : { from: hit.blockOffset, to: hit.blockOffset };
        this.dragRange = clicks > 1 ? range : undefined;
        this.anchor = { blockId: hit.blockId, offset: range.from };
        return {
            kind: 'text',
            selection: { anchor: this.anchor, focus: { blockId: hit.blockId, offset: range.to } },
            hit: originalHit,
            clicks,
            selectingCells: false,
        };
    }

    startHandle(
        document: NativeDocument,
        selection: NativeSelection,
        endpoint: 'start' | 'end',
        pointer: SelectionPointer,
        rectangle: (caret: TextCaret, affinity: CaretAffinity) => { left: number; top: number; height: number } | null,
    ): boolean {
        const ranges = selectionRanges(document, selection),
            first = ranges[0],
            last = ranges.at(-1)!;
        const start = { blockId: first.blockId, offset: first.from },
            end = { blockId: last.blockId, offset: last.to };
        const rect = rectangle(endpoint === 'start' ? start : end, endpoint === 'end' ? 'upstream' : 'downstream');
        if (!rect) return false;
        this.handleDrag = {
            pointerId: pointer.pointerId,
            clientX: pointer.clientX,
            clientY: pointer.clientY,
            endpoint,
            start,
            end,
            offsetX: pointer.clientX - rect.left,
            offsetY: pointer.clientY - rect.top - rect.height / 2,
        };
        return true;
    }

    handleActive(pointerId: number): boolean {
        return this.handleDrag?.pointerId === pointerId;
    }

    dragHandle(
        scene: DocumentScene,
        pointer: SelectionPointer,
        pages: readonly SelectionPageBounds[],
        scale: number,
    ): NativeSelection | undefined {
        const drag = this.handleDrag;
        if (!drag || pointer.pointerId !== drag.pointerId) return;
        const x = pointer.clientX - drag.offsetX,
            y = pointer.clientY - drag.offsetY;
        let nearest: { index: number; bounds: SelectionPageBounds; distance: number } | undefined;
        pages.forEach((bounds, index) => {
            const distance = Math.max(bounds.top - y, 0, y - bounds.bottom);
            if (!nearest || distance < nearest.distance) nearest = { index, bounds, distance };
        });
        if (!nearest) return;
        const hit = hitTest(scene, nearest.index, (x - nearest.bounds.left) / scale, (y - nearest.bounds.top) / scale);
        if (!hit) return;
        const target = { blockId: hit.blockId, offset: hit.blockOffset };
        return {
            anchor: drag.endpoint === 'start' ? target : drag.start,
            focus: drag.endpoint === 'end' ? target : drag.end,
        };
    }

    endHandle(): void {
        this.handleDrag = undefined;
    }

    navigate(
        event: NavigationKey,
        navigation: NativeNavigation | undefined,
        selected: NativeSelection | null,
        options: { platform?: string; pageHeight?: number } = {},
    ): NavigationResult | undefined {
        if (event.isComposing) return;
        const key = event.key;
        if (
            selected?.cells &&
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key) &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
        ) {
            const rectangle = navigation && tableRectangle(navigation.document, selected.cells);
            if (rectangle && navigation) {
                const grid = rectangle.grid,
                    current = grid.cells.find((cell) => cell.node.id === selected.cells!.focusId)!;
                const direction =
                    navigation.scene.pages
                        .flatMap((page) => page.cells ?? [])
                        .find((cell) => cell.tableId === grid.table.id)?.direction ?? 'rtl';
                const dx =
                    key === 'ArrowLeft'
                        ? direction === 'rtl'
                            ? 1
                            : -1
                        : key === 'ArrowRight'
                          ? direction === 'rtl'
                              ? -1
                              : 1
                          : 0;
                const row =
                    key === 'ArrowUp'
                        ? current.row - 1
                        : key === 'ArrowDown'
                          ? current.row + current.rowspan
                          : current.row;
                const column = dx < 0 ? current.column - 1 : dx > 0 ? current.column + current.colspan : current.column;
                const target = grid.cells.find(
                    (cell) =>
                        cell.row <= row &&
                        cell.row + cell.rowspan > row &&
                        cell.column <= column &&
                        cell.column + cell.colspan > column,
                );
                return {
                    selection: target
                        ? this.cells(navigation.document, {
                              tableId: grid.table.id,
                              anchorId: event.shiftKey ? selected.cells.anchorId : target.node.id,
                              focusId: target.node.id,
                          })
                        : undefined,
                };
            }
            return {};
        }
        if (['PageUp', 'PageDown'].includes(key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
            this.region = undefined;
            const direction = key === 'PageUp' ? -1 : 1;
            const next =
                selected && options.pageHeight
                    ? navigation?.page(selected.focus, direction, options.pageHeight, this.affinity, this.column)
                    : undefined;
            if (!next) return {};
            this.column = next.column;
            return { ...this.move(next.caret, selected, event.shiftKey), pageDirection: direction };
        }
        if (['ArrowUp', 'ArrowDown'].includes(key) && event.ctrlKey && !event.metaKey && !event.altKey) {
            const target = selected ? navigation?.paragraph(selected.focus, key === 'ArrowUp' ? -1 : 1) : undefined;
            this.column = this.region = undefined;
            return target ? this.move(target, selected, event.shiftKey) : {};
        }
        if ((event.ctrlKey || event.metaKey) && event.altKey && ['ArrowLeft', 'ArrowRight'].includes(key)) {
            const target = selected ? navigation?.parallel(selected.focus, key === 'ArrowLeft' ? -1 : 1) : undefined;
            if (target) {
                this.column = undefined;
                return this.move(target, selected, false);
            }
        }
        if (['ArrowLeft', 'ArrowRight'].includes(key) && (!event.altKey || /Mac/.test(options.platform ?? ''))) {
            if (!selected || !navigation) return {};
            const direction = key === 'ArrowLeft' ? -1 : 1;
            const collapsed =
                selected.anchor.blockId === selected.focus.blockId && selected.anchor.offset === selected.focus.offset;
            const target =
                !collapsed && !event.shiftKey
                    ? navigation.collapse(selected, direction)
                    : event.metaKey
                      ? navigation.edge(selected.focus, direction > 0, this.affinity)
                      : navigation.horizontal(selected.focus, direction, this.affinity, event.ctrlKey || event.altKey);
            this.column = this.region = undefined;
            return this.move(target, selected, event.shiftKey);
        }
        if (['Home', 'End'].includes(key) && !event.ctrlKey && !event.metaKey) {
            const target = selected ? navigation?.edge(selected.focus, key === 'End', this.affinity) : undefined;
            this.column = this.region = undefined;
            return target ? this.move(target, selected, event.shiftKey) : {};
        }
        if ((event.ctrlKey || event.metaKey) && ['Home', 'End'].includes(key)) {
            const target = navigation?.boundary(key === 'End');
            if (!target) return {};
            this.column = this.region = undefined;
            return this.move(target, selected, event.shiftKey);
        }
        if (['ArrowUp', 'ArrowDown'].includes(key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
            this.region = undefined;
            if (!selected || !navigation) return {};
            const direction = key === 'ArrowUp' ? -1 : 1;
            if (
                !event.shiftKey &&
                (selected.anchor.blockId !== selected.focus.blockId || selected.anchor.offset !== selected.focus.offset)
            ) {
                const ranges = selectionRanges(navigation.document, selected),
                    first = ranges[0],
                    last = ranges.at(-1)!;
                return this.move(
                    {
                        blockId: direction < 0 ? first.blockId : last.blockId,
                        offset: direction < 0 ? first.from : last.to,
                        affinity: direction < 0 ? 'downstream' : 'upstream',
                    },
                    selected,
                    false,
                );
            }
            const next = navigation.vertical(selected.focus, direction, this.affinity, this.column);
            if (!next) return {};
            this.column = next.column;
            return this.move(next.caret, selected, event.shiftKey);
        }
    }

    private move(target: NavigationCaret, selected: NativeSelection | null, extend: boolean): NavigationResult {
        this.affinity = target.affinity;
        return { selection: { anchor: extend && selected ? selected.anchor : target, focus: target } };
    }
}
