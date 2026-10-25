export function preserveSurfaceFocus(event: Event, ownerDocument = globalThis.document): void {
    const active = ownerDocument?.activeElement;
    if (!active?.isConnected) return;
    const editing = active.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    const surface = active.closest('[role="menu"], [role="listbox"], [role="dialog"], dialog[open]');
    const closing = event.target as Node | null;
    const insideClosing = typeof closing?.contains === 'function' && closing.contains(active);
    if (editing || (surface && !insideClosing)) event.preventDefault();
}

export class SurfaceFocusIntent {
    private epoch = 0;
    private disposed = false;
    private readonly view: Window | null;
    private readonly record = (event: Event): void => {
        if (event.target !== this.ownerDocument?.body && !this.owns(event.target)) this.epoch++;
    };

    constructor(
        private readonly owns: (target: EventTarget | null) => boolean,
        private readonly ownerDocument: Document | undefined = globalThis.document,
    ) {
        this.view = ownerDocument?.defaultView ?? null;
        this.view?.addEventListener('pointerdown', this.record, true);
        this.view?.addEventListener('focusin', this.record, true);
    }
    capture(): number {
        return this.epoch;
    }
    current(token: number): boolean {
        return !this.disposed && token === this.epoch;
    }
    dispose(): void {
        this.disposed = true;
        this.view?.removeEventListener('pointerdown', this.record, true);
        this.view?.removeEventListener('focusin', this.record, true);
    }
}
