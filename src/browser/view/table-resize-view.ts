import type { NativeLabels } from '../labels.js';
import type { SceneCell, SceneTableRow } from '../../layout/scene.js';

export interface TableResizeFrame {
    readonly cells: readonly SceneCell[];
    readonly rows: readonly SceneTableRow[];
    readonly rowHeights: Readonly<Record<string, number>>;
    readonly tableId: string;
    readonly labels: Pick<NativeLabels, 'resizeColumn' | 'resizeRow'>;
    readonly scale: number;
    readonly disabled?: boolean;
}
export interface TableResizeOptions {
    resize(tableId: string, boundary: number, delta: number, width: number): void;
    resizeRow(tableId: string, rowId: string, height: number | null): void;
}
interface TableGeometry {
    x: number;
    top: number;
    bottom: number;
    edges: readonly number[];
    minimums: readonly number[];
    width: number;
    rtl: boolean;
}
type Handle = { element: HTMLDivElement } & ({ boundary: number } | { row: SceneTableRow });
type Gesture = { pointer: number; element: HTMLElement; start: number; delta: number } & (
    | { boundary: number }
    | { row: SceneTableRow; height: number }
);

const styles = `
.midad-table-resize .midad-table-resize-handle { position:absolute; z-index:4; touch-action:none; box-sizing:border-box; }
.midad-table-resize .native-column-handle { width:16px; cursor:col-resize; }
.midad-table-resize .native-row-handle { height:16px; cursor:row-resize; }
.midad-table-resize .midad-table-resize-handle:hover,
.midad-table-resize .midad-table-resize-handle:focus-visible,
.midad-table-resize .midad-table-resize-handle.is-dragging {
    background:var(--midad-resize-fill,#2563eb33); outline:1px solid var(--midad-resize-color,#2563eb);
}`;

export class TableResizeView {
    readonly element: HTMLDivElement;
    private frame: TableResizeFrame;
    private table: TableGeometry | undefined;
    private handles = new Map<string, Handle>();
    private gesture: Gesture | undefined;
    private disposed = false;

