import { diffArrays } from 'diff';
import { activeClauseVariant, clauseVariants } from '../../content/clauses/queries.js';
import {
    copyJson,
    isRecord,
    type Attributes,
    type Json,
    type NativeDocument,
    type NativeNode,
} from '../../document/model.js';
import { blockText, isTextBlock } from '../../document/text.js';
import { canonicalSharedJson, readSharedAttributes, writeSharedAttributes } from '../values.js';
import { syncSharedInline } from './inline.js';
import { readSharedDocument, readSharedNode } from './reader.js';
import { key } from './schema.js';
import type { SharedStore } from './store.js';
import { variantScope as clauseVariantScope, variantBody } from './variants.js';

export class SharedWriter {
    private readonly previousNodes = new Map<string, NativeNode>();
    private readonly skipInline = new Set<string>();
    private readonly joined = new Set<string>();
    private readonly refresh = new Set<string>();

    constructor(private readonly store: SharedStore) {}

    write(before: NativeDocument | undefined, document: NativeDocument): void {
        this.previousNodes.clear();
        this.skipInline.clear();
        this.joined.clear();
        this.refresh.clear();
        if (!before) {
            this.syncNode(undefined, document.root, '', undefined, document);
            return;
        }
        this.indexNodes(before.root, '', before);
        const nextNodes = new Map<string, NativeNode>();
        this.indexNodes(document.root, '', document, nextNodes);
        let detached = false;
        const revived: string[] = [];
        for (const address of nextNodes.keys()) {
            if (!this.previousNodes.has(address) && this.store.deleted.get(address)) {
                this.store.deleted.set(address, false);
                detached = true;
                revived.push(address);
            }
        }
        if (detached) {
            this.store.invalidateCaches();
            before = readSharedDocument(this.store, before, before.revision);
            this.previousNodes.clear();
            this.indexNodes(before.root, '', before);
            for (const address of revived)
                if (!this.previousNodes.has(address) && this.store.registry.has(address))
                    this.previousNodes.set(address, readSharedNode(this.store, before, address));
        }
        this.planStructure(before.root, document.root, '');
        this.syncNode(before.root, document.root, '', before, document);
        for (const address of this.previousNodes.keys())
            if (!nextNodes.has(address) && !this.joined.has(address)) this.store.deleted.set(address, true);
    }
    seedPlaceholders(document: NativeDocument): boolean {
        const nodes = new Map<string, NativeNode>();
        this.indexNodes(document.root, '', document, nodes);
        if (![...nodes.keys()].some((address) => !this.store.registry.has(address))) return false;
        const copy = (node: NativeNode): NativeNode =>
            node.kind === 'text'
                ? node
                : {
                      ...node,
                      ...(node.kind === 'clause' && node.attributes?.variants
                          ? { attributes: { ...node.attributes, variants: copyJson(node.attributes.variants) } }
                          : {}),
                      ...(node.children ? { children: node.children.map(copy) } : {}),
                  };
        this.write({ ...document, root: copy(document.root) }, document);
        return true;
    }

