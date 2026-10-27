import { diffArrays } from 'diff';
import { findNode, importDocument, type NativeDocument, type NativeNode } from '../document/index.js';
import { blockText, isTextBlock, replaceBlockNode, replaceInlineText, textBlocks, update } from './text.js';

export interface ProposalInlineContent {
    type: string;
    text?: string;
    marks?: unknown[];
    attrs?: Record<string, unknown>;
}
export interface ProposalBlockSnapshot {
    blockId: string;
    clause: string | null;
    text: string;
    marked: string;
    content: ProposalInlineContent[] | null;
}
export interface ProposalChange {
    blockId: string;
    clause: string | null;
    before: string;
    after: string;
    markedBefore: string;
    markedAfter: string;
    contentBefore: ProposalInlineContent[] | null;
    contentAfter: ProposalInlineContent[] | null;
    itemIds?: string[];
    itemContentAfter?: ProposalInlineContent[][];
}
export interface ProposalEngineOptions {
    sameContent: (a: ProposalInlineContent[] | null, b: ProposalInlineContent[] | null) => boolean;
    sameFields: (a: ProposalInlineContent[] | null, b: ProposalInlineContent[] | null) => boolean;
    fixedFieldAttributes: (node: NativeNode) => unknown;
    limits?: { items?: number; text?: number; id?: number };
}
const ITEM_BREAK = '\u2029';

export interface ProposalPolicy {
    locked?: ReadonlySet<string>;
    fields?: boolean;
}
export interface ProposalReplay {
    document: NativeDocument;
    conflicts: ProposalChange[];
}
const ATOM = '\uFFFC';
const normalize = (text: string): string => text.replace(/[^\S \n\u2029]/g, ' ').replace(/^[ \n]+|[ \n]+$/g, '');
const equivalent = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const metadata = (node: NativeNode): unknown => [node.id, node.kind, node.attributes, node.marks, node.text];
export class NativeReviewViolation extends Error {}

export function proposalInline(block: NativeNode): ProposalInlineContent[] | null {
    if (block.children?.some((child) => !['text', 'variable', 'hardBreak', 'image'].includes(child.kind))) return null;
    return (block.children ?? []).map((node) =>
        node.kind === 'image'
            ? { type: 'image', attrs: { id: node.id } }
            : {
                  type: node.kind,
                  ...(node.text === undefined ? {} : { text: node.text }),
                  ...(node.attributes === undefined ? {} : { attrs: node.attributes }),
                  ...(node.marks === undefined
                      ? {}
                      : {
                            marks: node.marks.map((mark) => ({
                                type: mark.kind,
                                ...(mark.attributes ? { attrs: mark.attributes } : {}),
                            })),
                        }),
              },
    );
}
const snapshotCache = new WeakMap<NativeNode, Map<string, ProposalBlockSnapshot>>();
export function proposalSnapshots(document: NativeDocument): Map<string, ProposalBlockSnapshot> {
    const cached = snapshotCache.get(document.root);
    if (cached) return cached;
    const snapshots = new Map<string, ProposalBlockSnapshot>();
    let clause: string | null = null;
    const visit = (node: NativeNode, parent?: NativeNode): void => {
        if (isTextBlock(node)) {
            const raw = blockText(node).replaceAll(ITEM_BREAK, ' ');
            const runs = (node.children ?? []).filter((child) => child.text?.trim());
            if (
                ['heading', 'clauseTitle'].includes(node.kind) ||
                (parent?.kind === 'doc' &&
                    runs.length > 0 &&
                    runs.every((child) => child.marks?.some((mark) => mark.kind === 'bold')))
            ) {
                clause = raw.replaceAll(ATOM, '').replace(/\s+/g, ' ').trim().slice(0, 255) || clause;
            }
            snapshots.set(node.id, {
                blockId: node.id,
                clause,
                text: raw.replace(/\s*\uFFFC\s*/g, (run) => (run.includes('\n') ? '\n' : ' ')),
                marked: raw,
                content: proposalInline(node),
            });
        } else node.children?.forEach((child) => visit(child, node));
    };
    visit(document.root);
    snapshotCache.set(document.root, snapshots);
    return snapshots;
}
const withChildren = (node: NativeNode, children: readonly NativeNode[]): NativeNode =>
    Object.freeze({ ...node, children: Object.freeze(children) });
