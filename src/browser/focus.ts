export function preserveSurfaceFocus(event: Event, ownerDocument = globalThis.document): void {
    const active = ownerDocument?.activeElement;
    if (!active?.isConnected) return;
    const editing = active.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    const surface = active.closest('[role="menu"], [role="listbox"], [role="dialog"], dialog[open]');
    const closing = event.target as Node | null;
    const insideClosing = typeof closing?.contains === 'function' && closing.contains(active);
    if (editing || (surface && !insideClosing)) event.preventDefault();
}
