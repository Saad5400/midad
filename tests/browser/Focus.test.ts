import { preserveSurfaceFocus } from '@saad5400/midad/browser';
import { afterEach, describe, expect, it } from 'vitest';

const elements: HTMLElement[] = [];
function element(tag: string, parent: HTMLElement = document.body): HTMLElement {
    const value = document.createElement(tag);
    parent.append(value);
    elements.push(value);
    return value;
}
function closingEvent(closing: HTMLElement): Event {
    const event = new Event('closing', { cancelable: true });
    closing.addEventListener('closing', preserveSurfaceFocus, { once: true });
    closing.dispatchEvent(event);
    return event;
}
afterEach(() => {
    elements.forEach((element) => element.remove());
    elements.length = 0;
});

describe('focus ownership between editor surfaces', () => {
    it.each(['menu', 'listbox', 'dialog', 'native-dialog'])(
        'keeps focus in a newer %s while another popup closes',
        (role) => {
            const closing = element('div');
            const next = element(role === 'native-dialog' ? 'dialog' : 'div');
            if (role === 'native-dialog') next.setAttribute('open', '');
            else next.setAttribute('role', role);
            const button = element('button', next);
            button.focus();
            expect(closingEvent(closing).defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(button);
        },
    );
    it.each(['input', 'textarea', 'select', 'editable'])('keeps the current %s editing focus', (kind) => {
        const closing = element('div');
        const input = element(kind === 'editable' ? 'div' : kind);
        if (kind === 'editable') {
            input.setAttribute('contenteditable', '');
            input.tabIndex = 0;
        }
        input.focus();
        expect(closingEvent(closing).defaultPrevented).toBe(true);
    });
    it('allows cancellation to return focus when it still belongs to the closing popup', () => {
        const closing = element('div');
        closing.setAttribute('role', 'dialog');
        element('button', closing).focus();
        expect(closingEvent(closing).defaultPrevented).toBe(false);
    });
    it('allows normal focus return when the active element has been removed', () => {
        const closing = element('div');
        const button = element('button');
        button.focus();
        button.remove();
        expect(closingEvent(closing).defaultPrevented).toBe(false);
    });
});