function inlineNodes(
    content: ProposalInlineContent[],
    current?: NativeNode,
    preserveFields = true,
): readonly NativeNode[] {
    const clean = content.map((node) =>
        ['variable', 'image'].includes(node.type) ? node : { ...node, attrs: undefined },
    );
    const children =
        importDocument({ type: 'doc', content: [{ type: 'paragraph', content: clean }] }, crypto.randomUUID()).root
            .children![0].children ?? [];
    const fields = new Map(
        current?.children
            ?.filter((node) => node.kind === 'image' || (preserveFields && node.kind === 'variable'))
            .map((node) => [node.id, node]),
    );
    return Object.freeze(children.map((node) => (fields.has(node.id) ? fields.get(node.id)! : node)));
}
function* nodes(node: NativeNode): Generator<NativeNode> {
    yield node;
    for (const child of node.children ?? []) yield* nodes(child);
}
function collapsed(raw: string): { text: string; offsets: number[] } {
    let text = '';
    const offsets: number[] = [];
    let pending: number[] = [];
    for (let index = 0; index < raw.length; index++) {
        if (/\s/u.test(raw[index])) {
            pending.push(index);
            continue;
        }
        if (text)
            for (const at of pending) {
                text += raw[at] === '\n' ? '\n' : ' ';
                offsets.push(at);
            }
        pending = [];
        text += raw[index];
        offsets.push(index);
    }
    offsets.push(pending[0] ?? raw.length);
    return { text, offsets };
}
function replayText(
    document: NativeDocument,
    block: NativeNode,
    target: string,
    exact: boolean,
): NativeDocument | null {
    const raw = blockText(block);
    const { text, offsets } = exact
            ? { text: raw, offsets: Array.from({ length: raw.length + 1 }, (_, index) => index) }
            : collapsed(raw),
        from = text.split(ATOM),
        to = (exact ? target : normalize(target)).split(ATOM);
    if (from.length !== to.length) return null;
    const cuts: { from: number; to: number; text: string }[] = [];
    let offset = 0;
    for (let index = 0; index < from.length; index++) {
        const a = [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(from[index])].map(
            (part) => part.segment,
        );
        const b = [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(to[index])].map(
            (part) => part.segment,
        );
        let cursor = 0,
            start: number | undefined,
            end = 0,
            insert = '';
        const flush = () => {
            if (start === undefined) return;
            cuts.push({ from: offsets[offset + start], to: offsets[offset + end], text: insert });
            start = undefined;
            insert = '';
        };
        for (const part of diffArrays(a, b)) {
            const value = part.value.join('');
            if (!part.added && !part.removed) {
                flush();
                cursor += value.length;
                continue;
            }
            start ??= cursor;
            if (part.removed) cursor += value.length;
            else insert += value;
            end = cursor;
        }
        flush();
        offset += from[index].length + 1;
    }
    for (const cut of cuts.reverse())
        document = replaceInlineText(document, { ...cut, blockId: block.id, expectedRevision: document.revision });
    return document;
}
function addedItems(base: NativeDocument, candidate: NativeDocument): Map<string, NativeNode[]> {
    const official = new Set(textBlocks(base.root).map((node) => node.id));
    const result = new Map<string, NativeNode[]>();
    const visit = (node: NativeNode): void => {
        if (['orderedList', 'bulletList'].includes(node.kind)) {
            let owner: string | undefined;
            for (const item of node.children ?? []) {
                const paragraph =
                    item.children?.length === 1 && item.children[0].kind === 'paragraph' ? item.children[0] : undefined;
                if (!paragraph || official.has(paragraph.id)) owner = paragraph?.id;
                else if (owner) result.set(owner, [...(result.get(owner) ?? []), paragraph]);
            }
        }
        node.children?.forEach(visit);
    };
    visit(candidate.root);
    return result;
}

