import { EditingOverlayView, type EditingOverlayFrame } from '@saad5400/midad/browser/view';
import { afterEach, expect, it, vi } from 'vitest';

const views: EditingOverlayView[] = [];
afterEach(() => {
    views.splice(0).forEach((view) => view.dispose());
    document.body.replaceChildren();
});
function open() {
    const host = document.createElement('div');
    document.body.append(host);
    const frame: EditingOverlayFrame = {
        input: { label: 'Write', readonly: false, direction: 'rtl' },
        selection: [],
        find: [],
        peers: [],
        reviews: [],
        templates: [],
        handles: [],
        handleLabels: { start: 'Selection start', end: 'Selection end' },
    };
    const events = {
        focus: vi.fn(),
        blur: vi.fn(),
        input: vi.fn(),
        beforeInput: vi.fn(),
        key: vi.fn(),
        copy: vi.fn(),
        paste: vi.fn(),
        select: vi.fn(),
        handleStart: vi.fn(),
        handleMove: vi.fn(),
        handleEnd: vi.fn(),
    };
    const view = new EditingOverlayView(host, frame, events);
    views.push(view);
    return { host, frame, events, view };
}
const rect = { left: 50, top: 100, width: 120, height: 20 };

it('keeps the focused input, composed text and native selection intact across overlay updates', () => {
    const { frame, view } = open();
    const input = view.input;
    input.value = 'العربية English';
    input.focus();
    input.setSelectionRange(3, 10, 'backward');
    view.update({ ...frame, input: { ...frame.input, position: rect }, selection: [rect], caret: rect });
    expect(view.input).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('العربية English');
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([3, 10, 'backward']);
    expect(input.style.left).toBe('50px');
    expect(input.getAttribute('wrap')).toBe('off');
    expect(input.dir).toBe('rtl');
    expect(view.element.querySelector('.native-caret')?.getAttribute('aria-hidden')).toBe('true');
});

it('updates and clears command accessibility links, read-only state and input placement', () => {
    const { frame, view } = open();
    view.update({
        ...frame,
        input: {
            label: 'Text',
            readonly: true,
            direction: 'ltr',
            position: rect,
            command: { listId: 'commands', activeId: 'active-command' },
        },
    });
    expect(view.input.readOnly).toBe(true);
    expect(view.input.dir).toBe('ltr');
    expect(view.input.getAttribute('aria-label')).toBe('Text');
    expect(view.input.getAttribute('aria-activedescendant')).toBe('active-command');
    expect(view.input.getAttribute('aria-controls')).toBe('commands');
    expect(view.input.getAttribute('aria-haspopup')).toBe('listbox');
    expect(view.input.getAttribute('aria-autocomplete')).toBe('list');
    view.update(frame);
    expect(view.input.readOnly).toBe(false);
    expect(view.input.style.left).toBe('0px');
    expect(view.input.style.top).toBe('0px');
    for (const attribute of ['aria-activedescendant', 'aria-controls', 'aria-haspopup'])
        expect(view.input.hasAttribute(attribute)).toBe(false);
    expect(view.input.getAttribute('aria-autocomplete')).toBe('none');
});

it('forwards keyboard, input, composition, selection and clipboard events synchronously', () => {
    const { view, events } = open();
    const pairs = [
        ['focus', 'focus'],
        ['blur', 'blur'],
        ['input', 'input'],
        ['beforeinput', 'beforeInput'],
        ['compositionstart', 'beforeInput'],
        ['compositionend', 'input'],
        ['keydown', 'key'],
        ['copy', 'copy'],
        ['cut', 'copy'],
        ['paste', 'paste'],
        ['select', 'select'],
    ] as const;
    for (const [type, callback] of pairs) {
        const event = new Event(type, { cancelable: true });
        events[callback].mockImplementationOnce((event: Event) => event.preventDefault());
        view.input.dispatchEvent(event);
        expect(events[callback]).toHaveBeenLastCalledWith(event);
        expect(event.defaultPrevented).toBe(true);
    }
});

