const registrations = new WeakMap<Window, Set<PrintShortcut>>();
const listeners = new WeakMap<Window, (event: KeyboardEvent) => void>();

export class PrintShortcut {
    private readonly window;
    private disposed = false;
    private readonly activate = () => {
        const entries = registrations.get(this.window);
        entries?.delete(this);
        entries?.add(this);
    };

    constructor(
        private readonly root: HTMLElement,
        private readonly print: () => void,
    ) {
        const owner = root.ownerDocument.defaultView;
        if (!owner) throw new Error('Printing requires a browser window');
        this.window = owner;
        let entries = registrations.get(owner);
        if (!entries) {
            entries = new Set();
            registrations.set(owner, entries);
            const key = (event: KeyboardEvent) => {
                if (event.defaultPrevented) return;
                const letter = event.code === 'KeyP' ? 'p' : event.key.toLowerCase();
                if (
                    !(event.ctrlKey || event.metaKey) ||
                    event.altKey ||
                    event.shiftKey ||
                    event.isComposing ||
                    letter !== 'p'
                )
                    return;
                const available = [...(registrations.get(owner) ?? [])].filter((entry) => entry.available());
                const focused = available.filter((entry) => {
                    const tree = entry.root.getRootNode() as Document | ShadowRoot;
                    return entry.root.contains(tree.activeElement ?? owner.document.activeElement);
                });
                const selected = focused.at(-1) ?? available.at(-1);
                if (!selected) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                if (!event.repeat) selected.print();
            };
            listeners.set(owner, key);
            owner.addEventListener('keydown', key, true);
        }
        entries.add(this);
        root.addEventListener('focusin', this.activate, true);
        root.addEventListener('pointerdown', this.activate, true);
    }

    private available(): boolean {
        if (this.disposed || !this.root.isConnected || !this.root.getClientRects().length) return false;
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
        const entries = registrations.get(this.window);
        entries?.delete(this);
        if (entries?.size) return;
        const listener = listeners.get(this.window);
        if (listener) this.window.removeEventListener('keydown', listener, true);
        registrations.delete(this.window);
        listeners.delete(this.window);
    }
}
