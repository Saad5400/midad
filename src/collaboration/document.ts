import { diffArrays } from 'diff';
import * as Y from 'yjs';
import { activeClauseVariant, clauseVariants } from '../content/clauses/commands.js';
import { exportDocument, importDocument } from '../document/codec.js';
import { persistNativeIdentities } from '../document/identities.js';
import {
    copyJson,
    isRecord,
    type Attributes,
    type Json,
    type NativeDocument,
    type NativeMark,
    type NativeNode,
} from '../document/model.js';
import { blockText, isTextBlock, textBlocks, type TextCaret } from '../editing/text.js';
import {
    canonicalSharedJson,
    encodeSharedBytes,
    nativeSharedMarks,
    readSharedAttributes,
    sharedTextAttributes,
    writeSharedAttributes,
} from './values.js';

interface Edge {
    readonly id: string;
    readonly edge: string;
    readonly rank?: number;
    readonly actor?: number;
}
interface Parent {
    readonly container: string;
    readonly edge: string;
    readonly rank?: number;
    readonly actor?: number;
}
type SharedType = Y.Map<Json> | Y.Array<Edge> | Y.Text;
interface InlineToken {
    readonly insert: string | { node: string };
    readonly attributes: Record<string, Json>;
    readonly signature: string;
}
interface FlowPart {
    insert: string | { node?: string; edge?: string; block?: string };
    attributes?: Record<string, Json>;
    from: number;
}
interface FlowSegment {
    start: number;
    end: number;
    parts: FlowPart[];
}
export interface SharedCaret {
    readonly block: string;
    readonly position: Uint8Array;
}
const LOCAL = Symbol('native-local'),
    REMOTE = Symbol('native-remote'),
    SEED = Symbol('native-seed');
const key = (scope: string, id: string): string => JSON.stringify([scope, id]);
const identity = (address: string): string => {
    const value: unknown = JSON.parse(address);
    if (!Array.isArray(value) || value.length !== 2 || value.some((part) => typeof part !== 'string'))
        throw new Error('Invalid shared node identity');
    return value[1];
};

export class SharedNativeDocument {
    readonly ydoc: Y.Doc;
    readonly undoManager: Y.UndoManager;
    private readonly registry: Y.Map<string>;
    private readonly meta: Y.Map<Json>;
    private readonly flows: Y.Map<string>;
    private readonly families: Y.Map<string>;
    private readonly deleted: Y.Map<boolean>;
    private readonly types = new Map<string, SharedType>();
    private unregistered: SharedType[] = [];
    private view: NativeDocument;
    private closed = false;
    private seeding = false;
    private skipInline = new Set<string>();
    private previousNodes = new Map<string, NativeNode>();
    private flowCache = new Map<string, Map<string, FlowSegment>>();
    private edgeCache?: Map<string, Parent & { id: string }>;
    private parentCache?: Map<string, Parent & { id: string }>;
    private placementClock = 0;
    private placementReady = false;

