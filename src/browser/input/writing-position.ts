import { documentPageLayout } from '../../content/page-layout.js';
import { findNode, type NativeDocument } from '../../document/model.js';
import { nodePath, textBlocks } from '../../document/text.js';
import type { WritingTarget } from '../../editing/writing-position.js';
import { cellAt, columnAt, type DocumentScene } from '../../layout/scene.js';
import { inheritedDirection } from '../../typography/direction.js';
import { DEFAULT_TEXT_STYLE } from '../../typography/style.js';

export interface EmptyWritingPosition {
    readonly target: WritingTarget;
    readonly pageIndex: number;
    readonly x: number;
    readonly y: number;
    readonly height: number;
}

export function emptyWritingPosition(
    document: NativeDocument,
    scene: DocumentScene,
    pageIndex = 0,
    point?: { x: number; y: number },
    target?: WritingTarget,
): EmptyWritingPosition | undefined {
    if (scene.documentId !== document.id || scene.revision !== document.revision) return;
    if (document.root.children?.some((node) => node.kind === 'pdfPage')) return;
    pageIndex = Math.max(scene.coverPages ?? 0, pageIndex);
    const page = scene.pages[pageIndex];
    if (!page) return;
    const anchorPath = target?.afterId ? nodePath(document, target.afterId) : undefined;
    if (target?.afterId && (!anchorPath || anchorPath.length < 2)) return;
    const requestedContainer = target?.containerId ?? anchorPath?.at(-2)?.id;
    const candidates = requestedContainer
        ? [requestedContainer]
        : point
          ? [cellAt(scene, pageIndex, point.x, point.y)?.cellId, columnAt(scene, pageIndex, point.x, point.y)?.id]
          : [...(page.cells?.map((cell) => cell.cellId) ?? []), ...(page.columns?.map((column) => column.id) ?? [])];
    const scopes = [...new Set(candidates.filter((id): id is string => !!id))].sort(
        (a, b) => nodePath(document, b).length - nodePath(document, a).length,
    );
    const id = scopes[0] ?? document.root.id;
    const container = findNode(document, id);
    if (!container || (!target?.afterId && textBlocks(container).length)) return;
    const after = target?.afterId
        ? container.children?.find((node) => node.id === target.afterId)
        : container.children?.at(-1);
    if (target?.afterId && !after) return;
    const cell = page.cells?.find((cell) => cell.cellId === id);
    const column = page.columns?.find((column) => column.id === id);
    if (id !== document.root.id && !cell && !column) return;
    const margins = documentPageLayout(document).margins;
    const bounds = cell ??
        column ?? {
            x: margins.left * 0.75,
            y: margins.top * 0.75,
            width: page.width - (margins.left + margins.right) * 0.75,
            height: page.height - (margins.top + margins.bottom) * 0.75,
        };
    const path = nodePath(document, id);
    const direction = path.reduce<'ltr' | 'rtl'>((value, node) => inheritedDirection(node, value), 'rtl');
    const inset = cell ? 6 : 0;
    const block = after && page.blocks?.filter((block) => block.id === after.id).at(-1);
    return {
        target: { containerId: id, ...(after ? { afterId: after.id } : {}) },
        pageIndex,
        x: direction === 'rtl' ? bounds.x + bounds.width - inset : bounds.x + inset,
        y: block ? block.y + block.height : bounds.y + inset,
        height: Math.max(2, Math.min(DEFAULT_TEXT_STYLE.size * 1.6, bounds.height - inset * 2)),
    };
}
