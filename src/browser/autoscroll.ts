export function scrollingContainer(element: HTMLElement): HTMLElement {
    let target: HTMLElement | null = element;
    while (
        target &&
        (!/(auto|scroll)/.test(getComputedStyle(target).overflowY) || target.scrollHeight <= target.clientHeight)
    )
        target = target.parentElement;
    return target ?? (document.scrollingElement as HTMLElement);
}

export class SelectionScroller {
    private frame: number | undefined;
    private pointer: { x: number; y: number; update: () => void } | undefined;

    constructor(private readonly root: HTMLElement) {}

    update(x: number, y: number, update: () => void): void {
        this.pointer = { x, y, update };
        if (this.frame === undefined) this.frame = requestAnimationFrame(() => this.tick());
    }

    stop(): void {
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        this.frame = undefined;
        this.pointer = undefined;
    }

    private tick(): void {
        if (!this.pointer) return;
        const target = scrollingContainer(this.root.querySelector<HTMLElement>('.native-pages') ?? this.root);
        const bounds =
            target === document.scrollingElement ? { top: 0, bottom: innerHeight } : target.getBoundingClientRect();
        const toolbar = this.root.querySelector('.native-format-toolbar')?.getBoundingClientRect();
        const top = Math.max(0, bounds.top, toolbar && toolbar.top <= bounds.top ? toolbar.bottom : 0);
        const bottom = Math.min(innerHeight, bounds.bottom);
        const speed = (position: number, start: number, end: number): number =>
            position < start + 48
                ? -Math.min(40, (start + 48 - position) / 3)
                : position > end - 48
                  ? Math.min(40, (position - end + 48) / 3)
                  : 0;
        const beforeY = target.scrollTop;
        target.scrollTop += speed(this.pointer.y, top, bottom);
        const horizontal = this.root.querySelector<HTMLElement>('.native-pages');
        const beforeX = horizontal?.scrollLeft ?? 0;
        if (horizontal && horizontal.scrollWidth > horizontal.clientWidth) {
            const box = horizontal.getBoundingClientRect();
            horizontal.scrollLeft += speed(this.pointer.x, Math.max(0, box.left), Math.min(innerWidth, box.right));
        }
        const moved = target.scrollTop !== beforeY || (horizontal?.scrollLeft ?? 0) !== beforeX;
        if (moved) this.pointer.update();
        this.frame = moved && this.pointer ? requestAnimationFrame(() => this.tick()) : undefined;
    }
}