it('reuses selection nodes and removes obsolete ranges without modifying the caller frame', () => {
    const { frame, view } = open();
    const selection = Object.freeze([Object.freeze(rect), Object.freeze({ ...rect, top: 125 })]);
    view.update({ ...frame, selection, cells: true });
    const first = view.element.querySelector<HTMLElement>('.native-selection')!;
    expect(first.style.transform).toBe('translate3d(50px, 100px, 0)');
    expect(first.classList.contains('native-cell-selection')).toBe(true);
    view.update({ ...frame, selection: [rect] });
    expect(view.element.querySelector('.native-selection')).toBe(first);
    expect(first.classList.contains('native-cell-selection')).toBe(false);
    expect(view.element.querySelectorAll('.native-selection')).toHaveLength(1);
    view.update(frame);
    expect(view.element.querySelectorAll('.native-selection')).toHaveLength(0);
    expect(selection).toHaveLength(2);
});

it('renders independent search, review, template, collaborator and drop decorations safely', () => {
    const { frame, view } = open();
    view.update({
        ...frame,
        find: [{ ...rect, active: true }],
        peers: [{ id: 'peer', name: '<img src=x>', color: '#112233', caret: rect, rectangles: [rect] }],
        reviews: [{ id: 'review', kind: 'edit', active: true, rectangles: [rect] }],
        templates: [{ id: 'template', active: true, ...rect }],
        drop: { ...rect, blockId: 'block', side: 'before' },
    });
    expect(view.element.querySelector('.native-find-match.is-current')).not.toBeNull();
    expect(
        view.element.querySelector('.native-review-highlight.is-edit.is-active')?.getAttribute('data-review-id'),
    ).toBe('review');
    expect(view.element.querySelector('.native-live-template.is-active')?.getAttribute('data-template-id')).toBe(
        'template',
    );
    expect(view.element.querySelector('.native-peer-caret')?.textContent).toBe('<img src=x>');
    expect(view.element.querySelector('img')).toBeNull();
    expect(view.element.querySelector('.native-block-drop')?.getAttribute('data-target-block')).toBe('block');
    expect(view.element.querySelector('.native-block-drop')?.getAttribute('data-side')).toBe('before');
    view.update(frame);
    expect(view.element.querySelector('.native-peer-caret')).toBeNull();
    expect(view.element.querySelector('.native-find-match')).toBeNull();
});

it.each(['mouse', 'pen', 'touch'])(
    'keeps %s handles stable through drag updates and forwards capture cancellation',
    (pointerType) => {
        const { frame, view, events } = open();
        view.update({
            ...frame,
            handles: [
                { ...rect, endpoint: 'start' },
                { ...rect, endpoint: 'end' },
            ],
        });
        const handle = view.element.querySelector<HTMLElement>('[data-endpoint=start]')!;
        expect(handle.getAttribute('aria-label')).toBe('Selection start');
        expect(handle.tabIndex).toBe(-1);
        for (const [type, callback] of [
            ['pointerdown', 'handleStart'],
            ['pointermove', 'handleMove'],
            ['pointerup', 'handleEnd'],
            ['pointercancel', 'handleEnd'],
            ['lostpointercapture', 'handleEnd'],
        ] as const) {
            const event = new PointerEvent(type, { pointerType, pointerId: 8, cancelable: true });
            handle.dispatchEvent(event);
            expect(events[callback].mock.lastCall?.[0]).toBe(event);
            if (type === 'pointerdown') expect(events.handleStart).toHaveBeenLastCalledWith(event, 'start');
            expect(event.defaultPrevented).toBe(['pointerdown', 'pointermove'].includes(type));
        }
        view.update({ ...frame, handles: [{ ...rect, top: 300, endpoint: 'start' }] });
        expect(view.element.querySelector('[data-endpoint=start]')).toBe(handle);
        expect(handle.style.top).toBe('312px');
        expect(view.element.querySelector('[data-endpoint=end]')).toBeNull();
    },
);

it('disposes only its own DOM and ignores late updates and retained-element events', () => {
    const { host, frame, view, events } = open();
    const other = document.createElement('div');
    host.append(other);
    const input = view.input;
    view.dispose();
    view.dispose();
    view.update({ ...frame, selection: [rect] });
    input.dispatchEvent(new Event('input'));
    expect(events.input).not.toHaveBeenCalled();
    expect(host.children).toHaveLength(1);
    expect(host.firstElementChild).toBe(other);
});
