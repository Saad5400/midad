import * as Y from 'yjs';
import type { Json } from '../../document/model.js';
import type { Edge, Parent, SharedType, FlowSegment, FlowPart, Joined } from './schema.js';
import { key } from './schema.js';

interface FlowTrail {
    parent?: FlowTrail;
    block: string;
    edge: string;
}

interface RelativeCache {
    positions: Map<number, Y.RelativePosition>;
    observe: (event: Y.YTextEvent) => void;
}

export class SharedStore {
    readonly registry: Y.Map<string>;
    readonly meta: Y.Map<Json>;
    readonly flows: Y.Map<string>;
    readonly families: Y.Map<string>;
    readonly deleted: Y.Map<boolean | Joined>;
    private readonly types = new Map<string, SharedType>();
    private unregistered: SharedType[] = [];
    seeding = false;
    private flowCache = new Map<string, Map<string, FlowSegment>>();
    private edgeCache?: Map<string, Parent & { id: string }>;
    private parentCache?: Map<string, Parent & { id: string }>;
    private joinOwners = new Map<string, string>();
    private readonly resolvedOwners = new Map<string, string>();
    private placementClock = 0;
    private readonly relativeCache = new Map<Y.Text, RelativeCache>();
    placementReady = false;

    constructor(readonly ydoc: Y.Doc) {
        this.registry = ydoc.getMap('nodes');
        this.meta = ydoc.getMap('native');
        this.flows = ydoc.getMap('flows');
        this.families = ydoc.getMap('families');
        this.deleted = ydoc.getMap('deleted');
    }
    clear(): void {
        for (const [text, cache] of this.relativeCache) text.unobserve(cache.observe);
        this.relativeCache.clear();
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
        this.resolvedOwners.clear();
        this.edgeCache = undefined;
        this.parentCache = undefined;
    }
    private physicalEdges(): Map<string, Parent & { id: string }> {
        if (this.edgeCache) return this.edgeCache;
        const edges = new Map<string, Parent & { id: string }>(),
            parents = new Map<string, Parent & { id: string }>();
        this.joinOwners.clear();
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
            if (name.startsWith('t:')) {
                let block = name.slice(2);
                for (const delta of this.ydoc.getText(name).toDelta()) {
                    if (delta.insert && typeof delta.insert === 'object') {
                        if (typeof delta.insert.block === 'string') block = delta.insert.block;
                        if (typeof delta.insert.join === 'string' && this.activeJoin(delta.insert))
                            this.joinOwners.set(delta.insert.join, block);
                        if (typeof delta.insert.node === 'string' && typeof delta.insert.edge === 'string')
                            add({ ...delta.insert, id: delta.insert.node }, `inline:${name.slice(2)}`);
                    }
                }
            }
        }
        this.edgeCache = edges;
        this.parentCache = parents;
        this.placementReady = true;
        return edges;
    }
    effectiveParent(id: string): Parent | undefined {
        if (this.deleted.get(id) === true || this.joinedOwner(id) !== id) return;
        return this.physicalParent(id);
    }
    physicalParent(id: string): Parent | undefined {
        this.physicalEdges();
        return this.parentCache!.get(id);
    }
    joinedOwner(address: string): string {
        this.physicalEdges();
        const chain = new Map<string, Joined & { target: string }>();
        const initial = address;
        const finish = (owner: string): string => {
            this.resolvedOwners.set(initial, owner);
            for (const member of chain.keys()) this.resolvedOwners.set(member, owner);
            return owner;
        };
        while (true) {
            const resolved = this.resolvedOwners.get(address);
            if (resolved !== undefined) return finish(resolved);
            const entry = this.deleted.get(address);
            if (!entry || typeof entry !== 'object') return finish(address);
            if (chain.has(address)) {
                const cycle: Array<Joined & { target: string }> = [];
                const start = address;
                do {
                    const value = chain.get(address)!;
                    cycle.push(value);
                    address = value.target;
                } while (address !== start);
                cycle.sort(
                    (a, b) =>
                        b.rank - a.rank || b.actor - a.actor || (a.edge === b.edge ? 0 : a.edge > b.edge ? -1 : 1),
                );
                return finish(cycle[0].target);
            }
            if (chain.size > 100000) throw new Error('Invalid shared join structure');
            const target = this.joinOwners.get(address) ?? entry.join;
            chain.set(address, { ...entry, target });
            address = target;
        }
    }
    activeJoin(insert: { join?: string; edge?: string }): boolean {
        const entry = insert.join && this.deleted.get(insert.join);
        return !!entry && typeof entry === 'object' && entry.edge === insert.edge;
    }
    join(left: string, right: string, _offset: number): void {
        const point = this.endPoint(left);
        const placement = this.placement();
        this.deleted.set(right, { join: left, edge: placement.edge, rank: placement.rank!, actor: placement.actor! });
        point.text.insertEmbed(this.flow(point.block).append, { join: right, edge: placement.edge });
        this.invalidateCaches();
    }
    placement(): Omit<Edge, 'id'> {
        if (!this.seeding && !this.placementReady) this.physicalEdges();
        return { edge: crypto.randomUUID(), rank: ++this.placementClock, actor: this.ydoc.clientID };
    }
    inline(address: string): Y.Text {
        const source = this.source(address);
        return this.typed(`t:${source}`, () => this.ydoc.getText(`t:${source}`));
    }
    relativePosition(address: string, index: number): Y.RelativePosition {
        const text = this.inline(address);
        let cache = this.relativeCache.get(text);
        if (!cache) {
            const created: RelativeCache = {
                positions: new Map(),
                observe: (event) => {
                    const delta = event.delta;
                    if (!delta.some((part) => part.insert !== undefined || part.delete !== undefined)) return;
                    const ranges: Array<{ start: number; end: number; shift: number }> = [];
                    let previous = 0,
                        current = 0;
                    for (const part of delta) {
                        if (part.retain) {
                            ranges.push({ start: previous, end: previous + part.retain, shift: current - previous });
                            previous += part.retain;
                            current += part.retain;
                        }
                        if (part.delete) previous += part.delete;
                        if (part.insert !== undefined)
                            current += typeof part.insert === 'string' ? part.insert.length : 1;
                    }
                    ranges.push({ start: previous, end: Infinity, shift: current - previous });
                    const positions = new Map<number, Y.RelativePosition>();
                    for (const [offset, relative] of created.positions) {
                        const range = ranges.find((entry) => offset >= entry.start && offset < entry.end);
                        if (range) positions.set(offset + range.shift, relative);
                    }
                    created.positions = positions;
                },
            };
            cache = created;
            this.relativeCache.set(text, cache);
            text.observe(cache.observe);
        }
        let relative = cache.positions.get(index);
        if (!relative) {
            relative = Y.createRelativePositionFromTypeIndex(text, index);
            cache.positions.set(index, relative);
        }
        return relative;
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
                current: FlowSegment = { start: 0, end: 0, append: 0, parts: [] },
                ended = false;
            flows.set(source, current);
            for (const delta of this.inline(address).toDelta()) {
                const length = typeof delta.insert === 'string' ? delta.insert.length : 1;
                if (typeof delta.insert === 'object' && typeof delta.insert?.block === 'string') {
                    current.append = offset;
                    if (!ended) current.end = offset;
                    current = { start: offset + 1, end: offset + 1, append: offset + 1, parts: [] };
                    ended = false;
                    flows.set(delta.insert.block, current);
                } else if (typeof delta.insert === 'object' && delta.insert?.end === true) {
                    if (!ended) current.end = offset;
                    ended = true;
                } else current.parts.push({ ...delta, from: offset });
                offset += length;
            }
            current.append = offset;
            if (!ended) current.end = offset;
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
    parts(
        address: string,
        seen = new Set<string>(),
        trail?: FlowTrail,
    ): Array<FlowPart & { source: string; block: string; trail?: FlowTrail }> {
        if (seen.has(address)) return [];
        if (seen.size > 100000) throw new Error('Invalid shared text structure');
        seen.add(address);
        return this.flow(address).parts.flatMap((part) =>
            typeof part.insert === 'object' && typeof part.insert.join === 'string'
                ? this.activeJoin(part.insert)
                    ? this.parts(part.insert.join, seen, { parent: trail, block: address, edge: part.insert.edge! })
                    : []
                : [{ ...part, source: this.source(address), block: address, trail }],
        );
    }
    length(address: string): number {
        return this.parts(address).reduce(
            (length, part) =>
                length +
                (typeof part.insert === 'string'
                    ? part.insert.length
                    : this.visibleEmbed(part.source, part.insert)
                      ? 1
                      : 0),
            0,
        );
    }
    point(
        address: string,
        logical: number,
    ): { text: Y.Text; index: number; source: string; block: string; trail?: FlowTrail } {
        for (const part of this.parts(address)) {
            const length =
                typeof part.insert === 'string'
                    ? part.insert.length
                    : this.visibleEmbed(part.source, part.insert)
                      ? 1
                      : 0;
            if (!length) continue;
            if (logical <= length)
                return {
                    text: this.inline(part.source),
                    index: part.from + logical,
                    source: part.source,
                    block: part.block,
                    trail: part.trail,
                };
            logical -= length;
        }
        if (logical) throw new Error('Invalid shared text offset');
        return {
            text: this.inline(address),
            index: this.bounds(address).end,
            source: this.source(address),
            block: address,
        };
    }
    endPoint(address: string): { text: Y.Text; index: number; source: string; block: string; trail?: FlowTrail } {
        const seen = new Set<string>();
        let trail: FlowTrail | undefined;
        while (!seen.has(address)) {
            seen.add(address);
            const parts = this.flow(address).parts;
            const last = parts.findLast(
                (part) =>
                    typeof part.insert === 'string' ||
                    this.visibleEmbed(address, part.insert) ||
                    (typeof part.insert.join === 'string' && this.activeJoin(part.insert)),
            );
            if (
                last &&
                typeof last.insert === 'object' &&
                typeof last.insert.join === 'string' &&
                !seen.has(last.insert.join)
            ) {
                trail = { parent: trail, block: address, edge: last.insert.edge! };
                address = last.insert.join;
                continue;
            }
            return {
                text: this.inline(address),
                index: this.bounds(address).end,
                source: this.source(address),
                block: address,
                trail,
            };
        }
        throw new Error('Invalid shared text endpoint');
    }
    continueSplit(trail: FlowTrail | undefined, suffix: string): void {
        for (; trail; trail = trail.parent) {
            const range = this.flow(trail.block);
            const reference = range.parts.find(
                (part) =>
                    typeof part.insert === 'object' &&
                    part.insert.edge === trail!.edge &&
                    typeof part.insert.join === 'string',
            );
            if (!reference || reference.from + 1 >= range.append) continue;
            const address = key('', `shared-tail:${crypto.randomUUID()}`);
            this.flows.set(address, this.source(trail.block));
            this.families.set(address, this.families.get(trail.block) ?? trail.block);
            this.inline(trail.block).insertEmbed(reference.from + 1, { block: address });
            this.inline(trail.block).insertEmbed(reference.from + 2, { end: true });
            this.invalidateCaches();
            this.join(suffix, address, this.length(suffix));
        }
    }
    locate(address: string, text: Y.Text, position: number, seen = new Set<string>()): number | undefined {
        if (seen.has(address)) return;
        seen.add(address);
        const source = this.inline(address),
            range = this.bounds(address);
        let logical = 0;
        for (const part of this.flow(address).parts) {
            if (text === source && position >= range.start && position <= part.from) return logical;
            if (typeof part.insert === 'object' && typeof part.insert.join === 'string') {
                if (text === source && position >= part.from && position <= part.from + 1) return logical;
                if (!this.activeJoin(part.insert)) continue;
                const nested = this.locate(part.insert.join, text, position, new Set(seen));
                if (nested !== undefined) return logical + nested;
                logical += this.length(part.insert.join);
            } else {
                const length =
                    typeof part.insert === 'string'
                        ? part.insert.length
                        : this.visibleEmbed(address, part.insert)
                          ? 1
                          : 0;
                if (text === source && position >= part.from && position <= part.from + length)
                    return logical + position - part.from;
                logical += length;
            }
        }
        if (text === source && position >= range.start && position <= range.end) return logical;
    }
    insertText(address: string, offset: number, value: string, attributes: Record<string, Json>): void {
        const point = this.point(address, offset);
        point.text.insert(point.index, value, attributes);
        this.invalidateCaches();
    }
    insertEmbed(address: string, offset: number, value: Record<string, Json>, attributes?: Record<string, Json>): void {
        const point = this.point(address, offset);
        point.text.insertEmbed(point.index, value, attributes);
        this.invalidateCaches();
    }
    private ranges(
        address: string,
        offset: number,
        length: number,
    ): Array<{ text: Y.Text; from: number; length: number }> {
        const ranges: Array<{ text: Y.Text; from: number; length: number }> = [];
        for (const part of this.parts(address)) {
            const size =
                typeof part.insert === 'string'
                    ? part.insert.length
                    : this.visibleEmbed(part.source, part.insert)
                      ? 1
                      : 0;
            if (offset >= size) {
                offset -= size;
                continue;
            }
            const take = Math.min(length, size - offset);
            ranges.push({ text: this.inline(part.source), from: part.from + offset, length: take });
            offset = 0;
            length -= take;
            if (!length) break;
        }
        if (length) throw new Error('Invalid shared text range');
        return ranges;
    }
    formatInline(address: string, offset: number, length: number, patch: Record<string, Json>): void {
        for (const range of this.ranges(address, offset, length)) range.text.format(range.from, range.length, patch);
        this.invalidateCaches();
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
        const ranges = this.ranges(address, index, length);
        ranges.sort((a, b) => b.from - a.from).forEach((range) => range.text.delete(range.from, range.length));
        this.invalidateCaches();
    }
    activeChildren(container: string): Edge[] {
        const entries = this.children(container)
            .toArray()
            .filter((entry) => {
                const parent = this.effectiveParent(entry.id);
                return parent?.container === container && parent.edge === entry.edge;
            });
        const groups = new Map<string, string[]>();
        entries.forEach((entry) => {
            const family = this.joinedOwner(this.families.get(entry.id) ?? entry.id);
            const group = groups.get(family) ?? [];
            group.push(entry.id);
            groups.set(family, group);
        });
        const depth = (family: string): number => {
            const seen = new Set<string>();
            while (!seen.has(family)) {
                seen.add(family);
                const parent = this.families.get(family);
                if (!parent || parent === family) break;
                family = parent;
            }
            return seen.size;
        };
        for (const [family, ids] of [...groups].sort(([a], [b]) => depth(a) - depth(b))) {
            const anchor = entries.find((entry) => entry.id === this.joinedOwner(family));
            if (anchor && (ids.length > 1 || !ids.includes(anchor.id))) {
                const members = new Set(ids);
                const sorted = entries.filter((entry) => members.has(entry.id) && entry !== anchor);
                const sources = new Map<string, number[]>();
                sorted.forEach((entry, index) => {
                    const source = this.source(entry.id);
                    sources.set(source, [...(sources.get(source) ?? []), index]);
                });
                for (const indices of sources.values()) {
                    const sourceOrder = indices
                        .map((index) => sorted[index])
                        .sort((a, b) => this.bounds(a.id).start - this.bounds(b.id).start);
                    indices.forEach((index, offset) => (sorted[index] = sourceOrder[offset]));
                }
                if (members.has(anchor.id)) sorted.unshift(anchor);
                const index = entries.indexOf(anchor);
                const insertion = entries
                    .slice(0, index + (members.has(anchor.id) ? 0 : 1))
                    .filter((entry) => !members.has(entry.id)).length;
                const remaining = entries.filter((entry) => !members.has(entry.id));
                remaining.splice(insertion, 0, ...sorted);
                entries.splice(0, entries.length, ...remaining);
            } else if (ids.length > 1) {
                const indices = entries.flatMap((entry, index) => (ids.includes(entry.id) ? [index] : []));
                const sorted = indices
                    .map((index) => entries[index])
                    .sort((a, b) => this.bounds(a.id).start - this.bounds(b.id).start);
                indices.forEach((index, offset) => (entries[index] = sorted[offset]));
            }
        }
        return entries;
    }
}
