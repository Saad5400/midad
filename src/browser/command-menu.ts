export interface CommandMenuItem<Icon extends string = string> {
    readonly id: string;
    readonly label: string;
    readonly icon?: Icon;
    readonly badge?: string;
    readonly keywords?: readonly string[];
    readonly active?: boolean;
    readonly disabled?: boolean;
}
export interface CommandMenuGroup<T extends CommandMenuItem = CommandMenuItem> {
    readonly id: string;
    readonly label: string;
    readonly icon?: T['icon'];
    readonly items: readonly T[];
}
export function composeCommandMenu<T extends CommandMenuItem, U extends CommandMenuItem = T>(
    groups: readonly CommandMenuGroup<T>[],
    extensions: readonly CommandMenuGroup<U>[],
    options: { exclude?: readonly string[]; available?: (item: T | U) => boolean } = {},
): CommandMenuGroup<T | U>[] {
    const merged = new Map<string, { id: string; label: string; icon?: T['icon'] | U['icon']; items: (T | U)[] }>();
    for (const group of [...groups, ...extensions]) {
        let target = merged.get(group.id);
        if (!target) {
            target = { ...group, items: [] };
            merged.set(group.id, target);
        }
        for (const item of group.items) {
            if (target.items.some((current) => current.id === item.id))
                throw new Error(`Duplicate command: ${group.id}/${item.id}`);
            target.items.push(item);
        }
    }
    const excluded = new Set(options.exclude ?? []);
    return [...merged.values()]
        .filter((group) => !excluded.has(group.id))
        .map((group) => ({
            ...group,
            items: group.items.filter((item) => !excluded.has(item.id) && (options.available?.(item) ?? true)),
        }))
        .filter((group) => group.items.length > 0);
}

export type CommandMenuRow<T extends CommandMenuItem> =
    | { readonly kind: 'group'; readonly key: string; readonly group: CommandMenuGroup<T> }
    | { readonly kind: 'item'; readonly key: string; readonly group: CommandMenuGroup<T>; readonly item: T };

const searchable = (value: string): string => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

export function searchCommandMenu<T extends CommandMenuItem>(
    groups: readonly CommandMenuGroup<T>[],
    query: string,
): CommandMenuRow<T>[] {
    const needle = searchable(query.trim());
    if (!needle) return [];
    return groups.flatMap((group) =>
        group.items
            .filter((item) =>
                [item.label, group.label, ...(item.keywords ?? [])].some((value) => searchable(value).includes(needle)),
            )
            .map((item) => ({ kind: 'item' as const, key: `${group.id}:${item.id}`, group, item })),
    );
}

export class CommandMenuController<T extends CommandMenuItem> {
    private groups: readonly CommandMenuGroup<T>[] = [];
    private query = '';
    private groupId?: string;
    private selected = 0;

    update(groups: readonly CommandMenuGroup<T>[], query = ''): void {
        const old = this.rows[this.selected]?.key;
        const changed = this.query !== query;
        this.groups = groups;
        this.query = query;
        if (!groups.some((group) => group.id === this.groupId)) this.groupId = undefined;
        const index = changed ? -1 : this.rows.findIndex((row) => row.key === old);
        this.selected = index >= 0 ? index : this.firstEnabled();
    }

    get activeGroup(): CommandMenuGroup<T> | undefined {
        return this.groups.find((group) => group.id === this.groupId);
    }
    get selectedIndex(): number {
        return this.selected;
    }
    get searching(): boolean {
        return !!this.query.trim();
    }
    get rows(): readonly CommandMenuRow<T>[] {
        if (this.searching) return searchCommandMenu(this.groups, this.query);
        const group = this.activeGroup;
        if (group) return group.items.map((item) => ({ kind: 'item', key: item.id, item, group }));
        return this.groups.map((group) => ({ kind: 'group', key: group.id, group }));
    }

    private enabled(row: CommandMenuRow<T> | undefined): boolean {
        return !!row && (row.kind === 'group' ? row.group.items.some((item) => !item.disabled) : !row.item.disabled);
    }
    private firstEnabled(): number {
        return Math.max(
            0,
            this.rows.findIndex((row) => this.enabled(row)),
        );
    }
    hover(index: number): void {
        if (this.enabled(this.rows[index])) this.selected = index;
    }
    move(delta: number): void {
        const rows = this.rows;
        for (let offset = 1; offset <= rows.length; offset++) {
            const index = (((this.selected + offset * delta) % rows.length) + rows.length) % rows.length;
            if (this.enabled(rows[index])) {
                this.selected = index;
                return;
            }
        }
    }
    back(): boolean {
        if (this.searching || !this.groupId) return false;
        const id = this.groupId;
        this.groupId = undefined;
        this.selected = Math.max(
            0,
            this.rows.findIndex((row) => row.group.id === id),
        );
        return true;
    }
    activate(index = this.selected): T | undefined {
        const row = this.rows[index];
        if (!row || !this.enabled(row)) return;
        if (row.kind === 'item') return row.item;
        this.groupId = row.group.id;
        this.selected = this.firstEnabled();
    }
    reset(): void {
        this.groupId = undefined;
        this.selected = this.firstEnabled();
    }
    key(
        event: { key: string; isComposing?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
        direction: 'rtl' | 'ltr',
    ): { handled: boolean; item?: T; dismiss?: boolean } {
        if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return { handled: false };
        if (event.key === 'Escape') return this.back() ? { handled: true } : { handled: true, dismiss: true };
        if (event.key === (direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft')) return { handled: this.back() };
        if (!this.rows.some((row) => this.enabled(row))) return { handled: false };
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            this.move(event.key === 'ArrowUp' ? -1 : 1);
            return { handled: true };
        }
        if (event.key === 'Home') {
            this.selected = this.firstEnabled();
            return { handled: true };
        }
        if (event.key === 'End') {
            this.selected = this.rows.length - 1;
            if (!this.enabled(this.rows[this.selected])) this.move(-1);
            return { handled: true };
        }
        if (event.key === 'Enter' || event.key === 'Tab') return { handled: true, item: this.activate() };
        if (
            event.key === (direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight') &&
            this.rows[this.selected]?.kind === 'group'
        ) {
            this.activate();
            return { handled: true };
        }
        return { handled: false };
    }
}