    private constructor(document: NativeDocument, state?: Uint8Array) {
        this.ydoc = new Y.Doc();
        this.registry = this.ydoc.getMap('nodes');
        this.meta = this.ydoc.getMap('native');
        this.flows = this.ydoc.getMap('flows');
        this.families = this.ydoc.getMap('families');
        this.deleted = this.ydoc.getMap('deleted');
        this.undoManager = new Y.UndoManager([this.registry, this.flows, this.families, this.deleted], {
            trackedOrigins: new Set([LOCAL]),
            captureTimeout: 500,
        });
        this.view = document;
        this.ydoc.on('afterTransaction', (transaction) => {
            if (!transaction.changed.size) return;
            this.invalidateCaches();
            if (transaction.origin !== LOCAL && transaction.origin !== SEED) this.placementReady = false;
        });
        if (state) {
            Y.applyUpdateV2(this.ydoc, state, REMOTE);
            if (
                this.meta.get('schema') !== 1 ||
                typeof this.meta.get('root') !== 'string' ||
                typeof this.meta.get('epoch') !== 'string'
            )
                throw new Error('Unsupported shared document');
            this.view = this.read(document.revision);
        } else
            this.ydoc.transact(() => {
                this.seeding = true;
                this.meta.set('schema', 1);
                this.meta.set('epoch', crypto.randomUUID());
                this.meta.set('root', key('', document.root.id));
                this.syncNode(undefined, document.root, '', undefined, document);
                this.seeding = false;
            }, SEED);
        this.registerTypes();
    }
    static create(document: NativeDocument): SharedNativeDocument {
        return new SharedNativeDocument(persistNativeIdentities(document));
    }
    static fromState(state: Uint8Array, id: string): SharedNativeDocument {
        return new SharedNativeDocument(importDocument({ type: 'doc' }, id), state);
    }
    document(): NativeDocument {
        return this.view;
    }
    epoch(): string {
        const epoch = this.meta.get('epoch');
        if (typeof epoch !== 'string') throw new Error('The shared document has no epoch');
        return epoch;
    }
    state(vector?: Uint8Array): Uint8Array {
        this.assertOpen();
        return Y.encodeStateAsUpdateV2(this.ydoc, vector);
    }
    vector(): Uint8Array {
        this.assertOpen();
        return Y.encodeStateVector(this.ydoc);
    }
    get canUndo(): boolean {
        return this.undoManager.undoStack.length > 0;
    }
    get canRedo(): boolean {
        return this.undoManager.redoStack.length > 0;
    }
    stopCapturing(): void {
        this.undoManager.stopCapturing();
    }

