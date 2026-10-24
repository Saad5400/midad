import { PrintShortcut } from '@saad5400/midad/browser/input';
import { afterEach, expect, it, vi } from 'vitest';

const entries: PrintShortcut[] = [];
afterEach(() => {
    entries.forEach((entry) => entry.dispose());
    entries.length = 0;
    document.body.replaceChildren();
});
function fixture(parent: HTMLElement | ShadowRoot = document.body) {
    const root = document.createElement('section'),
        input = document.createElement('input');
    parent.append(root);
    root.append(input);
    root.getClientRects = () => [{ width: 200, height: 200 }] as unknown as DOMRectList;
    const print = vi.fn();
    const entry = new PrintShortcut(root, print);
    entries.push(entry);
    return { root, input, print, entry };
}
function key(options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', {
        key: 'p',
        code: 'KeyP',
        ctrlKey: true,
        cancelable: true,
        bubbles: true,
        ...options,
    });
    window.dispatchEvent(event);
    return event;
}
it('handles Ctrl/Cmd+P using the physical key on an Arabic keyboard', () => {
    const f = fixture();
    f.input.focus();
    expect(key({ key: 'ح' }).defaultPrevented).toBe(true);
    expect(key({ ctrlKey: false, metaKey: true }).defaultPrevented).toBe(true);
    expect(f.print).toHaveBeenCalledTimes(2);
});
it('keeps the focused editor in a closed shadow root ahead of a later-mounted editor', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    const focused = fixture(shadow);
    focused.input.focus();
    const later = fixture();
    key();
    expect(focused.print).toHaveBeenCalledTimes(1);
    expect(later.print).not.toHaveBeenCalled();
});
it('does not claim printing from an inert shadow host', () => {
    const host = document.createElement('div');
    document.body.append(host);
    host.inert = true;
    const shadow = host.attachShadow({ mode: 'closed' });
    fixture(shadow);
    expect(key().defaultPrevented).toBe(false);
});
it('prints the focused nested editor and remembers it after focus moves to its host chrome', () => {
    const parent = fixture(),
        child = fixture(parent.root);
    child.input.focus();
    key();
    expect(child.print).toHaveBeenCalledTimes(1);
    parent.input.focus();
    key();
    expect(parent.print).toHaveBeenCalledTimes(1);
    const title = document.createElement('input');
    document.body.append(title);
    title.focus();
    key();
    expect(parent.print).toHaveBeenCalledTimes(2);
});
it('ignores hidden/inert/disposed editors and leaves unrelated shortcuts alone', () => {
    const f = fixture();
    f.root.setAttribute('inert', '');
    expect(key().defaultPrevented).toBe(false);
    f.root.removeAttribute('inert');
    expect(key({ altKey: true }).defaultPrevented).toBe(false);
    expect(key({ shiftKey: true }).defaultPrevented).toBe(false);
    expect(key({ isComposing: true }).defaultPrevented).toBe(false);
    expect(key({ repeat: true }).defaultPrevented).toBe(true);
    expect(f.print).not.toHaveBeenCalled();
    f.entry.dispose();
    expect(key().defaultPrevented).toBe(false);
});
it('respects an already handled shortcut and removes the window listener after disposal', () => {
    const first = fixture();
    const handled = new KeyboardEvent('keydown', { code: 'KeyP', ctrlKey: true, cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);
    expect(first.print).not.toHaveBeenCalled();
    first.entry.dispose();
    const second = fixture();
    key();
    expect(second.print).toHaveBeenCalledTimes(1);
    expect(first.print).not.toHaveBeenCalled();
});
