import type { Attributes, Json, NativeDocument, NativeNode } from './document.js';
import type { FieldPlacement } from './field-placement.js';
import type { DocumentScene, ScenePage } from './layout.js';

const GAP = 22.5;
interface AnchorTarget {
    block: string;
    edge: 'start' | 'end';
}
interface FloatingAnchor extends AnchorTarget {
    x: number;
    y: number;
    fallbacks: AnchorTarget[];
}
interface Origin {
    page: number;
    x: number;
    y: number;
}
interface Bounds {
    start: Origin;
    end: Origin;
}
export interface FloatingAnchorIndex {
    bounds: Map<string, Bounds>;
    roots: readonly NativeNode[];
    pages: readonly ScenePage[];
    coverPages: number;
    offsets: readonly number[];
}
const record = (value: unknown): value is Record<string, Json> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
const fixed = (value: number) => Math.round(value * 1024) / 1024;
const target = (value: unknown): value is AnchorTarget =>
    record(value) &&
    typeof value.block === 'string' &&
    value.block.length > 0 &&
    value.block.length <= 2048 &&
    (value.edge === 'start' || value.edge === 'end');
function anchor(value: unknown): FloatingAnchor | undefined {
    if (
        !target(value) ||
        !record(value) ||
        typeof value.x !== 'number' ||
        typeof value.y !== 'number' ||
        ![value.x, value.y].every((number) => Number.isFinite(number) && Math.abs(number) <= 10_000_000) ||
        !Array.isArray(value.fallbacks) ||
        value.fallbacks.length > 4 ||
        !value.fallbacks.every(target)
    )
        return;
    return value as unknown as FloatingAnchor;
}
export function followsText(attrs: Attributes): boolean {
    return attrs.surface !== 'cover' && !(typeof attrs.src === 'string' && attrs.locked === true);
}
export function floatingAnchorIndex(
    document: NativeDocument,
    scene: Pick<DocumentScene, 'pages' | 'coverPages'>,
): FloatingAnchorIndex {
    const bounds = new Map<string, Bounds>(),
        parents = new Map<string, string>();
    const textRoots = new Set(
        document.root.children
            ?.filter((node) => ['paragraph', 'heading', 'codeBlock', 'clauseTitle'].includes(node.kind))
            .map((node) => node.id),
    );
    const visit = (node: NativeNode): void => {
        node.children?.forEach((child) => {
            parents.set(child.id, node.id);
            visit(child);
        });
    };
    visit(document.root);
    const coverPages = scene.coverPages ?? 0;
    const add = (
        id: string,
        page: number,
        x: number,
        y: number,
        width: number,
        height: number,
        inherit = false,
    ): void => {
        if (page < coverPages) return;
        const start = { page: page - coverPages, x, y },
            end = { page: page - coverPages, x, y: y + height };
        const old = bounds.get(id);
        bounds.set(id, {
            start:
                !old || start.page < old.start.page || (start.page === old.start.page && start.y < old.start.y)
                    ? start
                    : old.start,
            end: !old || end.page > old.end.page || (end.page === old.end.page && end.y > old.end.y) ? end : old.end,
        });
        const parent = parents.get(id);
        if (inherit && parent && parent !== document.root.id) add(parent, page, x, y, width, height, true);
    };
    scene.pages.forEach((page, index) => {
        const paragraphs = new Set(page.lines.map((line) => line.paragraphId));
        page.blocks?.forEach((block) => {
            if (!textRoots.has(block.id) || !paragraphs.has(block.id))
                add(block.id, index, block.x, block.y, block.width, block.height);
        });
        page.lines.forEach((line) =>
            add(line.paragraphId, index, line.left ?? 0, line.top, line.shaped.width, line.height, true),
        );
        page.cells?.forEach((cell) => add(cell.tableId, index, cell.tableX, cell.y, cell.width, cell.height, true));
    });
    const offsets = [0];
    for (const page of scene.pages.slice(coverPages)) offsets.push(offsets.at(-1)! + page.height + GAP);
    return { bounds, roots: document.root.children ?? [], pages: scene.pages, coverPages, offsets };
}
function origin(index: FloatingAnchorIndex, destination: AnchorTarget): Origin | undefined {
    return index.bounds.get(destination.block)?.[destination.edge];
}
function globalY(index: FloatingAnchorIndex, point: Origin): number {
    return point.y + (index.offsets[point.page] ?? point.page * (index.pages[index.coverPages].height + GAP));
}
export function anchorForPlacement(index: FloatingAnchorIndex, placement: FieldPlacement): Attributes | undefined {
    if (placement.page < index.coverPages) return;
    const y = globalY(index, { page: placement.page - index.coverPages, x: placement.x, y: placement.y });
    const candidates = index.roots.flatMap((node) => {
        const bounds = index.bounds.get(node.id);
        return bounds ? [{ node, bounds, start: globalY(index, bounds.start), end: globalY(index, bounds.end) }] : [];
    });
    const containing = candidates.find((entry) => y >= entry.start && y <= entry.end);
    const previous = candidates.findLast((entry) => entry.end < y);
    const chosen = containing ?? previous ?? candidates[0];
    if (!chosen) return;
    const edge = containing || !previous ? 'start' : 'end';
    const base = chosen.bounds[edge];
    const position = index.roots.indexOf(chosen.node);
    const descendants: string[] = [];
    const collect = (node: NativeNode): void => {
        node.children?.forEach((child) => {
            if (
                ![
                    'text',
                    'clauseBody',
                    'parallelCell',
                    'listItem',
                    'tableRow',
                    'tableRowGroup',
                    'tableCell',
                    'tableHeader',
                ].includes(child.kind) &&
                index.bounds.has(child.id)
            )
                descendants.push(child.id);
            collect(child);
        });
    };
    collect(chosen.node);
    const descendantsByEdge = [
        ...new Set(edge === 'start' ? [descendants[0], descendants.at(-1)] : [descendants.at(-1), descendants[0]]),
    ].filter((id): id is string => !!id);
    const next = index.roots[position + 1]?.id,
        before = index.roots[position - 1]?.id;
    const fallbacks = [
        ...descendantsByEdge.map((block) => ({ block, edge })),
        ...(edge === 'start'
            ? [next && { block: next, edge: 'start' }, before && { block: before, edge: 'end' }]
            : [before && { block: before, edge: 'end' }, next && { block: next, edge: 'start' }]),
    ].filter((value): value is AnchorTarget => !!value);
    return Object.freeze({
        block: chosen.node.id,
        edge,
        x: fixed(placement.x - base.x),
        y: fixed(y - globalY(index, base)),
        fallbacks: Object.freeze(fallbacks.map((value) => Object.freeze(value))),
    });
}
export function resolveFloatingAnchor(
    attrs: Attributes,
    placement: FieldPlacement,
    index: FloatingAnchorIndex,
): FieldPlacement {
    if (!followsText(attrs) || attrs.nativeAnchor === undefined || attrs.nativeAnchor === null) return placement;
    const saved = anchor(attrs.nativeAnchor);
    if (!saved) throw new Error('The floating object anchor is invalid');
    const base = origin(index, saved) ?? saved.fallbacks.map((fallback) => origin(index, fallback)).find(Boolean);
    if (!base) return placement;
    const dimensions = index.pages[index.coverPages];
    if (!dimensions) return placement;
    const stride = dimensions.height + GAP,
        y = Math.max(0, globalY(index, base) + saved.y);
    let page = Math.floor(y / stride),
        localY = y - page * stride;
    const width = Math.min(placement.width, dimensions.width),
        height = Math.min(placement.height, dimensions.height);
    if (localY + height > dimensions.height && stride - localY < localY - (dimensions.height - height)) {
        page++;
        localY = 0;
    }
    return {
        page,
        x: fixed(Math.max(0, Math.min(dimensions.width - width, base.x + saved.x))),
        y: fixed(Math.max(0, Math.min(dimensions.height - height, localY))),
        width,
        height,
    };
}
export function bindFloatingAnchors(document: NativeDocument, scene: DocumentScene): NativeDocument {
    if (scene.documentId !== document.id || scene.revision !== document.revision)
        throw new Error('The floating object layout is stale');
    if (
        !['blockVariables', 'floatingImages'].some(
            (name) =>
                Array.isArray(document.root.attributes?.[name]) &&
                (document.root.attributes![name] as readonly Json[]).length,
        )
    )
        return document;
    const index = floatingAnchorIndex(document, scene),
        boxes = new Map<string, FieldPlacement>();
    scene.pages.forEach((page, number) =>
        page.commands.forEach((command) => {
            if ((command.kind === 'field' || command.kind === 'image') && command.nodeId)
                boxes.set(command.nodeId, {
                    page: number,
                    x: command.x,
                    y: command.y,
                    width: command.width,
                    height: command.height,
                });
        }),
    );
    let changed = false;
    const attributes = { ...document.root.attributes };
    for (const name of ['blockVariables', 'floatingImages']) {
        const entries = attributes[name];
        if (!Array.isArray(entries)) continue;
        attributes[name] = Object.freeze(
            entries.map((entry) => {
                if (!record(entry) || typeof entry.id !== 'string') return entry;
                if (!followsText(entry)) {
                    if (entry.nativeAnchor === undefined) return entry;
                    const clean = { ...entry };
                    delete clean.nativeAnchor;
                    changed = true;
                    return Object.freeze(clean);
                }
                const saved = anchor(entry.nativeAnchor);
                if (saved && (origin(index, saved) || saved.fallbacks.some((fallback) => origin(index, fallback))))
                    return entry;
                const box = boxes.get(entry.id),
                    value = box && anchorForPlacement(index, box);
                if (!value) return entry;
                changed = true;
                return Object.freeze({ ...entry, nativeAnchor: value });
            }),
        );
    }
    return changed
        ? Object.freeze({
              ...document,
              root: Object.freeze({ ...document.root, attributes: Object.freeze(attributes) }),
          })
        : document;
}
