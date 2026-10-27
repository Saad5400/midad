export function portalMenuPoint(parent: HTMLElement, x: number, y: number): Record<string, string> {
    if (!(parent instanceof HTMLDialogElement)) return { position: 'fixed', left: `${x}px`, top: `${y}px` };
    const bounds = parent.getBoundingClientRect();
    const sx = parent.offsetWidth ? bounds.width / parent.offsetWidth : 1;
    const sy = parent.offsetHeight ? bounds.height / parent.offsetHeight : 1;
    return {
        position: 'absolute',
        left: `${(x - bounds.left) / sx - parent.clientLeft + parent.scrollLeft}px`,
        top: `${(y - bounds.top) / sy - parent.clientTop + parent.scrollTop}px`,
    };
}