    publish(document: NativeDocument, history = true): Uint8Array {
        this.assertOpen();
        if (document.id !== this.view.id) throw new Error('The shared document identity changed');
        if (document.root.id !== this.view.root.id)
            document = {
                ...document,
                root: {
                    ...document.root,
                    id: this.view.root.id,
                    attributes: { ...document.root.attributes, nativeId: this.view.root.id },
                },
            };
        const vector = this.vector(),
            before = this.view;
        this.previousNodes.clear();
        this.skipInline.clear();
        this.indexNodes(before.root, '', before);
        const nextNodes = new Map<string, NativeNode>();
        this.indexNodes(document.root, '', document, nextNodes);
        try {
            this.ydoc.transact(
                () => {
                    this.planStructure(before.root, document.root, '');
                    this.syncNode(before.root, document.root, '', before, document);
                    for (const address of this.previousNodes.keys())
                        if (!nextNodes.has(address)) this.deleted.set(address, true);
                    this.registerTypes();
                },
                history ? LOCAL : SEED,
            );
        } catch (error) {
            this.destroy();
            throw error;
        }
        this.view = document;
        return this.state(vector);
    }
    receive(update: Uint8Array): NativeDocument {
        this.assertOpen();
        const root = this.meta.get('root'),
            epoch = this.epoch();
        let changed = false;
        const observe = (transaction: Y.Transaction): void => {
            changed ||= transaction.changed.size > 0;
        };
        this.ydoc.on('afterTransaction', observe);
        try {
            Y.applyUpdateV2(this.ydoc, update, REMOTE);
            if (this.meta.get('schema') !== 1 || this.meta.get('root') !== root || this.epoch() !== epoch)
                throw new Error('The shared document identity changed');
            if (changed) this.view = this.read(this.view.revision + 1);
            return this.view;
        } catch (error) {
            this.destroy();
            throw error;
        } finally {
            this.ydoc.off('afterTransaction', observe);
        }
    }
    undo(): NativeDocument {
        this.assertOpen();
        this.undoManager.undo();
        this.view = this.read(this.view.revision + 1);
        return this.view;
    }
    redo(): NativeDocument {
        this.assertOpen();
        this.undoManager.redo();
        this.view = this.read(this.view.revision + 1);
        return this.view;
    }
    caret(caret: TextCaret, association: -1 | 0 = 0): SharedCaret | null {
        const address = this.addressFor(caret.blockId);
        if (!address) return null;
        const text = this.inline(address);
        if (caret.offset < 0 || caret.offset > this.logicalOffset(address, this.bounds(address).end)) return null;
        return {
            block: address,
            position: Y.encodeRelativePosition(
                Y.createRelativePositionFromTypeIndex(text, this.physicalOffset(address, caret.offset), association),
            ),
        };
    }
    resolve(caret: SharedCaret): TextCaret | null {
        const position = Y.createAbsolutePositionFromRelativePosition(
            Y.decodeRelativePosition(caret.position),
            this.ydoc,
        );
        if (!position) return null;
        const source = this.source(caret.block),
            candidates = textBlocks(this.view.root)
                .map((block) => this.addressFor(block.id))
                .filter((address): address is string => !!address && this.source(address) === source);
        const address = candidates.find((address) => {
            const range = this.bounds(address);
            return position.index >= range.start && position.index <= range.end;
        });
        if (!address) return null;
        return { blockId: identity(address), offset: this.logicalOffset(address, position.index) };
    }
    destroy(): void {
        if (this.closed) return;
        this.closed = true;
        this.undoManager.destroy();
        this.ydoc.destroy();
        this.types.clear();
    }
    private assertOpen(): void {
        if (this.closed) throw new Error('The shared document is closed');
    }
    private addressFor(id: string): string | undefined {
        let result: string | undefined;
        const visit = (node: NativeNode, scope: string): void => {
            if (node.id === id) result = key(scope, id);
            if (node.kind === 'clause') {
                for (const child of node.children ?? [])
                    visit(
                        child,
                        child.kind === 'clauseBody'
                            ? this.variantScope(scope, node.id, activeClauseVariant(node))
                            : scope,
                    );
            } else node.children?.forEach((child) => visit(child, scope));
        };
        visit(this.view.root, '');
        return result;
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
    private registerTypes(): void {
        if (!this.unregistered.length) return;
        this.undoManager.addToScope(this.unregistered);
        this.unregistered = [];
    }
    private attributes(address: string): Y.Map<Json> {
        return this.typed(`a:${address}`, () => this.ydoc.getMap<Json>(`a:${address}`));
    }
    private children(container: string): Y.Array<Edge> {
        return this.typed(`c:${container}`, () => this.ydoc.getArray<Edge>(`c:${container}`));
    }
    private source(address: string): string {
        return this.flows.get(address) ?? address;
    }
    private invalidateCaches(): void {
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
    private effectiveParent(id: string): Parent | undefined {
        if (this.deleted.get(id)) return;
        this.physicalEdges();
        return this.parentCache!.get(id);
    }
    private placement(): Omit<Edge, 'id'> {
        if (!this.seeding && !this.placementReady) this.physicalEdges();
        return { edge: crypto.randomUUID(), rank: ++this.placementClock, actor: this.ydoc.clientID };
    }
    private inline(address: string): Y.Text {
        const source = this.source(address);
        return this.typed(`t:${source}`, () => this.ydoc.getText(`t:${source}`));
    }
    private bounds(address: string): { start: number; end: number } {
        const segment = this.flow(address);
        return { start: segment.start, end: segment.end };
    }
    private flow(address: string): FlowSegment {
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
    private visibleEmbed(address: string, insert: unknown): insert is { node: string; edge: string } {
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
    private physicalOffset(address: string, logical: number): number {
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
    private logicalOffset(address: string, position: number): number {
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
    private deleteInline(address: string, index: number, length: number): void {
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
    private indexNodes(node: NativeNode, scope: string, document: NativeDocument, target = this.previousNodes): void {
        if (node.kind === 'text') return;
        target.set(key(scope, node.id), node);
        if (node.kind === 'clause') {
            node.children
                ?.filter((child) => child.kind !== 'clauseBody')
                .forEach((child) => this.indexNodes(child, scope, document, target));
            for (const variant of clauseVariants(document, node)) {
                const variantScope = this.variantScope(scope, node.id, variant.id);
                const body =
                    variant.id === activeClauseVariant(node)
                        ? node.children!.find((child) => child.kind === 'clauseBody')!
                        : this.variantBody(variant.bodyContent, variantScope);
                this.indexNodes(body, variantScope, document, target);
            }
        } else node.children?.forEach((child) => this.indexNodes(child, scope, document, target));
        if (node.kind === 'doc')
            for (const property of ['blockVariables', 'floatingImages']) {
                const raw = node.attributes?.[property];
                if (Array.isArray(raw))
                    for (const attrs of raw)
                        if (isRecord(attrs) && typeof attrs.id === 'string')
                            this.indexNodes(
                                {
                                    id: attrs.id,
                                    kind: property === 'blockVariables' ? 'variable' : 'image',
                                    attributes: attrs,
                                },
                                scope,
                                document,
                                target,
                            );
            }
    }
    private planStructure(before: NativeNode, after: NativeNode, scope: string): void {
        if (before === after || isTextBlock(after)) return;
        const old = before.children ?? [],
            current = after.children ?? [],
            byId = new Map(old.map((child) => [child.id, child]));
        const families = new Map<string, string[]>(),
            currentIds = new Set(current.map((node) => node.id));
        for (const child of old) {
            const address = key(scope, child.id),
                family = this.families.get(address) ?? address;
            if (currentIds.has(child.id)) families.set(family, [...(families.get(family) ?? []), address]);
        }
        for (const addresses of families.values()) {
            if (addresses.length < 2) continue;
            const reordered = current
                .map((node) => key(scope, node.id))
                .filter((address) => addresses.includes(address));
            if (reordered.some((address, index) => address !== addresses[index]))
                for (const address of addresses) this.families.set(address, address);
        }
        for (let index = 0; index < current.length; index++) {
            const node = current[index],
                previous = byId.get(node.id),
                left = current[index - 1],
                oldLeft = left && byId.get(left.id);
            if (
                after.kind === 'clause' &&
                before.kind === 'clause' &&
                node.kind === 'clauseBody' &&
                activeClauseVariant(before) !== activeClauseVariant(after)
            )
                continue;
            if (
                !previous &&
                isTextBlock(node) &&
                left &&
                oldLeft &&
                isTextBlock(left) &&
                blockText(oldLeft) === blockText(left) + blockText(node)
            ) {
                const leftAddress = key(scope, left.id),
                    address = key(scope, node.id),
                    text = this.inline(leftAddress);
                this.flows.set(address, this.source(leftAddress));
                this.families.set(address, this.families.get(leftAddress) ?? leftAddress);
                text.insertEmbed(this.physicalOffset(leftAddress, blockText(left).length), { block: address });
                this.invalidateCaches();
                this.skipInline.add(leftAddress);
                this.skipInline.add(address);
            }
            if (previous && isTextBlock(node)) {
                const oldIndex = old.findIndex((child) => child.id === node.id),
                    right = old[oldIndex + 1];
                if (
                    right &&
                    isTextBlock(right) &&
                    !current.some((child) => child.id === right.id) &&
                    blockText(node) === blockText(previous) + blockText(right)
                ) {
                    const address = key(scope, node.id),
                        rightAddress = key(scope, right.id);
                    if (
                        this.source(address) === this.source(rightAddress) &&
                        this.bounds(address).end + 1 === this.bounds(rightAddress).start
                    ) {
                        this.inline(address).delete(this.bounds(rightAddress).start - 1, 1);
                        this.invalidateCaches();
                        this.skipInline.add(address);
                    }
                }
            }
            if (previous)
                this.planStructure(
                    previous,
                    node,
                    after.kind === 'clause' && node.kind === 'clauseBody'
                        ? this.variantScope(scope, after.id, activeClauseVariant(after))
                        : scope,
                );
        }
    }
    private activeChildren(container: string): Edge[] {
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
    private syncChildren(container: string, before: readonly string[], after: readonly string[]): void {
        if (this.seeding) {
            if (after.length)
                this.children(container).insert(
                    0,
                    after.map((id) => ({ id, ...this.placement() })),
                );
            this.invalidateCaches();
            return;
        }
        if (
            before.length === after.length &&
            before.every((id, index) => id === after[index] && this.effectiveParent(id)?.container === container)
        )
            return;
        const array = this.children(container);
        const changes = diffArrays([...before], [...after], { timeout: 100, maxEditLength: 4000 }) ?? [
            { removed: true, added: false, value: [...before] },
            { added: true, removed: false, value: [...after] },
        ];
        let cursor = 0;
        for (const change of changes)
            for (const id of change.value) {
                const parent = this.effectiveParent(id);
                const index =
                    parent?.container === container
                        ? array.toArray().findIndex((entry) => entry.edge === parent.edge && entry.id === id)
                        : -1;
                if (change.removed) {
                    if (index >= 0) {
                        array.delete(index, 1);
                        this.invalidateCaches();
                        if (index < cursor) cursor--;
                    }
                } else if (change.added || index < 0) {
                    const placement = this.placement();
                    array.insert(Math.min(cursor, array.length), [{ id, ...placement }]);
                    this.invalidateCaches();
                    cursor++;
                } else cursor = index + 1;
            }
    }
    private nodeAttributes(node?: NativeNode): Attributes {
        const attrs: Record<string, Json> = { ...node?.attributes };
        if (node?.kind === 'doc') {
            delete attrs.blockVariables;
            delete attrs.floatingImages;
        }
        if (node?.kind === 'clause') {
            delete attrs.variants;
            delete attrs.variantCount;
            delete attrs.isDefaultVariant;
        }
        return attrs;
    }
    private syncNode(
        before: NativeNode | undefined,
        after: NativeNode,
        scope: string,
        previous: NativeDocument | undefined,
        document: NativeDocument,
    ): void {
        const address = key(scope, after.id);
        const existed = this.registry.has(address);
        before ??= this.previousNodes.get(address);
        if (!existed || this.deleted.get(address)) before = undefined;
        if (
            before === after ||
            (before?.kind === after.kind &&
                before.attributes === after.attributes &&
                before.children === after.children &&
                before.marks === after.marks)
        )
            return;
        const attrs = this.attributes(address);
        if (this.deleted.get(address)) this.deleted.set(address, false);
        if (this.registry.get(address) !== after.kind) this.registry.set(address, after.kind);
        writeSharedAttributes(attrs, this.nodeAttributes(existed ? before : undefined), this.nodeAttributes(after));
        if (canonicalSharedJson(before?.marks) !== canonicalSharedJson(after.marks)) {
            if (after.marks) attrs.set('@marks', copyJson(after.marks));
            else attrs.delete('@marks');
        }
        if (isTextBlock(after)) {
            for (const child of after.children ?? [])
                if (child.kind !== 'text')
                    this.syncNode(
                        before?.children?.find((node) => node.id === child.id),
                        child,
                        scope,
                        previous,
                        document,
                    );
            this.syncInline(address, before, after, scope);
        } else if (after.kind === 'clause') this.syncClause(address, scope, before, after, previous, document);
        else {
            if (this.seeding) {
                let source: string | undefined;
                for (const child of after.children ?? []) {
                    if (!isTextBlock(child)) {
                        source = undefined;
                        continue;
                    }
                    const address = key(scope, child.id);
                    if (source) this.flows.set(address, source);
                    else source = address;
                }
            }
            const old = new Map(before?.children?.map((child) => [child.id, child]));
            for (const child of after.children ?? [])
                this.syncNode(old.get(child.id), child, scope, previous, document);
            this.syncChildren(
                address,
                before?.children?.map((child) => key(scope, child.id)) ?? [],
                after.children?.map((child) => key(scope, child.id)) ?? [],
            );
        }
        if (after.kind === 'doc')
            for (const field of ['blockVariables', 'floatingImages']) {
                const objects = (node?: NativeNode): NativeNode[] => {
                    const raw = node?.attributes?.[field];
                    return Array.isArray(raw)
                        ? raw
                              .filter(isRecord)
                              .filter((attrs) => typeof attrs.id === 'string')
                              .map((attrs) => ({
                                  id: attrs.id as string,
                                  kind: field === 'blockVariables' ? 'variable' : 'image',
                                  attributes: attrs,
                              }))
                        : [];
                };
                const old = objects(before),
                    current = objects(after),
                    byId = new Map(old.map((node) => [node.id, node]));
                current.forEach((node) => this.syncNode(byId.get(node.id), node, scope, previous, document));
                this.syncChildren(
                    `${field}:${address}`,
                    old.map((node) => key(scope, node.id)),
                    current.map((node) => key(scope, node.id)),
                );
            }
    }
    private tokens(node: NativeNode | undefined, scope: string): InlineToken[] {
        return (node?.children ?? []).flatMap<InlineToken>((child) => {
            const attributes = child.kind === 'text' ? sharedTextAttributes(child.marks, child.attributes) : {};
            const signature = canonicalSharedJson(attributes);
            return child.kind === 'text'
                ? Array.from(child.text ?? '', (insert) => ({ insert, attributes, signature }))
                : [{ insert: { node: key(scope, child.id) }, attributes, signature }];
        });
    }
    private syncInline(address: string, before: NativeNode | undefined, after: NativeNode, scope: string): void {
        if (this.skipInline.has(address)) return;
        if (before?.children === after.children) return;
        const text = this.inline(address),
            old = this.tokens(before, scope),
            current = this.tokens(after, scope);
        if (!before && this.source(address) !== address) {
            text.insertEmbed(text.length, { block: address });
            this.invalidateCaches();
        }
        if (this.seeding) {
            let pending = '',
                attributes: Record<string, Json> = {},
                signature = '';
            const flush = (): void => {
                if (pending) {
                    text.insert(text.length, pending, attributes);
                    pending = '';
                }
            };
            for (const token of current) {
                if (typeof token.insert === 'string') {
                    if (pending && signature !== token.signature) flush();
                    signature = token.signature;
                    attributes = token.attributes;
                    pending += token.insert;
                } else {
                    flush();
                    const placement = this.placement();
                    text.insertEmbed(text.length, { ...token.insert, ...placement }, token.attributes);
                }
            }
            flush();
            this.invalidateCaches();
            return;
        }
        const same = (a: InlineToken, b: InlineToken): boolean =>
            typeof a.insert === 'string' && typeof b.insert === 'string'
                ? a.insert === b.insert
                : typeof a.insert === 'object' && typeof b.insert === 'object' && a.insert.node === b.insert.node;
        const changes = diffArrays(old, current, { comparator: same, timeout: 100, maxEditLength: 4000 }) ?? [
            { removed: true, added: false, value: old },
            { added: true, removed: false, value: current },
        ];
        let index = 0,
            oldIndex = 0;
        for (const change of changes) {
            if (change.removed) {
                const length = change.value.reduce(
                    (sum, token) => sum + (typeof token.insert === 'string' ? token.insert.length : 1),
                    0,
                );
                this.deleteInline(address, index, length);
                oldIndex += change.value.length;
                continue;
            }
            let pending = '',
                attributes: Record<string, Json> = {},
                signature = '';
            const flush = (): void => {
                if (pending) {
                    text.insert(this.physicalOffset(address, index), pending, attributes);
                    this.invalidateCaches();
                    index += pending.length;
                    pending = '';
                }
            };
            let formatting:
                | { from: number; length: number; patch: Record<string, Json>; signature: string }
                | undefined;
            const flushFormatting = (): void => {
                if (!formatting) return;
                const from = this.physicalOffset(address, formatting.from),
                    to = this.physicalOffset(address, formatting.from + formatting.length);
                text.format(from, to - from, formatting.patch);
                this.invalidateCaches();
                formatting = undefined;
            };
            for (const token of change.value) {
                const length = typeof token.insert === 'string' ? token.insert.length : 1;
                if (change.added) {
                    if (typeof token.insert === 'string') {
                        if (pending && signature !== token.signature) flush();
                        signature = token.signature;
                        attributes = token.attributes;
                        pending += token.insert;
                    } else {
                        flush();
                        const placement = this.placement();
                        text.insertEmbed(
                            this.physicalOffset(address, index),
                            { ...token.insert, ...placement },
                            token.attributes,
                        );
                        this.invalidateCaches();
                        index++;
                    }
                } else {
                    const previous = old[oldIndex++];
                    if (previous.signature !== token.signature) {
                        const patch = Object.fromEntries(
                            [...new Set([...Object.keys(previous.attributes), ...Object.keys(token.attributes)])]
                                .filter(
                                    (key) =>
                                        canonicalSharedJson(previous.attributes[key]) !==
                                        canonicalSharedJson(token.attributes[key]),
                                )
                                .map((key) => [key, token.attributes[key] ?? null]),
                        );
                        const signature = canonicalSharedJson(patch);
                        if (formatting?.signature === signature) formatting.length += length;
                        else {
                            flushFormatting();
                            formatting = { from: index, length, patch, signature };
                        }
                    } else flushFormatting();
                    index += length;
                }
            }
            flush();
            flushFormatting();
        }
    }
    private variantScope(scope: string, clause: string, variant: string): string {
        return JSON.stringify([scope, clause, variant]);
    }
    private variantBody(value: Json, id: string): NativeNode {
        const content =
            isRecord(value) && value.type === 'clauseBody'
                ? value
                : {
                      type: 'clauseBody',
                      content:
                          isRecord(value) && value.type === 'doc'
                              ? (value.content ?? [])
                              : Array.isArray(value)
                                ? value
                                : [{ type: 'paragraph' }],
                  };
        return persistNativeIdentities(importDocument({ type: 'doc', content: [content] }, id)).root.children![0];
    }
    private syncClause(
        address: string,
        scope: string,
        before: NativeNode | undefined,
        after: NativeNode,
        previous: NativeDocument | undefined,
        document: NativeDocument,
    ): void {
        const oldVariants = before && previous ? clauseVariants(previous, before) : [],
            variants = clauseVariants(document, after);
        const oldById = new Map(oldVariants.map((variant) => [variant.id, variant]));
        const oldActive = before ? activeClauseVariant(before) : '',
            active = activeClauseVariant(after);
        const oldBody = before?.children?.find((child) => child.kind === 'clauseBody'),
            body = after.children?.find((child) => child.kind === 'clauseBody');
        for (const variant of variants) {
            const old = oldById.get(variant.id),
                variantAddress = JSON.stringify(['variant', address, variant.id]);
            const metadata = Object.fromEntries(Object.entries(variant).filter(([key]) => key !== 'bodyContent'));
            const oldMetadata = Object.fromEntries(Object.entries(old ?? {}).filter(([key]) => key !== 'bodyContent'));
            if (this.deleted.get(variantAddress)) this.deleted.set(variantAddress, false);
            writeSharedAttributes(this.attributes(variantAddress), oldMetadata as Attributes, metadata as Attributes);
            if (old && variant.id !== active && variant.id !== oldActive && old.bodyContent === variant.bodyContent)
                continue;
            const variantScope = this.variantScope(scope, after.id, variant.id);
            const beforeNode =
                variant.id === oldActive ? oldBody : old ? this.variantBody(old.bodyContent, variantScope) : undefined;
            const afterNode = variant.id === active ? body! : this.variantBody(variant.bodyContent, variantScope);
            this.syncNode(beforeNode, afterNode, variantScope, previous, document);
            this.syncChildren(`body:${variantAddress}`, beforeNode ? [key(variantScope, beforeNode.id)] : [], [
                key(variantScope, afterNode.id),
            ]);
        }
        this.syncChildren(
            `variants:${address}`,
            oldVariants.map((variant) => JSON.stringify(['variant', address, variant.id])),
            variants.map((variant) => JSON.stringify(['variant', address, variant.id])),
        );
        for (const variant of oldVariants)
            if (!variants.some((current) => current.id === variant.id))
                this.deleted.set(JSON.stringify(['variant', address, variant.id]), true);
        const oldTitle = before?.children?.filter((child) => child.kind !== 'clauseBody') ?? [],
            title = after.children?.filter((child) => child.kind !== 'clauseBody') ?? [];
        title.forEach((child) =>
            this.syncNode(
                oldTitle.find((node) => node.id === child.id),
                child,
                scope,
                previous,
                document,
            ),
        );
        this.syncChildren(
            address,
            oldTitle.map((child) => key(scope, child.id)),
            title.map((child) => key(scope, child.id)),
        );
    }
    private read(revision: number): NativeDocument {
        const root = this.meta.get('root');
        if (typeof root !== 'string') throw new Error('The shared document has no root');
        const visited = new Set<string>();
        const readNode = (address: string, depth = 0): NativeNode => {
            if (depth > 64 || visited.has(address) || visited.size > 100000)
                throw new Error('Invalid shared document structure');
            visited.add(address);
            const kind = this.registry.get(address),
                id = identity(address);
            if (typeof kind !== 'string') throw new Error('The shared node does not exist');
            const source = this.attributes(address),
                attrs: Record<string, Json> = { ...readSharedAttributes(source) };
            let children: NativeNode[] = [];
            if (isTextBlock({ kind, id })) {
                for (const delta of this.flow(address).parts) {
                    const offset = delta.from;
                    if (typeof delta.insert === 'string') {
                        const attributes = (delta.attributes ?? {}) as Record<string, Json>,
                            raw = attributes.textAttributes;
                        const marks = nativeSharedMarks(attributes),
                            relative = Y.createRelativePositionFromTypeIndex(this.inline(address), offset);
                        const textId = `shared-text:${encodeSharedBytes(Y.encodeRelativePosition(relative))}`;
                        const textAttrs = isRecord(raw)
                            ? {
                                  ...raw,
                                  ...(raw.id !== undefined || raw.nativeId !== undefined ? { nativeId: textId } : {}),
                              }
                            : undefined;
                        children.push({
                            id: textId,
                            kind: 'text',
                            text: delta.insert,
                            ...(textAttrs ? { attributes: textAttrs } : {}),
                            ...(marks.length ? { marks } : {}),
                        });
                    } else if (
                        delta.insert &&
                        typeof delta.insert === 'object' &&
                        typeof delta.insert.node === 'string'
                    ) {
                        if (this.visibleEmbed(address, delta.insert))
                            children.push(readNode(delta.insert.node, depth + 1));
                    } else throw new Error('Invalid shared inline content');
                }
            } else children = this.activeChildren(address).map((entry) => readNode(entry.id, depth + 1));
            if (kind === 'doc')
                for (const field of ['blockVariables', 'floatingImages']) {
                    const values = this.activeChildren(`${field}:${address}`).map(
                        (entry) => readNode(entry.id, depth + 1).attributes ?? {},
                    );
                    if (values.length || source.has(JSON.stringify([field]))) attrs[field] = values;
                }
            if (kind === 'clause') {
                const variants = this.activeChildren(`variants:${address}`).map((entry, index) => {
                    const raw = readSharedAttributes(this.attributes(entry.id));
                    if (typeof raw.id !== 'string') throw new Error('Invalid shared clause variant');
                    const body = this.activeChildren(`body:${entry.id}`)[0];
                    if (!body) throw new Error('The shared clause variant has no body');
                    const node = readNode(body.id, depth + 1);
                    return {
                        ...raw,
                        id: raw.id,
                        isDefault: index === 0,
                        bodyContent: copyJson(exportDocument({ ...this.view, root: node })),
                        node,
                    };
                });
                const active = variants.find((variant) => variant.id === attrs.activeVariantId) ?? variants[0];
                if (!active) throw new Error('The shared clause has no variants');
                children.push(active.node);
                attrs.id = active.id;
                attrs.activeVariantId = active.id;
                attrs.variantCount = variants.length;
                attrs.isDefaultVariant = active.isDefault;
                attrs.variants = variants.map((variant) =>
                    Object.fromEntries(Object.entries(variant).filter(([key]) => key !== 'node')),
                ) as Json;
            }
            if (
                ['doc', 'tableCell', 'tableHeader', 'parallelCell', 'clauseBody', 'listItem', 'blockquote'].includes(
                    kind,
                ) &&
                !children.length
            ) {
                const scope = (JSON.parse(address) as [string, string])[0];
                const base = `shared-empty:${address}`;
                let placeholder = base,
                    sequence = 0;
                while (this.registry.has(key(scope, placeholder))) placeholder = `${base}:${++sequence}`;
                children.push({
                    id: placeholder,
                    kind: 'paragraph',
                    attributes: { nativeId: placeholder },
                    children: [],
                });
            }
            const rawMarks = source.get('@marks');
            return Object.freeze({
                id,
                kind,
                ...(Object.keys(attrs).length ? { attributes: copyJson(attrs) as Attributes } : {}),
                ...(Array.isArray(rawMarks) ? { marks: rawMarks as unknown as readonly NativeMark[] } : {}),
                ...(!['variable', 'image', 'hardBreak', 'horizontalRule', 'pdfPage'].includes(kind)
                    ? { children: Object.freeze(children) }
                    : {}),
            });
        };
        const parsed = importDocument(exportDocument({ ...this.view, root: readNode(root) }), this.view.id);
        if (!textBlocks(parsed.root).length) throw new Error('The shared document has no editable text');
        this.registerTypes();
        return Object.freeze({ ...parsed, revision });
    }
}
