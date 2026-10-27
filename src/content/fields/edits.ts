import type { FieldDraft } from './commands.js';

export type FieldPatch = Partial<FieldDraft>;

export function mergeFieldPatch(first: FieldPatch, next: FieldPatch): FieldPatch {
    return {
        ...first,
        ...next,
        ...(first.settings || next.settings ? { settings: { ...first.settings, ...next.settings } } : {}),
    };
}

export class FieldEditQueue {
    private readonly pending = new Map<string, FieldPatch>();
    private current?: { id: string; patch: FieldPatch };
    private task?: Promise<void>;

    constructor(
        private readonly apply: (id: string, patch: FieldPatch) => Promise<void>,
        private readonly changed: () => void,
    ) {}

    get dirty(): boolean {
        return !!this.current || this.pending.size > 0;
    }

    patch(id: string): FieldPatch | undefined {
        const current = this.current?.id === id ? this.current.patch : undefined;
        const pending = this.pending.get(id);
        return current || pending ? mergeFieldPatch(current ?? {}, pending ?? {}) : undefined;
    }

    enqueue(id: string, patch: FieldPatch): void {
        this.pending.set(id, mergeFieldPatch(this.pending.get(id) ?? {}, JSON.parse(JSON.stringify(patch))));
        this.changed();
    }

    flush(): Promise<void> {
        if (!this.task) {
            this.task = this.drain().finally(() => {
                this.task = undefined;
                this.changed();
            });
        }
        return this.task;
    }

    private async drain(): Promise<void> {
        while (this.pending.size) {
            const [id, patch] = this.pending.entries().next().value!;
            this.pending.delete(id);
            this.current = { id, patch };
            this.changed();
            try {
                await this.apply(id, patch);
            } catch (error) {
                this.pending.set(id, mergeFieldPatch(patch, this.pending.get(id) ?? {}));
                throw error;
            } finally {
                this.current = undefined;
                this.changed();
            }
        }
    }
}

export function fieldDetailsPatch(previous: FieldDraft, next: FieldDraft): FieldPatch {
    const patch: Record<string, unknown> = {};
    for (const key of ['name', 'description', 'type', 'value', 'participant_id'] as const)
        if (previous[key] !== next[key]) patch[key] = next[key] ?? '';
    const settings = Object.fromEntries(
        Object.entries(next.settings ?? {}).filter(
            ([key, value]) => JSON.stringify(value) !== JSON.stringify(previous.settings?.[key]),
        ),
    );
    if (Object.keys(settings).length) patch.settings = settings;
    return patch as FieldPatch;
}
