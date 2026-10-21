import { diffArrays, diffWordsWithSpace } from 'diff';
import { nativeFields } from '../content/fields/commands.js';
import { nativeImages } from '../content/images.js';
import { exportDocument } from '../document/codec.js';
import { isRecord, type Json, type NativeDocument, type NativeNode } from '../document/model.js';
import { blockText } from '../editing/text.js';

export interface HistoryVersion {
    readonly number: number;
    readonly created_at: string;
    readonly user: { readonly name: string } | null;
    readonly message: string | null;
    readonly restored_from_number: number | null;
    readonly rejected?: boolean;
    readonly cancelled?: boolean;
}
export interface HistorySnapshot extends HistoryVersion {
    readonly previous_number?: number | null;
    readonly content: Json;
}
export interface HistoryPage {
    readonly data: readonly HistoryVersion[];
    readonly head_number: number | null;
    readonly next_page: number | null;
}
export interface HistoryUnit {
    readonly id: string;
    readonly key: string;
    readonly kind: string;
    readonly text: string;
    readonly fingerprint: string;
}
export interface HistoryTextPart {
    readonly text: string;
    readonly kind: 'same' | 'added' | 'removed';
}
export interface HistoryChange {
    readonly kind: 'added' | 'removed' | 'modified' | 'moved';
    readonly before?: HistoryUnit;
    readonly after?: HistoryUnit;
    readonly text: readonly HistoryTextPart[];
    readonly formatting: boolean;
}

function canonical(value: unknown, attributes = false): unknown {
    if (Array.isArray(value)) return value.map((entry) => canonical(entry));
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .filter(([key]) => key !== 'nativeEditor' && key !== 'nativeId' && !(attributes && key === 'id'))
            .map(([key, entry]) => [key, canonical(entry, key === 'attrs')]),
    );
}
export function historyUnits(document: NativeDocument): readonly HistoryUnit[] {
    const units: HistoryUnit[] = [];
    const visit = (node: NativeNode): void => {
        const textBlock = ['paragraph', 'heading', 'codeBlock', 'clauseTitle'].includes(node.kind);
        if (
            node.kind !== 'text' &&
            !['clauseBody', 'listItem', 'tableRowGroup', 'tableRow', 'parallelCell'].includes(node.kind)
        ) {
            const raw = exportDocument({ ...document, root: node }) as { content?: Json[] };
            const content = textBlock
                ? raw.content?.map((child) =>
                      isRecord(child) && ['image', 'variable'].includes(String(child.type))
                          ? { type: child.type }
                          : child,
                  )
                : undefined;
            let attrs: Record<string, Json> = { ...node.attributes };
            if (node.kind === 'doc') {
                delete attrs.blockVariables;
                delete attrs.floatingImages;
            }
            if (node.kind === 'clause' && Array.isArray(attrs.variants)) {
                const active = attrs.activeVariantId ?? attrs.id;
                attrs = {
                    ...attrs,
                    variants: attrs.variants.map((variant) =>
                        isRecord(variant)
                            ? { ...variant, contentHash: null, ...(variant.id === active ? { bodyContent: null } : {}) }
                            : variant,
                    ),
                };
            }
            const fingerprint = JSON.stringify(canonical({ type: node.kind, attrs, ...(content ? { content } : {}) }));
            const identity = node.attributes?.nativeId ?? node.attributes?.id;
            units.push({
                id: node.id,
                key: typeof identity === 'string' ? `${node.kind}:${identity}` : `${node.kind}:${fingerprint}`,
                kind: node.kind,
                text: textBlock
                    ? blockText(node)
                    : node.kind === 'clause'
                      ? (node.children
                            ?.find((child) => child.kind === 'clauseTitle')
                            ?.children?.map((child) => child.text ?? '')
                            .join('') ?? '')
                      : String(node.attributes?.name ?? node.attributes?.alt ?? ''),
                fingerprint,
            });
        }
        node.children
            ?.filter((child) => !textBlock || child.kind === 'image' || child.kind === 'variable')
            .forEach(visit);
    };
    visit(document.root);
    for (const object of [...nativeFields(document), ...nativeImages(document)].filter((object) => object.floating)) {
        const kind = 'type' in object.attributes ? 'variable' : 'image';
        units.push({
            id: object.id,
            key: `${kind}:${object.id}`,
            kind,
            text: String(object.attributes.name ?? object.attributes.alt ?? ''),
            fingerprint: JSON.stringify(canonical({ type: kind, attrs: object.attributes })),
        });
    }
    return units;
}
function textParts(before: string, after: string, deadline: number): readonly HistoryTextPart[] {
    if (before === after) return before ? [{ text: before, kind: 'same' }] : [];
    const diff =
        Date.now() < deadline
            ? diffWordsWithSpace(before, after, { timeout: Math.min(25, deadline - Date.now()), maxEditLength: 1500 })
            : undefined;
    return (
        diff?.map((part) => ({ text: part.value, kind: part.added ? 'added' : part.removed ? 'removed' : 'same' })) ??
        ([
            { text: before, kind: 'removed' },
            { text: after, kind: 'added' },
        ].filter((part) => !!part.text) as HistoryTextPart[])
    );
}
export function compareHistory(before: NativeDocument, after: NativeDocument): readonly HistoryChange[] {
    const previous = historyUnits(before),
        current = historyUnits(after),
        changes: HistoryChange[] = [];
    const deadline = Date.now() + 200;
    const diff = diffArrays([...previous], [...current], {
        comparator: (a, b) => a.key === b.key,
        timeout: 100,
        maxEditLength: 2000,
    });
    const oldByKey = new Map(previous.map((unit) => [unit.key, unit]));
    const newByKey = new Map(current.map((unit) => [unit.key, unit]));
    const moved = new Set<string>();
    const add = (left?: HistoryUnit, right?: HistoryUnit, move = false): void => {
        if (!move && left?.fingerprint === right?.fingerprint) return;
        changes.push({
            kind: move ? 'moved' : left && right ? 'modified' : left ? 'removed' : 'added',
            before: left,
            after: right,
            text: textParts(left?.text ?? '', right?.text ?? '', deadline),
            formatting: !!left && !!right && left.text === right.text && left.fingerprint !== right.fingerprint,
        });
    };
    if (!diff) {
        previous.forEach((unit) => add(unit));
        current.forEach((unit) => add(undefined, unit));
        return changes;
    }
    let oldIndex = 0;
    for (let index = 0; index < diff.length; index++) {
        const part = diff[index];
        if (!part.added && !part.removed) {
            part.value.forEach((unit, offset) => add(previous[oldIndex + offset], unit));
            oldIndex += part.value.length;
        } else if (part.removed && diff[index + 1]?.added) {
            const added = diff[++index].value;
            const remaining = [...added];
            for (const unit of part.value) {
                const match = remaining.findIndex((candidate) => candidate.kind === unit.kind);
                if (match >= 0) add(unit, remaining.splice(match, 1)[0]);
                else add(unit);
            }
            remaining.forEach((unit) => add(undefined, unit));
            oldIndex += part.value.length;
        } else {
            for (const unit of part.value) {
                const partner = part.added ? oldByKey.get(unit.key) : newByKey.get(unit.key);
                if (partner && !moved.has(unit.key)) {
                    add(part.removed ? unit : partner, part.added ? unit : partner, true);
                    moved.add(unit.key);
                } else if (!partner) add(part.removed ? unit : undefined, part.added ? unit : undefined);
            }
            if (part.removed) oldIndex += part.value.length;
        }
    }
    return changes;
}
