export interface OverlayPoint {
    readonly left: number;
    readonly top: number;
}
export interface OverlayCaret extends OverlayPoint {
    readonly height: number;
}
export interface OverlayRect extends OverlayCaret {
    readonly width: number;
}
export interface EditingOverlayFrame {
    readonly input: {
        readonly label: string;
        readonly readonly: boolean;
        readonly direction: 'ltr' | 'rtl';
        readonly position?: OverlayPoint | null;
        readonly command?: { readonly listId: string; readonly activeId?: string };
    };
    readonly selection: readonly OverlayRect[];
    readonly cells?: boolean;
    readonly find: readonly (OverlayRect & { readonly active: boolean })[];
    readonly peers: readonly {
        readonly id: string;
        readonly name: string;
        readonly color: string;
        readonly rectangles: readonly OverlayRect[];
        readonly caret: OverlayCaret | null;
    }[];
    readonly reviews: readonly {
        readonly id: string;
        readonly kind: string;
        readonly active: boolean;
        readonly rectangles: readonly OverlayRect[];
    }[];
    readonly templates: readonly (OverlayRect & { readonly id: string; readonly active: boolean })[];
    readonly handles: readonly (OverlayCaret & { readonly endpoint: 'start' | 'end' })[];
    readonly handleLabels: { readonly start: string; readonly end: string };
    readonly caret?: OverlayCaret | null;
    readonly drop?: (OverlayPoint & { readonly width: number; readonly blockId: string; readonly side: string }) | null;
}
export interface EditingOverlayEvents {
    focus(event: FocusEvent): void;
    blur(event: FocusEvent): void;
    input(event: Event): void;
    beforeInput(event: InputEvent | CompositionEvent): void;
    key(event: KeyboardEvent): void;
    copy(event: ClipboardEvent): void;
    paste(event: ClipboardEvent): void;
    select(event: Event): void;
    handleStart(event: PointerEvent, endpoint: 'start' | 'end'): void;
    handleMove(event: PointerEvent): void;
    handleEnd(event: PointerEvent): void;
}

const styles = `
.midad-editing-overlay, .midad-editing-overlay > .midad-overlay-layer { display:contents; }
.midad-editing-overlay .native-input {
    position:fixed; left:0; top:0; z-index:4; width:1px; height:18px; padding:0;
    opacity:0.01; border:0; resize:none; pointer-events:none;
}
.midad-editing-overlay .native-caret {
    position:fixed; z-index:6; width:1.5px; background:var(--midad-caret-color,#1264a3); pointer-events:none;
}
.midad-editing-overlay .native-selection {
    position:fixed; top:0; left:0; contain:layout style paint; z-index:5;
    background:var(--midad-selection-color,#1264a338); pointer-events:none;
}
.midad-editing-overlay .native-find-match {
    position:fixed; z-index:6; pointer-events:none; background:#fbbf2455; border:1px solid #d9770680;
}
.midad-editing-overlay .native-find-match.is-current { background:#fb923c80; outline:1px solid #ea580c; }
.midad-editing-overlay .native-peer-selection, .midad-editing-overlay .native-peer-caret {
    position:fixed; z-index:7; pointer-events:none;
}
.midad-editing-overlay .native-peer-caret { width:0; border-inline-start:2px solid; }
.midad-editing-overlay .native-peer-caret > span {
    position:absolute; inset-inline-start:-2px; bottom:100%; max-width:180px; overflow:hidden;
    white-space:nowrap; text-overflow:ellipsis; color:white; padding:1px 4px; border-radius:3px; font-size:11px;
}
.midad-editing-overlay .native-review-highlight {
    position:fixed; z-index:2; pointer-events:none; background:#f59e0b30; border-bottom:1px solid #a16207;
}
.midad-editing-overlay .native-review-highlight.is-edit { background:#22c55e26; border-bottom-color:#15803d; }
.midad-editing-overlay .native-review-highlight.is-active { outline:2px solid #a16207; }
.midad-editing-overlay .native-live-template {
    position:fixed; pointer-events:none; z-index:25; background:#0ea5e91a; outline:1px dashed #0ea5e966;
}
.midad-editing-overlay .native-live-template.is-active { outline-color:#0ea5e9; }
.midad-editing-overlay .native-block-drop {
    position:fixed; z-index:12; height:3px; border-radius:2px; background:#1264a3; pointer-events:none;
}
.midad-editing-overlay .native-selection-handle {
    position:fixed; z-index:9; width:44px; height:44px; padding:8px 15px; border:0;
    background:transparent; touch-action:none; user-select:none;
}
.midad-editing-overlay .native-selection-handle span {
    display:block; width:14px; height:14px; border-radius:50%; background:#1264a3; box-shadow:0 0 0 2px white;
}`;

