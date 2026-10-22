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
import { canonicalSharedJson, writeSharedAttributes } from '../values.js';
import { syncSharedInline } from './inline.js';
import { key } from './schema.js';
import type { SharedStore } from './store.js';
import { variantScope as clauseVariantScope, variantBody } from './variants.js';

export class SharedWriter {
    private readonly previousNodes = new Map<string, NativeNode>();
    private readonly skipInline = new Set<string>();

    constructor(private readonly store: SharedStore) {}

    write(before: NativeDocument | undefined, document: NativeDocument): void {
        this.previousNodes.clear();
        this.skipInline.clear();
        if (!before) {
            this.syncNode(undefined, document.root, '', undefined, document);
            return;
        }
        this.indexNodes(before.root, '', before);
        const nextNodes = new Map<string, NativeNode>();
        this.indexNodes(document.root, '', document, nextNodes);
        this.planStructure(before.root, document.root, '');
        this.syncNode(before.root, document.root, '', before, document);
        for (const address of this.previousNodes.keys())
            if (!nextNodes.has(address)) this.store.deleted.set(address, true);
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
        for (const child of old) {
            const address = key(scope, child.id),
                family = this.store.families.get(address) ?? address;
            if (currentIds.has(child.id)) families.set(family, [...(families.get(family) ?? []), address]);
        }
        for (const addresses of families.values()) {
            if (addresses.length < 2) continue;
            const reordered = current
                .map((node) => key(scope, node.id))
                .filter((address) => addresses.includes(address));
            if (reordered.some((address, index) => address !== addresses[index]))
                for (const address of addresses) this.store.families.set(address, address);
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
                    text = this.store.inline(leftAddress);
                this.store.flows.set(address, this.store.source(leftAddress));
                this.store.families.set(address, this.store.families.get(leftAddress) ?? leftAddress);
                text.insertEmbed(this.store.physicalOffset(leftAddress, blockText(left).length), { block: address });
                this.store.invalidateCaches();
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
                        this.store.source(address) === this.store.source(rightAddress) &&
                        this.store.bounds(address).end + 1 === this.store.bounds(rightAddress).start
                    ) {
                        this.store.inline(address).delete(this.store.bounds(rightAddress).start - 1, 1);
                        this.store.invalidateCaches();
                        this.skipInline.add(address);
                    }
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
            before.every((id, index) => id === after[index] && this.store.effectiveParent(id)?.container === container)
        )
            return;
        const array = this.store.children(container);
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
                    if (index >= 0) {
                        array.delete(index, 1);
                        this.store.invalidateCaches();
                        if (index < cursor) cursor--;
                    }
                } else if (change.added || index < 0) {
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
        if (!existed || this.store.deleted.get(address)) before = undefined;
        if (
            before === after ||
            (before?.kind === after.kind &&
                before.attributes === after.attributes &&
                before.children === after.children &&
                before.marks === after.marks)
        )
            return;
        const attrs = this.store.attributes(address);
        if (this.store.deleted.get(address)) this.store.deleted.set(address, false);
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
            const metadata = Object.fromEntries(Object.entries(variant).filter(([key]) => key !== 'bodyContent'));
            const oldMetadata = Object.fromEntries(Object.entries(old ?? {}).filter(([key]) => key !== 'bodyContent'));
            if (this.store.deleted.get(variantAddress)) this.store.deleted.set(variantAddress, false);
            writeSharedAttributes(
                this.store.attributes(variantAddress),
                oldMetadata as Attributes,
                metadata as Attributes,
            );
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
