import { diffArrays } from 'diff';
import type { Json, NativeNode } from '../../document/model.js';
import { canonicalSharedJson, sharedTextAttributes } from '../values.js';
import { key } from './schema.js';
import type { SharedStore } from './store.js';

interface InlineToken {
    readonly insert: string | { node: string };
    readonly attributes: Record<string, Json>;
    readonly signature: string;
}
function tokens(node: NativeNode | undefined, scope: string): InlineToken[] {
    return (node?.children ?? []).flatMap<InlineToken>((child) => {
        const attributes = child.kind === 'text' ? sharedTextAttributes(child.marks, child.attributes) : {};
        const signature = canonicalSharedJson(attributes);
        return child.kind === 'text'
            ? Array.from(child.text ?? '', (insert) => ({ insert, attributes, signature }))
            : [{ insert: { node: key(scope, child.id) }, attributes, signature }];
    });
}
export function syncSharedInline(
    store: SharedStore,
    address: string,
    before: NativeNode | undefined,
    after: NativeNode,
    scope: string,
): void {
    if (before?.children === after.children) return;
    const text = store.inline(address),
        old = tokens(before, scope),
        current = tokens(after, scope);
    if (!before && store.source(address) !== address) {
        text.insertEmbed(text.length, { block: address });
        store.invalidateCaches();
    }
    if (store.seeding) {
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
                const placement = store.placement();
                text.insertEmbed(text.length, { ...token.insert, ...placement }, token.attributes);
            }
        }
        flush();
        text.insertEmbed(text.length, { end: true });
        store.invalidateCaches();
        return;
    }
    if (!before && (store.source(address) !== address || !text.length)) {
        text.insertEmbed(text.length, { end: true });
        store.invalidateCaches();
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
            store.deleteInline(address, index, length);
            oldIndex += change.value.length;
            continue;
        }
        let pending = '',
            attributes: Record<string, Json> = {},
            signature = '';
        const flush = (): void => {
            if (pending) {
                store.insertText(address, index, pending, attributes);
                index += pending.length;
                pending = '';
            }
        };
        let formatting: { from: number; length: number; patch: Record<string, Json>; signature: string } | undefined;
        const flushFormatting = (): void => {
            if (!formatting) return;
            store.formatInline(address, formatting.from, formatting.length, formatting.patch);
            store.invalidateCaches();
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
                    const placement = store.placement();
                    store.insertEmbed(address, index, { ...token.insert, ...placement }, token.attributes);
                    store.invalidateCaches();
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