interface Layer {
    readonly element: HTMLDivElement;
    readonly nodes: Map<string, HTMLElement>;
}

export class EditingOverlayView {
    readonly element: HTMLDivElement;
    readonly input: HTMLTextAreaElement;
    private readonly layers = new Map<string, Layer>();
    private disposed = false;

    constructor(
        host: HTMLElement,
        frame: EditingOverlayFrame,
        private readonly events: EditingOverlayEvents,
    ) {
        const document = host.ownerDocument;
        this.element = document.createElement('div');
        this.element.className = 'midad-editing-overlay';
        const style = document.createElement('style');
        style.textContent = styles;
        this.input = document.createElement('textarea');
        this.input.className = 'native-input';
        this.input.setAttribute('wrap', 'off');
        this.element.append(style, this.input);
        this.listen(this.input, 'focus', events.focus);
        this.listen(this.input, 'blur', events.blur);
        this.listen(this.input, 'input', events.input);
        this.listen(this.input, 'beforeinput', events.beforeInput);
        this.listen(this.input, 'compositionstart', events.beforeInput);
        this.listen(this.input, 'compositionend', events.input);
        this.listen(this.input, 'keydown', events.key);
        this.listen(this.input, 'copy', events.copy);
        this.listen(this.input, 'cut', events.copy);
        this.listen(this.input, 'paste', events.paste);
        this.listen(this.input, 'select', events.select);
        this.update(frame);
        host.append(this.element);
    }