export function createProposalEngine(options: ProposalEngineOptions) {
    const { sameContent, sameFields } = options;
    function assertReviewProposal(base: NativeDocument, candidate: NativeDocument, policy: ProposalPolicy = {}): void {
        const original = new Map<string, NativeNode>();
        const collect = (node: NativeNode): void => {
            original.set(node.id, node);
            node.children?.forEach(collect);
        };
        collect(base.root);
        const reject = (): never => {
            throw new NativeReviewViolation('This change is outside the editable review text');
        };
        const visit = (before: NativeNode, after: NativeNode): void => {
            if (before === after) return;
            if (!equivalent(metadata(before), metadata(after))) reject();
            if (
                policy.locked?.has(before.id) ||
                (typeof before.attributes?.id === 'string' && policy.locked?.has(before.attributes.id))
            ) {
                if (!equivalent(before, after)) reject();
                return;
            }
            if (isTextBlock(before)) {
                const atoms = (node: NativeNode) =>
                    (node.children ?? []).filter((child) => !['text', 'hardBreak'].includes(child.kind));
                const oldAtoms = atoms(before),
                    newAtoms = atoms(after);
                if (!policy.fields && !equivalent(oldAtoms, newAtoms)) reject();
                if (after.children?.some((child) => !['text', 'hardBreak', 'variable', 'image'].includes(child.kind)))
                    reject();
                if (
                    !equivalent(
                        oldAtoms.filter((child) => child.kind === 'image'),
                        newAtoms.filter((child) => child.kind === 'image'),
                    )
                )
                    reject();
                if (
                    blockText(before) === blockText(after) &&
                    sameFields(proposalInline(before), proposalInline(after)) &&
                    !sameContent(proposalInline(before), proposalInline(after))
                )
                    reject();
                if (policy.fields) {
                    for (const atom of newAtoms) {
                        const previous = oldAtoms.find((node) => node.id === atom.id);
                        if (
                            previous &&
                            !equivalent(options.fixedFieldAttributes(previous), options.fixedFieldAttributes(atom))
                        )
                            reject();
                    }
                }
                if (proposalInline(before) === null && !equivalent(oldAtoms, newAtoms)) reject();
                return;
            }
            const children = before.children ?? [],
                next = after.children ?? [];
            if (!['orderedList', 'bulletList'].includes(before.kind)) {
                if (children.length !== next.length) reject();
                children.forEach((child, index) => visit(child, next[index]));
                return;
            }
            let index = 0;
            let owner: NativeNode | undefined;
            for (const child of next) {
                if (children[index]?.id === child.id) {
                    visit(children[index++], child);
                    owner = child;
                    continue;
                }
                const source =
                    owner?.children?.length === 1 && owner.children[0].kind === 'paragraph'
                        ? owner.children[0]
                        : undefined;
                const extra = child.children?.length === 1 ? child.children[0] : undefined;
                if (
                    !source ||
                    !extra ||
                    child.kind !== 'listItem' ||
                    extra.kind !== 'paragraph' ||
                    original.has(child.id) ||
                    original.has(extra.id) ||
                    policy.locked?.has(source.id) ||
                    (typeof source.attributes?.id === 'string' && policy.locked?.has(source.attributes.id))
                )
                    reject();
                const attrs = (node: NativeNode) =>
                    Object.fromEntries(
                        Object.entries(node.attributes ?? {}).filter(([key]) => !['id', 'nativeId'].includes(key)),
                    );
                if (
                    !equivalent(attrs(owner!), attrs(child)) ||
                    !equivalent(attrs(source!), attrs(extra!)) ||
                    extra!.children?.some((node) => !['text', 'hardBreak'].includes(node.kind))
                )
                    reject();
            }
            if (index !== children.length) reject();
        };
        const seen = new Set<string>();
        for (const node of nodes(candidate.root)) {
            if (seen.has(node.id)) reject();
            seen.add(node.id);
        }
        if (base.id !== candidate.id) reject();
        visit(base.root, candidate.root);
    }
    function proposalChanges(
        base: NativeDocument,
        candidate: NativeDocument,
        policy: ProposalPolicy = {},
    ): ProposalChange[] {
        assertReviewProposal(base, candidate, policy);
        const before = proposalSnapshots(base),
            after = proposalSnapshots(candidate),
            added = addedItems(base, candidate);
        const changes: ProposalChange[] = [];
        for (const [id, previous] of before) {
            const current = after.get(id)!;
            const items = added.get(id) ?? [],
                extra = items.map((node) => after.get(node.id)!);
            const plain = [current.text, ...extra.map((item) => item.text)].join(ITEM_BREAK);
            if (
                previous.text === plain &&
                previous.marked === current.marked &&
                sameFields(previous.content, current.content) &&
                items.length === 0
            )
                continue;
            if (
                items.length > (options.limits?.items ?? Infinity) ||
                [plain, previous.text, current.marked].some(
                    (text) => text.length > (options.limits?.text ?? Infinity),
                ) ||
                id.length > (options.limits?.id ?? Infinity)
            )
                throw new NativeReviewViolation('The proposed paragraph exceeds the review limit');
            changes.push({
                blockId: id,
                clause: previous.clause,
                before: previous.text,
                after: plain,
                markedBefore: previous.marked,
                markedAfter: [current.marked, ...extra.map((item) => item.marked)].join(ITEM_BREAK),
                contentBefore: previous.content,
                contentAfter: current.content,
                ...(items.length
                    ? { itemIds: items.map((node) => node.id), itemContentAfter: extra.map((item) => item.content!) }
                    : {}),
            });
        }
        return changes;
    }
    function replayProposals(base: NativeDocument, changes: readonly ProposalChange[]): ProposalReplay {
        let document = base;
        const conflicts: ProposalChange[] = [];
        const snapshots = proposalSnapshots(base),
            processed = new Set<string>();
        for (const change of changes) {
            const block =
                findNode(base, change.blockId) ??
                [...nodes(base.root)].find((node) => isTextBlock(node) && node.attributes?.id === change.blockId);
            const current = block && snapshots.get(block.id);
            if (block && processed.has(block.id)) {
                conflicts.push(change);
                continue;
            }
            if (block) processed.add(block.id);
            if (
                !current ||
                !block ||
                (change.contentBefore
                    ? current.marked !== change.markedBefore
                    : normalize(current.marked) !== normalize(change.markedBefore)) ||
                (change.contentBefore !== null && !sameFields(current.content, change.contentBefore))
            ) {
                conflicts.push(change);
                continue;
            }
            const textOnly = sameFields(change.contentBefore, change.contentAfter);
            let next =
                textOnly &&
                !(change.contentAfter && change.contentBefore && sameContent(current.content, change.contentBefore))
                    ? replayText(
                          document,
                          block,
                          change.markedAfter.split(ITEM_BREAK)[0],
                          change.contentBefore !== null,
                      )
                    : change.contentAfter &&
                      replaceBlockNode(document, block.id, (node) =>
                          withChildren(node, inlineNodes(change.contentAfter!, node, textOnly)),
                      );
            if (!next) {
                conflicts.push(change);
                continue;
            }
            if (change.itemIds?.length) {
                const item = [...nodes(next.root)].find(
                    (node) =>
                        node.kind === 'listItem' && node.children?.length === 1 && node.children[0].id === block.id,
                );
                const list =
                    item &&
                    [...nodes(next.root)].find(
                        (node) => ['bulletList', 'orderedList'].includes(node.kind) && node.children?.includes(item),
                    );
                const contents =
                    change.itemContentAfter ??
                    change.markedAfter
                        .split(ITEM_BREAK)
                        .slice(1)
                        .map((text): ProposalInlineContent[] => [{ type: 'text', text }]);
                if (!item || !list || contents.length !== change.itemIds.length) {
                    conflicts.push(change);
                    continue;
                }
                const attrs = (node: NativeNode, id: string) => Object.freeze({ ...node.attributes, id, nativeId: id });
                const extra = change.itemIds.map(
                    (id, index): NativeNode =>
                        Object.freeze({
                            ...item,
                            id: crypto.randomUUID(),
                            attributes: Object.freeze(
                                Object.fromEntries(
                                    Object.entries(item.attributes ?? {}).filter(
                                        ([key]) => !['id', 'nativeId'].includes(key),
                                    ),
                                ),
                            ),
                            children: Object.freeze([
                                withChildren(
                                    { ...block, id, attributes: attrs(block, id) },
                                    inlineNodes(contents[index]),
                                ),
                            ]),
                        }),
                );
                const index = list.children!.indexOf(item);
                next = update(next, list, [
                    withChildren(list, [
                        ...list.children!.slice(0, index + 1),
                        ...extra,
                        ...list.children!.slice(index + 1),
                    ]),
                ]);
            }
            try {
                assertReviewProposal(base, next, { fields: true });
                document = next;
            } catch {
                conflicts.push(change);
            }
        }
        return { document, conflicts };
    }

    return { assertReviewProposal, proposalChanges, replayProposals };
}
