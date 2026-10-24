const registrations = new WeakMap<Window, Map<string, Set<SurfaceShortcut>>>();
const listeners = new WeakMap<Window, Map<string, (event: KeyboardEvent) => void>>();

export class SurfaceShortcut {
    private readonly window;
    private disposed = false;
    private readonly activate = () => {
        const entries = registrations.get(this.window)?.get(this.code);
        entries?.delete(this);
        entries?.add(this);
    };

    constructor(
        private readonly root: HTMLElement,
        private readonly code: string,
        private readonly run: () => void,
        private readonly enabled: () => boolean = () => true,
    ) {
        const owner = root.ownerDocument.defaultView;
        if (!owner) throw new Error('Keyboard shortcuts require a browser window');
        this.window = owner;
        let groups = registrations.get(owner);
        if (!groups) registrations.set(owner, (groups = new Map()));
        let handlers = listeners.get(owner);
        if (!handlers) listeners.set(owner, (handlers = new Map()));
        let entries = groups.get(code);
        if (!entries) {
            entries = new Set();
            groups.set(code, entries);
            const key = (event: KeyboardEvent) => {
                if (event.defaultPrevented) return;
                const letter = code.slice(3).toLowerCase();
                if (
                    !(event.ctrlKey || event.metaKey) ||
                    event.altKey ||
                    event.shiftKey ||
                    event.isComposing ||
                    (event.code !== code && event.key.toLowerCase() !== letter)
                )
                    return;
                const available = [...(registrations.get(owner)?.get(code) ?? [])].filter((entry) => entry.available());
                const focused = available.filter((entry) => {
                    const tree = entry.root.getRootNode() as Document | ShadowRoot;
                    return entry.root.contains(tree.activeElement ?? owner.document.activeElement);
                });
                const selected = focused.at(-1) ?? available.at(-1);
                if (!selected) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                if (!event.repeat) selected.run();
            };
            handlers.set(code, key);
            owner.addEventListener('keydown', key, true);
        }
        entries.add(this);
        root.addEventListener('focusin', this.activate, true);
        root.addEventListener('pointerdown', this.activate, true);
    }

    private available(): boolean {
        if (this.disposed || !this.enabled() || !this.root.isConnected || !this.root.getClientRects().length)
            return false;
        let ancestor: Element | null = this.root;
        while (ancestor) {
            if (ancestor.matches('[inert],[hidden],[aria-hidden="true"]')) return false;
            ancestor = ancestor.parentElement ?? (ancestor.getRootNode() as ShadowRoot).host ?? null;
        }
        return true;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.root.removeEventListener('focusin', this.activate, true);
        this.root.removeEventListener('pointerdown', this.activate, true);
        const entries = registrations.get(this.window)?.get(this.code);
        entries?.delete(this);
        if (entries?.size) return;
        const listener = listeners.get(this.window)?.get(this.code);
        if (listener) this.window.removeEventListener('keydown', listener, true);
        registrations.get(this.window)?.delete(this.code);
        listeners.get(this.window)?.delete(this.code);
    }
}