    update(frame: EditingOverlayFrame): void {
        if (this.disposed) return;
        const input = frame.input;
        this.input.setAttribute('aria-label', input.label);
        this.input.readOnly = input.readonly;
        this.input.dir = input.direction;
        this.input.style.left = `${input.position?.left ?? 0}px`;
        this.input.style.top = `${input.position?.top ?? 0}px`;
        this.input.setAttribute('aria-autocomplete', input.command ? 'list' : 'none');
        for (const [name, value] of [
            ['aria-haspopup', input.command ? 'listbox' : undefined],
            ['aria-controls', input.command?.listId],
            ['aria-activedescendant', input.command?.activeId],
        ]) {
            if (value === undefined) this.input.removeAttribute(name!);
            else this.input.setAttribute(name!, value);
        }
        this.draw(
            'selection',
            frame.selection.map((rect, index) => ({ key: String(index), rect })),
            (node, { rect }) => {
                node.className = `native-selection${frame.cells ? ' native-cell-selection' : ''}`;
                node.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
                node.style.width = `${rect.width}px`;
                node.style.height = `${rect.height}px`;
            },
        );
        this.draw(
            'find',
            frame.find.map((rect, index) => ({ key: String(index), rect })),
            (node, { rect }) => {
                node.className = `native-find-match${rect.active ? ' is-current' : ''}`;
                this.rectangle(node, rect);
            },
        );
        this.draw(
            'peers',
            frame.peers.flatMap((peer) => [
                ...peer.rectangles.map((rect, index) => ({
                    key: JSON.stringify([peer.id, index]),
                    peer,
                    rect,
                    caret: false,
                })),
                ...(peer.caret
                    ? [{ key: JSON.stringify([peer.id, 'caret']), peer, rect: peer.caret, caret: true }]
                    : []),
            ]),
            (node, { peer, rect, caret }) => {
                node.className = caret ? 'native-peer-caret' : 'native-peer-selection';
                this.rectangle(node, rect);
                if (!caret) node.style.backgroundColor = `${peer.color}33`;
                else {
                    node.dataset.peer = peer.id;
                    node.style.borderColor = peer.color;
                    if (!node.firstElementChild) node.append(node.ownerDocument.createElement('span'));
                    const label = node.firstElementChild as HTMLElement;
                    label.style.backgroundColor = peer.color;
                    label.textContent = peer.name;
                }
            },
        );
        this.draw(
            'reviews',
            frame.reviews.flatMap((review) =>
                review.rectangles.map((rect, index) => ({
                    key: JSON.stringify([review.id, index]),
                    review,
                    rect,
                })),
            ),
            (node, { review, rect }) => {
                node.className = 'native-review-highlight';
                if (review.active) node.classList.add('is-active');
                node.classList.add(`is-${review.kind.replace(/[^a-zA-Z0-9_-]/g, '')}`);
                node.dataset.reviewId = review.id;
                this.rectangle(node, rect);
            },
        );
        this.draw(
            'templates',
            frame.templates.map((rect, index) => ({ key: JSON.stringify([rect.id, index]), rect })),
            (node, { rect }) => {
                node.className = `native-live-template${rect.active ? ' is-active' : ''}`;
                node.dataset.templateId = rect.id;
                this.rectangle(node, rect);
            },
        );
        this.draw('drop', frame.drop ? [{ key: 'drop', ...frame.drop }] : [], (node, drop) => {
            node.className = 'native-block-drop';
            node.dataset.targetBlock = drop.blockId;
            node.dataset.side = drop.side;
            node.style.left = `${drop.left}px`;
            node.style.top = `${drop.top}px`;
            node.style.width = `${drop.width}px`;
        });
        this.draw(
            'handles',
            frame.handles.map((handle) => ({ key: handle.endpoint, ...handle })),
            (node, handle) => {
                node.className = 'native-selection-handle';
                node.dataset.endpoint = handle.endpoint;
                node.setAttribute('aria-label', frame.handleLabels[handle.endpoint]);
                node.style.left = `${handle.left - 22}px`;
                node.style.top = `${handle.top + handle.height - 8}px`;
            },
            (endpoint) => {
                const node = this.element.ownerDocument.createElement('button');
                node.type = 'button';
                node.tabIndex = -1;
                node.append(node.ownerDocument.createElement('span'));
                this.listen(node, 'pointerdown', (event) => {
                    event.preventDefault();
                    this.events.handleStart(event, endpoint as 'start' | 'end');
                });
                this.listen(node, 'pointermove', (event) => {
                    event.preventDefault();
                    this.events.handleMove(event);
                });
                for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
                    this.listen(node, event, this.events.handleEnd);
                return node;
            },
        );
        this.draw('caret', frame.caret ? [{ key: 'caret', ...frame.caret }] : [], (node, rect) => {
            node.className = 'native-caret';
            this.rectangle(node, rect);
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.element.remove();
        this.layers.clear();
    }

    private listen<K extends keyof HTMLElementEventMap>(
        element: HTMLElement,
        type: K,
        action: (event: HTMLElementEventMap[K]) => void,
    ): void {
        element.addEventListener(type, (event) => {
            if (!this.disposed) action(event);
        });
    }

    private rectangle(node: HTMLElement, rect: OverlayCaret & { readonly width?: number }): void {
        node.style.left = `${rect.left}px`;
        node.style.top = `${rect.top}px`;
        node.style.height = `${rect.height}px`;
        if (rect.width !== undefined) node.style.width = `${rect.width}px`;
    }

    private draw<T extends { readonly key: string }>(
        name: string,
        items: readonly T[],
        paint: (node: HTMLElement, item: T) => void,
        create?: (key: string) => HTMLElement,
    ): void {
        let layer = this.layers.get(name);
        if (!layer) {
            const element = this.element.ownerDocument.createElement('div');
            element.className = 'midad-overlay-layer';
            layer = { element, nodes: new Map() };
            this.layers.set(name, layer);
            this.element.append(element);
        }
        const active = new Set<string>();
        for (const item of items) {
            active.add(item.key);
            let node = layer.nodes.get(item.key);
            if (!node) {
                node = create?.(item.key) ?? this.element.ownerDocument.createElement('span');
                if (!create) node.setAttribute('aria-hidden', 'true');
                layer.nodes.set(item.key, node);
                layer.element.append(node);
            }
            paint(node, item);
        }
        for (const [key, node] of layer.nodes)
            if (!active.has(key)) {
                node.remove();
                layer.nodes.delete(key);
            }
    }
}