    private indexNodes(node: NativeNode, scope: string, document: NativeDocument, target = this.previousNodes): void {
        if (node.kind === 'text') return;
        target.set(key(scope, node.id), node);
        if (node.kind === 'clause') {
            node.children
                ?.filter((child) => child.kind !== 'clauseBody')
                .forEach((child) => this.indexNodes(child, scope, document, target));
            for (const variant of clauseVariants(document, node)) {
                const variantScope = clauseVariantScope(scope, node.id, variant.id);
                const body =
                    variant.id === activeClauseVariant(node)
                        ? node.children!.find((child) => child.kind === 'clauseBody')!
                        : variantBody(variant.bodyContent, variantScope);
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
        const splitRuns: NativeNode[][] = [];
        for (let index = 0; index < current.length; index++) {
            const node = current[index],
                previous = byId.get(node.id);
            if (!previous || !isTextBlock(node)) continue;
            const run = [node];
            for (
                let next = index + 1;
                next < current.length && !byId.has(current[next].id) && isTextBlock(current[next]);
                next++
            )
                run.push(current[next]);
            if (run.length > 1 && blockText(previous) === run.map(blockText).join('')) splitRuns.push(run);
        }
        const splitting = new Set(splitRuns.flatMap((run) => run.slice(1).map((node) => node.id)));
        for (const child of old) {
            const address = key(scope, child.id),
                family = this.store.families.get(address) ?? address;
            if (currentIds.has(child.id)) families.set(family, [...(families.get(family) ?? []), address]);
        }
        for (const [family, addresses] of families) {
            if (old.length === current.length && old.every((node, index) => node.id === current[index].id)) break;
            const anchor = this.store.joinedOwner(family);
            if (
                !addresses.includes(anchor) &&
                old.some((node) => key(scope, node.id) === anchor) &&
                current.some((node) => key(scope, node.id) === anchor)
            ) {
                addresses.push(anchor);
                addresses.sort(
                    (a, b) =>
                        old.findIndex((node) => key(scope, node.id) === a) -
                        old.findIndex((node) => key(scope, node.id) === b),
                );
            }
            if (addresses.length < 2) continue;
            const reordered = current
                .map((node) => key(scope, node.id))
                .filter((address) => addresses.includes(address));
            const known = current.filter((node) => !splitting.has(node.id) || anchor !== family);
            const positions = known.flatMap((node, index) => (addresses.includes(key(scope, node.id)) ? [index] : []));
            if (
                reordered.some((address, index) => address !== addresses[index]) ||
                positions.at(-1)! - positions[0] + 1 !== positions.length
            )
                for (const address of addresses)
                    if ((this.store.families.get(address) ?? address) === family)
                        this.store.families.set(address, address);
        }
        for (const run of splitRuns) {
            const leftAddress = key(scope, run[0].id);
            const origin = this.store.families.get(leftAddress);
            if (origin && origin !== leftAddress && this.store.joinedOwner(origin) === leftAddress)
                this.store.families.set(leftAddress, leftAddress);
            const offsets = [0];
            for (const node of run) offsets.push(offsets.at(-1)! + blockText(node).length);
            for (let index = run.length - 1; index > 0; index--) {
                const address = key(scope, run[index].id);
                const point =
                    offsets[index] > 0 && offsets[index] === this.store.length(leftAddress)
                        ? this.store.endPoint(leftAddress)
                        : this.store.point(leftAddress, offsets[index]);
                this.store.flows.set(address, point.source);
                this.store.families.set(
                    address,
                    point.block === leftAddress ? (this.store.families.get(leftAddress) ?? leftAddress) : point.block,
                );
                point.text.insertEmbed(point.index, { end: true });
                point.text.insertEmbed(point.index + 1, { block: address });
                this.store.invalidateCaches();
                this.store.continueSplit(point.trail, address);
                this.skipInline.add(address);
            }
            this.skipInline.add(leftAddress);
        }
        for (let index = 0; index < current.length; index++) {
            const node = current[index],
                previous = byId.get(node.id);
            if (
                after.kind === 'clause' &&
                before.kind === 'clause' &&
                node.kind === 'clauseBody' &&
                activeClauseVariant(before) !== activeClauseVariant(after)
            )
                continue;
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
                    this.store.join(address, rightAddress, blockText(previous).length);
                    this.joined.add(rightAddress);
                    this.refresh.add(address);
                    this.skipInline.add(address);
                }
            }
            if (previous)
                this.planStructure(
                    previous,
                    node,
                    after.kind === 'clause' && node.kind === 'clauseBody'
                        ? clauseVariantScope(scope, after.id, activeClauseVariant(after))
                        : scope,
                );
        }
    }
    private syncChildren(container: string, before: readonly string[], after: readonly string[]): void {
        if (this.store.seeding) {
            if (after.length)
                this.store.children(container).insert(
                    0,
                    after.map((id) => ({ id, ...this.store.placement() })),
                );
            this.store.invalidateCaches();
            return;
        }
        if (
            before.length === after.length &&
            before.every(
                (id, index) =>
                    !this.refresh.has(id) &&
                    id === after[index] &&
                    this.store.effectiveParent(id)?.container === container,
            )
        )
            return;
        const array = this.store.children(container);
        let original = new Map(before.map((id) => [id, this.store.physicalParent(id)]));
        const present = before.filter((id) => original.get(id)?.container === container);
        const physical = array
            .toArray()
            .filter((entry) => original.get(entry.id)?.edge === entry.edge && present.includes(entry.id))
            .map((entry) => entry.id);
        if (physical.length === present.length && physical.some((id, index) => id !== present[index])) {
            array.insert(
                array.length,
                present.map((id) => {
                    const parent = original.get(id)!;
                    const [base, generation] = parent.edge.split(':');
                    const next = (Number.parseInt(generation ?? '0', 16) + 1).toString(16).padStart(16, '0');
                    return {
                        id,
                        edge: `${base}:${next}:${crypto.randomUUID()}`,
                        rank: parent.rank,
                        actor: parent.actor,
                    };
                }),
            );
            this.store.invalidateCaches();
            original = new Map(before.map((id) => [id, this.store.physicalParent(id)]));
        }
        const changes = diffArrays([...before], [...after], { timeout: 100, maxEditLength: 4000 }) ?? [
            { removed: true, added: false, value: [...before] },
            { added: true, removed: false, value: [...after] },
        ];
        let cursor = 0;
        for (const change of changes)
            for (const id of change.value) {
                const parent = this.store.effectiveParent(id);
                const index =
                    parent?.container === container
                        ? array.toArray().findIndex((entry) => entry.edge === parent.edge && entry.id === id)
                        : -1;
                if (change.removed) {
                    if (this.joined.has(id)) continue;
                    const old = original.get(id);
                    const previousIndex =
                        old?.container === container
                            ? array.toArray().findIndex((entry) => entry.id === id && entry.edge === old.edge)
                            : -1;
                    if (previousIndex >= 0) {
                        array.delete(previousIndex, 1);
                        this.store.invalidateCaches();
                        if (previousIndex < cursor) cursor--;
                    }
                } else if (change.added || index < 0 || this.refresh.has(id)) {
                    if (!change.added && index >= 0) {
                        array.delete(index, 1);
                        this.store.invalidateCaches();
                        if (index < cursor) cursor--;
                    }
                    const placement = this.store.placement();
                    array.insert(Math.min(cursor, array.length), [{ id, ...placement }]);
                    this.store.invalidateCaches();
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
        const existed = this.store.registry.has(address);
        before ??= this.previousNodes.get(address);
        if (!existed || this.store.deleted.get(address) === true) before = undefined;
        if (
            before === after ||
            (before?.kind === after.kind &&
                before.attributes === after.attributes &&
                before.children === after.children &&
                before.marks === after.marks)
        )
            return;
        const attrs = this.store.attributes(address);
        if (this.store.deleted.get(address)) {
            this.store.deleted.set(address, false);
            this.store.invalidateCaches();
        }
        if (this.store.registry.get(address) !== after.kind) this.store.registry.set(address, after.kind);
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
            if (!this.skipInline.has(address)) syncSharedInline(this.store, address, before, after, scope);
        } else if (after.kind === 'clause') this.syncClause(address, scope, before, after, previous, document);
        else {
            if (this.store.seeding) {
                let source: string | undefined;
                for (const child of after.children ?? []) {
                    if (!isTextBlock(child)) {
                        source = undefined;
                        continue;
                    }
                    const address = key(scope, child.id);
                    if (source) this.store.flows.set(address, source);
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
            const attrs = this.store.attributes(variantAddress);
            const metadata = Object.fromEntries(Object.entries(variant).filter(([key]) => key !== 'bodyContent'));
            const oldMetadata = old
                ? Object.fromEntries(Object.entries(old).filter(([key]) => key !== 'bodyContent'))
                : readSharedAttributes(attrs);
            if (this.store.deleted.get(variantAddress)) this.store.deleted.set(variantAddress, false);
            writeSharedAttributes(attrs, oldMetadata as Attributes, metadata as Attributes);
            if (old && variant.id !== active && variant.id !== oldActive && old.bodyContent === variant.bodyContent)
                continue;
            const variantScope = clauseVariantScope(scope, after.id, variant.id);
            const beforeNode =
                variant.id === oldActive ? oldBody : old ? variantBody(old.bodyContent, variantScope) : undefined;
            const afterNode = variant.id === active ? body! : variantBody(variant.bodyContent, variantScope);
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
                this.store.deleted.set(JSON.stringify(['variant', address, variant.id]), true);
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
}