    constructor(
        host: HTMLElement,
        frame: TableResizeFrame,
        private readonly options: TableResizeOptions,
    ) {
        this.frame = frame;
        this.element = host.ownerDocument.createElement('div');
        this.element.className = 'midad-table-resize native-table-handles';
        const style = host.ownerDocument.createElement('style');
        style.textContent = styles;
        this.element.append(style);
        this.update(frame);
        host.append(this.element);
    }
    update(frame: TableResizeFrame): void {
        if (this.disposed) return;
        if (
            frame.cells !== this.frame.cells ||
            frame.rows !== this.frame.rows ||
            frame.rowHeights !== this.frame.rowHeights ||
            frame.tableId !== this.frame.tableId ||
            frame.scale !== this.frame.scale ||
            frame.disabled
        )
            this.cancel();
        this.frame = frame;
        const cells = frame.cells.filter((cell) => cell.tableId === frame.tableId),
            first = cells[0];
        this.table = first
            ? {
                  x: first.tableX,
                  top: Math.min(...cells.map((cell) => cell.y)),
                  bottom: Math.max(...cells.map((cell) => cell.y + cell.height)),
                  edges: first.columnEdges,
                  minimums: first.minimumColumnWidths ?? [],
                  width: first.columnEdges.at(-1)!,
                  rtl: first.direction === 'rtl',
              }
            : undefined;
        const table = this.table;
        if (
            frame.disabled ||
            !Number.isFinite(frame.scale) ||
            frame.scale <= 0 ||
            !table ||
            !Number.isFinite(table.width) ||
            table.width <= 0 ||
            !table.edges.every((edge, index) => Number.isFinite(edge) && (!index || edge > table.edges[index - 1]))
        ) {
            this.cancel();
            this.clear();
            return;
        }
        const active = new Set<string>();
        for (let boundary = 1; boundary < table.edges.length - 1; boundary++) {
            const key = `column:${boundary}`;
            active.add(key);
            const handle = this.handles.get(key) ?? this.create(key, { boundary });
            handle.element.setAttribute('aria-label', frame.labels.resizeColumn.replace('{column}', String(boundary)));
            handle.element.setAttribute(
                'aria-valuemin',
                String(Math.round(((table.edges[boundary - 1] + this.minimum(boundary, -1)) / table.width) * 100)),
            );
            handle.element.setAttribute(
                'aria-valuemax',
                String(Math.round(((table.edges[boundary + 1] - this.minimum(boundary, 1)) / table.width) * 100)),
            );
            handle.element.setAttribute(
                'aria-valuenow',
                String(Math.round((table.edges[boundary] / table.width) * 100)),
            );
        }
        for (const row of frame.rows.filter((row) => row.tableId === frame.tableId && row.ends)) {
            const key = `row:${row.rowId}`;
            active.add(key);
            const handle = this.handles.get(key) ?? this.create(key, { row });
            if ('row' in handle) handle.row = row;
            handle.element.setAttribute(
                'aria-label',
                frame.labels.resizeRow.replace('{row}', String(row.rowIndex + 1)),
            );
            handle.element.setAttribute('aria-valuemin', '16');
            handle.element.setAttribute('aria-valuemax', '100000');
            handle.element.setAttribute(
                'aria-valuenow',
                String(Math.round((frame.rowHeights[row.rowId] ?? row.height) / 0.75)),
            );
        }
        for (const [key, handle] of this.handles)
            if (!active.has(key)) {
                handle.element.remove();
                this.handles.delete(key);
            }
        this.paint();
    }
    private create(key: string, target: { boundary: number } | { row: SceneTableRow }): Handle {
        const element = this.element.ownerDocument.createElement('div'),
            column = 'boundary' in target;
        element.className = `midad-table-resize-handle ${column ? 'native-column-handle' : 'native-row-handle'}`;
        element.tabIndex = 0;
        element.setAttribute('role', 'separator');
        element.setAttribute('aria-orientation', column ? 'vertical' : 'horizontal');
        element.setAttribute('data-table-handles', '');
        if (column) element.dataset.boundary = String(target.boundary);
        else element.dataset.rowId = target.row.rowId;
        const handle: Handle = { element, ...target };
        element.addEventListener('pointerdown', (event) => this.down(event, handle));
        element.addEventListener('pointermove', (event) => this.move(event));
        element.addEventListener('pointerup', (event) => this.up(event));
        element.addEventListener('pointercancel', (event) => this.cancelPointer(event));
        element.addEventListener('lostpointercapture', (event) => this.cancelPointer(event));
        element.addEventListener('keydown', (event) => this.key(event, handle));
        this.handles.set(key, handle);
        this.element.append(element);
        return handle;
    }
    private minimum(boundary: number, side: -1 | 1): number {
        const table = this.table!,
            index = side === -1 ? boundary - 1 : boundary,
            floor = Math.max(Math.min(24, table.width / (table.edges.length - 1) / 2), table.minimums[index] ?? 0);
        return Math.min(table.edges[index + 1] - table.edges[index], floor);
    }
    private clamp(boundary: number, delta: number): number {
        const table = this.table!;
        const value = Math.max(
            this.minimum(boundary, -1) - (table.edges[boundary] - table.edges[boundary - 1]),
            Math.min(table.edges[boundary + 1] - table.edges[boundary] - this.minimum(boundary, 1), delta),
        );
        return Math.abs(value) < 0.002 ? 0 : value;
    }
    private down(event: PointerEvent, handle: Handle): void {
        if (
            this.disposed ||
            this.frame.disabled ||
            handle.element.parentNode !== this.element ||
            !this.table ||
            !event.isPrimary ||
            event.button !== 0 ||
            this.gesture
        )
            return;
        event.preventDefault();
        event.stopPropagation();
        handle.element.focus({ preventScroll: true });
        handle.element.setPointerCapture(event.pointerId);
        this.gesture = {
            pointer: event.pointerId,
            element: handle.element,
            start: 'boundary' in handle ? event.clientX : event.clientY,
            delta: 0,
            ...('boundary' in handle
                ? { boundary: handle.boundary }
                : { row: handle.row, height: this.frame.rowHeights[handle.row.rowId] ?? handle.row.height }),
        };
        this.paint();
    }
    private move(event: PointerEvent): void {
        const gesture = this.gesture;
        if (this.disposed || !gesture || gesture.pointer !== event.pointerId || !this.table) return;
        event.preventDefault();
        event.stopPropagation();
        gesture.delta =
            'boundary' in gesture
                ? this.clamp(
                      gesture.boundary,
                      ((event.clientX - gesture.start) / this.frame.scale) * (this.table.rtl ? -1 : 1),
                  )
                : Math.max(
                      12 - gesture.height,
                      Math.min(75000 - gesture.height, (event.clientY - gesture.start) / this.frame.scale),
                  );
        this.paint();
    }
    private up(event: PointerEvent): void {
        if (!this.gesture || this.gesture.pointer !== event.pointerId || !this.table) return;
        this.move(event);
        const gesture = this.gesture,
            tableId = this.frame.tableId,
            width = this.table.width;
        this.cancel();
        if ('boundary' in gesture) {
            if (gesture.delta) this.options.resize(tableId, gesture.boundary, gesture.delta, width);
        } else if (Math.abs(gesture.delta) > 0.001)
            this.options.resizeRow(tableId, gesture.row.rowId, gesture.height + gesture.delta);
    }
    private key(event: KeyboardEvent, handle: Handle): void {
        if (
            this.disposed ||
            this.frame.disabled ||
            handle.element.parentNode !== this.element ||
            !this.table ||
            event.isComposing
        )
            return;
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            this.cancel();
            return;
        }
        if ('boundary' in handle) {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            this.cancel();
            const physical =
                event.key === 'ArrowLeft'
                    ? -1
                    : event.key === 'ArrowRight'
                      ? 1
                      : event.key === 'Home'
                        ? -this.table.width
                        : this.table.width;
            const delta = this.clamp(handle.boundary, physical * (event.shiftKey ? 10 : 2) * (this.table.rtl ? -1 : 1));
            if (delta) this.options.resize(this.frame.tableId, handle.boundary, delta, this.table.width);
        } else {
            if (!['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
            event.preventDefault();
            this.cancel();
            const height = this.frame.rowHeights[handle.row.rowId] ?? handle.row.height,
                change = (event.shiftKey ? 10 : 2) * (event.key === 'ArrowUp' ? -1 : 1);
            this.options.resizeRow(
                this.frame.tableId,
                handle.row.rowId,
                event.key === 'Home' ? null : Math.max(12, Math.min(75000, height + change)),
            );
        }
    }
    private paint(): void {
        const table = this.table;
        if (!table) return;
        for (const handle of this.handles.values()) {
            const element = handle.element,
                dragging = this.gesture?.element === element,
                delta = dragging ? this.gesture!.delta : 0;
            element.dataset.tableId = this.frame.tableId;
            element.classList.toggle('is-dragging', dragging);
            if ('boundary' in handle) {
                const edge = table.edges[handle.boundary] + delta;
                element.style.left = `${(table.x + (table.rtl ? table.width - edge : edge)) * this.frame.scale - 8}px`;
                element.style.top = `${table.top * this.frame.scale}px`;
                element.style.height = `${Math.max(24, (table.bottom - table.top) * this.frame.scale)}px`;
            } else {
                element.style.left = `${handle.row.x * this.frame.scale}px`;
                element.style.top = `${(handle.row.y + handle.row.height + delta) * this.frame.scale - 8}px`;
                element.style.width = `${handle.row.width * this.frame.scale}px`;
            }
        }
    }
    private cancelPointer(event: PointerEvent): void {
        if (this.gesture?.pointer === event.pointerId) this.cancel();
    }
    private cancel(): void {
        const gesture = this.gesture;
        this.gesture = undefined;
        if (gesture?.element.hasPointerCapture(gesture.pointer)) gesture.element.releasePointerCapture(gesture.pointer);
        this.paint();
    }
    private clear(): void {
        for (const handle of this.handles.values()) handle.element.remove();
        this.handles.clear();
    }
    dispose(): void {
        if (this.disposed) return;
        this.cancel();
        this.disposed = true;
        this.clear();
        this.element.remove();
    }
}
