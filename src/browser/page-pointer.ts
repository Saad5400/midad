export interface PagePointerPoint {
    readonly x: number;
    readonly y: number;
    readonly extend: boolean;
    readonly clicks: number;
    readonly shift: boolean;
    readonly clientX: number;
    readonly clientY: number;
    readonly pointerType: string;
    readonly held: boolean;
}
export interface PagePointerOptions {
    readonly element: () => HTMLElement | undefined;
    readonly scale: () => number;
    readonly selectingCells: () => boolean;
    readonly onPoint: (point: PagePointerPoint) => void;
    readonly onFinish: () => void;
}
export class PagePointerController {
    constructor(private readonly options: PagePointerOptions) {}
    private pointerId: number | undefined;
    private pointerType = 'mouse';
    private longPress: ReturnType<typeof setTimeout> | undefined;
    private longPressed = false;
    private clickCount = 1;
    private ignoreMouseUntil = 0;
    private touchStart: { x: number; y: number } | undefined;
    private lastTap: { x: number; y: number; time: number; count: number } | undefined;

    private point(event: MouseEvent | PointerEvent, extend: boolean): void {
        const box = this.options.element()!.getBoundingClientRect();
        this.options.onPoint({
            x: (event.clientX - box.left) / this.options.scale(),
            y: (event.clientY - box.top) / this.options.scale(),
            extend,
            clicks: this.clickCount,
            shift: event.shiftKey,
            clientX: event.clientX,
            clientY: event.clientY,
            pointerType: this.pointerType,
            held: this.longPressed,
        });
    }

    contextMenu(event: MouseEvent): void {
        if (this.pointerType === 'touch') {
            event.preventDefault();
            event.stopPropagation();
        }
    }

    pointerDown(event: PointerEvent): void {
        this.pointerType = event.pointerType;
        if (!event.isPrimary) {
            this.pointerCancel();
            return;
        }
        if (event.button !== 0) return;
        this.pointerCancel();
        this.pointerId = event.pointerId;
        if (event.pointerType === 'touch') {
            if (this.options.selectingCells()) {
                event.preventDefault();
                this.options.element()!.setPointerCapture(event.pointerId);
                this.clickCount = 1;
                this.point(event, false);
                return;
            }
            this.touchStart = { x: event.clientX, y: event.clientY };
            this.longPress = setTimeout(() => {
                if (!this.touchStart) return;
                this.longPressed = true;
                this.clickCount = 2;
                this.point(event, false);
            }, 450);
            return;
        }
        this.options.element()!.setPointerCapture(event.pointerId);
        if (event.pointerType === 'pen') {
            event.preventDefault();
            this.clickCount = 1;
            this.point(event, false);
        }
    }

    mouseDown(event: MouseEvent): void {
        if (event.button !== 0) return;
        event.preventDefault();
        if (performance.now() < this.ignoreMouseUntil) return;
        this.clickCount = event.detail || 1;
        this.point(event, false);
    }

    pointerMove(event: PointerEvent): void {
        if (event.pointerId !== this.pointerId) return;
        if (event.pointerType === 'touch') {
            if (this.options.selectingCells()) {
                event.preventDefault();
                this.point(event, true);
                return;
            }
            if (
                this.touchStart &&
                Math.hypot(event.clientX - this.touchStart.x, event.clientY - this.touchStart.y) > 10
            ) {
                this.touchStart = undefined;
                clearTimeout(this.longPress);
            }
            return;
        }
        if (event.buttons === 1) this.point(event, true);
    }

    pointerUp(event: PointerEvent): void {
        if (event.pointerId !== this.pointerId) return;
        if (event.pointerType === 'touch') this.ignoreMouseUntil = performance.now() + 700;
        clearTimeout(this.longPress);
        if (event.pointerType === 'touch' && this.touchStart && !this.longPressed && !this.options.selectingCells()) {
            const now = performance.now();
            this.clickCount =
                this.lastTap &&
                now - this.lastTap.time < 400 &&
                Math.hypot(event.clientX - this.lastTap.x, event.clientY - this.lastTap.y) < 20
                    ? this.lastTap.count + 1
                    : 1;
            this.lastTap = { x: event.clientX, y: event.clientY, time: now, count: this.clickCount };
            this.point(event, false);
        }
        this.pointerCancel();
    }

    pointerCancel(): void {
        this.options.onFinish();
        clearTimeout(this.longPress);
        this.longPressed = false;
        this.pointerId = undefined;
        this.touchStart = undefined;
    }
}
