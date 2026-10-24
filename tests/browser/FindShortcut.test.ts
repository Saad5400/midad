import { FindShortcut, PrintShortcut } from '@saad5400/midad/browser/input';
import { afterEach, expect, it, vi } from 'vitest';

const entries: Array<FindShortcut | PrintShortcut> = [];
afterEach(() => {
    entries.splice(0).forEach((entry) => entry.dispose());
    document.body.replaceChildren();
});
const root = () => {
    const element = document.createElement('section');
    element.innerHTML = '<input>';
    element.getClientRects = () => [{ width: 200, height: 100 }] as unknown as DOMRectList;
    document.body.append(element);
    return element;
};
const key = (options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', {
        key: 'f',
        code: 'KeyF',
        ctrlKey: true,
        cancelable: true,
        bubbles: true,
        ...options,
    });
    window.dispatchEvent(event);
    return event;
};
it('routes physical Ctrl/Cmd+F to the focused surface and coexists with printing', () => {
    const first = root(),
        second = root(),
        findA = vi.fn(),
        findB = vi.fn(),
        print = vi.fn();
    entries.push(new FindShortcut(first, findA), new FindShortcut(second, findB), new PrintShortcut(first, print));
    first.querySelector('input')!.focus();
    expect(key({ key: 'ب' }).defaultPrevented).toBe(true);
    expect(findA).toHaveBeenCalledTimes(1);
    expect(findB).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
    second.querySelector('input')!.focus();
    key({ ctrlKey: false, metaKey: true });
    expect(findB).toHaveBeenCalledTimes(1);
    key({ key: 'p', code: 'KeyP' });
    expect(print).toHaveBeenCalledTimes(1);
});
it('preserves browser shortcuts when unavailable or disposed and ignores composing/modified keys', () => {
    const element = root(),
        find = vi.fn();
    let enabled = false;
    const shortcut = new FindShortcut(element, find, () => enabled);
    entries.push(shortcut);
    expect(key().defaultPrevented).toBe(false);
    enabled = true;
    for (const options of [{ isComposing: true }, { altKey: true }, { shiftKey: true }, { ctrlKey: false }])
        expect(key(options).defaultPrevented).toBe(false);
    shortcut.dispose();
    expect(key().defaultPrevented).toBe(false);
    expect(find).not.toHaveBeenCalled();
});
