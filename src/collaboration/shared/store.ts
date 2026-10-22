import * as Y from 'yjs';
import type { Json } from '../../document/model.js';
import type { Edge, Parent, SharedType, FlowSegment } from './schema.js';

export class SharedStore {
    readonly registry: Y.Map<string>;
    readonly meta: Y.Map<Json>;
    readonly flows: Y.Map<string>;
    readonly families: Y.Map<string>;
    readonly deleted: Y.Map<boolean>;
    private readonly types = new Map<string, SharedType>();
    private unregistered: SharedType[] = [];
    seeding = false;
    private flowCache = new Map<string, Map<string, FlowSegment>>();
    private edgeCache?: Map<string, Parent & { id: string }>;
    private parentCache?: Map<string, Parent & { id: string }>;
    private placementClock = 0;
    placementReady = false;

    constructor(readonly ydoc: Y.Doc) {
        this.registry = ydoc.getMap('nodes');
        this.meta = ydoc.getMap('native');
        this.flows = ydoc.getMap('flows');
        this.families = ydoc.getMap('families');
        this.deleted = ydoc.getMap('deleted');
    }
    clear(): void {
        this.types.clear();
        this.invalidateCaches();
    }
    private typed<T extends SharedType>(name: string, create: () => T): T {
        let type = this.types.get(name);
        if (!type) {
            type = create();
            this.types.set(name, type);
            this.unregistered.push(type);
        }
        return type as T;
    }
    registerTypes(undoManager: Y.UndoManager): void {
        if (!this.unregistered.length) return;
        undoManager.addToScope(this.unregistered);
        this.unregistered = [];
    }
    attributes(address: string): Y.Map<Json> {
        return this.typed(`a:${address}`, () => this.ydoc.getMap<Json>(`a:${address}`));
    }
    children(container: string): Y.Array<Edge> {
        return this.typed(`c:${container}`, () => this.ydoc.getArray<Edge>(`c:${container}`));
    }
    source(address: string): string {
        return this.flows.get(address) ?? address;
    }
    invalidateCaches(): void {
        this.flowCache.clear();
        this.edgeCache = undefined;
        this.parentCache = undefined;
    }
    private physicalEdges(): Map<string, Parent & { id: string }> {
        if (this.edgeCache) return this.edgeCache;
        const edges = new Map<string, Parent & { id: string }>(),
            parents = new Map<string, Parent & { id: string }>();
        const add = (entry: Edge, container: string): void => {
            const rank = Number.isSafeInteger(entry.rank) ? entry.rank! : 0,
                actor = Number.isSafeInteger(entry.actor) ? entry.actor! : 0;
            const edge = { ...entry, rank, actor, container };
            edges.set(entry.edge, edge);
            this.placementClock = Math.max(this.placementClock, rank);
            const previous = parents.get(entry.id);
            if (
                !previous ||
                rank > previous.rank! ||
                (rank === previous.rank &&
                    (actor > previous.actor! || (actor === previous.actor && entry.edge > previous.edge)))
            )
                parents.set(entry.id, edge);
        };
        for (const name of this.ydoc.share.keys()) {
            if (name.startsWith('c:'))
                for (const entry of this.ydoc.getArray<Edge>(name).toArray()) add(entry, name.slice(2));
            if (name.startsWith('t:'))
                for (const delta of this.ydoc.getText(name).toDelta())
                    if (
                        delta.insert &&
                        typeof delta.insert === 'object' &&
                        typeof delta.insert.node === 'string' &&
                        typeof delta.insert.edge === 'string'
                    )
                        add({ ...delta.insert, id: delta.insert.node }, `inline:${name.slice(2)}`);
        }
        this.edgeCache = edges;
        this.parentCache = parents;
        this.placementReady = true;
        return edges;
    }
    effectiveParent(id: string): Parent | undefined {
        if (this.deleted.get(id)) return;
        this.physicalEdges();
        return this.parentCache!.get(id);
    }
    placement(): Omit<Edge, 'id'> {
        if (!this.seeding && !this.placementReady) this.physicalEdges();
        return { edge: crypto.randomUUID(), rank: ++this.placementClock, actor: this.ydoc.clientID };
    }
    inline(address: string): Y.Text {
        const source = this.source(address);
        return this.typed(`t:${source}`, () => this.ydoc.getText(`t:${source}`));
    }
    bounds(address: string): { start: number; end: number } {
        const segment = this.flow(address);
        return { start: segment.start, end: segment.end };
    }
    flow(address: string): FlowSegment {
        const source = this.source(address);
        let flows = this.flowCache.get(source);
        if (!flows) {
            flows = new Map();
            let offset = 0,
                current: FlowSegment = { start: 0, end: 0, parts: [] };
            flows.set(source, current);
            for (const delta of this.inline(address).toDelta()) {
                const length = typeof delta.insert === 'string' ? delta.insert.length : 1;
                if (typeof delta.insert === 'object' && typeof delta.insert?.block === 'string') {
                    current.end = offset;
                    current = { start: offset + 1, end: offset + 1, parts: [] };
                    flows.set(delta.insert.block, current);
                } else current.parts.push({ ...delta, from: offset });
                offset += length;
            }
            current.end = offset;
            this.flowCache.set(source, flows);
        }
        const segment = flows.get(address);
        if (!segment) throw new Error('The shared paragraph boundary is missing');
        return segment;
    }
    visibleEmbed(address: string, insert: unknown): insert is { node: string; edge: string } {
        if (
            !insert ||
            typeof insert !== 'object' ||
            !('node' in insert) ||
            !('edge' in insert) ||
            typeof insert.node !== 'string' ||
            typeof insert.edge !== 'string'
        )
            return false;
        const parent = this.effectiveParent(insert.node);
        return parent?.container === `inline:${this.source(address)}` && parent.edge === insert.edge;
    }
    physicalOffset(address: string, logical: number): number {
        const range = this.bounds(address);
        for (const delta of this.flow(address).parts) {
            const physical = delta.from;
            const length = typeof delta.insert === 'string' ? delta.insert.length : 1;
            const from = Math.max(physical, range.start),
                to = Math.min(physical + length, range.end);
            if (from >= to || (typeof delta.insert !== 'string' && !this.visibleEmbed(address, delta.insert))) continue;
            if (logical <= to - from) return from + logical;
            logical -= to - from;
        }
        if (logical) throw new Error('Invalid shared text offset');
        return range.end;
    }
    logicalOffset(address: string, position: number): number {
        const range = this.bounds(address);
        let logical = 0;
        for (const delta of this.flow(address).parts) {
            const physical = delta.from;
            const length = typeof delta.insert === 'string' ? delta.insert.length : 1;
            const from = Math.max(physical, range.start),
                to = Math.min(physical + length, range.end, position);
            if (from < to && (typeof delta.insert === 'string' || this.visibleEmbed(address, delta.insert)))
                logical += to - from;
        }
        return logical;
    }
    deleteInline(address: string, index: number, length: number): void {
        const from = this.physicalOffset(address, index),
            to = this.physicalOffset(address, index + length);
        const ranges: Array<{ from: number; length: number }> = [];
        for (const delta of this.flow(address).parts) {
            const physical = delta.from;
            const size = typeof delta.insert === 'string' ? delta.insert.length : 1;
            const start = Math.max(from, physical),
                end = Math.min(to, physical + size);
            if (start >= end) continue;
            if (typeof delta.insert !== 'string') {
                if (!this.visibleEmbed(address, delta.insert)) continue;
            }
            ranges.push({ from: start, length: end - start });
        }
        ranges.reverse().forEach((range) => this.inline(address).delete(range.from, range.length));
        this.invalidateCaches();
    }
    activeChildren(container: string): Edge[] {
        const entries = this.children(container)
            .toArray()
            .filter((entry) => {
                const parent = this.effectiveParent(entry.id);
                return parent?.container === container && parent.edge === entry.edge;
            });
        const groups = new Map<string, number[]>();
        entries.forEach((entry, index) => {
            const family = this.families.get(entry.id) ?? entry.id;
            const group = groups.get(family) ?? [];
            group.push(index);
            groups.set(family, group);
        });
        for (const indices of groups.values())
            if (indices.length > 1) {
                const sorted = indices
                    .map((index) => entries[index])
                    .sort((a, b) => this.bounds(a.id).start - this.bounds(b.id).start);
                indices.forEach((index, offset) => {
                    entries[index] = sorted[offset];
                });
            }
        return entries;
    }
}
