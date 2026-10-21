import type { Affinity } from 'canvaskit-wasm';
import type { Attributes, NativeDocument } from './document.js';
import { createDocumentScene } from './flow.js';
import type { NativeTextKernel, ShapedParagraph } from './kernel.js';
import type { Color } from './style.js';

export interface GlyphCommand {
    readonly kind?: 'glyphs';
    readonly fontId: string;
    readonly size: number;
    readonly glyphs: readonly number[];
    readonly text: readonly string[];
    readonly positions: readonly number[];
    readonly color?: Color;
    readonly fauxBold?: boolean;
    readonly fauxItalic?: boolean;
    readonly reading?: readonly TextReading[];
}
export interface TextReading {
    readonly from: number;
    readonly to: number;
    readonly group: string;
    readonly order: readonly number[];
    readonly text: string;
    readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface RectCommand {
    readonly kind: 'rect';
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly color: Color;
    readonly tableBackground?: number;
}
export interface LineCommand {
    readonly kind: 'line';
    readonly x: number;
    readonly y: number;
    readonly toX: number;
    readonly toY: number;
    readonly width: number;
    readonly color: Color;
}
export interface ImageCommand {
    readonly kind: 'image';
    readonly assetId: string;
    readonly nodeId?: string;
    readonly attributes?: Attributes;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
export interface LinkCommand {
    readonly kind: 'link';
    readonly href: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
export interface FieldCommand {
    readonly kind: 'field';
    readonly nodeId: string;
    readonly attributes: Attributes;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
export type PaintCommand =
    | GlyphCommand
    | RectCommand
    | LineCommand
    | ImageCommand
    | LinkCommand
    | FieldCommand
    | ClipStartCommand
    | ClipEndCommand;
export interface ClipStartCommand {
    readonly kind: 'clipStart';
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
export interface ClipEndCommand {
    readonly kind: 'clipEnd';
}

export interface SceneLine {
    readonly paragraphId: string;
    readonly textNodeId: string;
    readonly left?: number;
    readonly top: number;
    readonly height: number;
    readonly originalTop: number;
    readonly shaped: ShapedParagraph;
    readonly cellId?: string;
    readonly columnIds?: readonly string[];
}

export interface SceneColumn {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface ScenePage {
    readonly width: number;
    readonly height: number;
    readonly commands: readonly PaintCommand[];
    readonly lines: readonly SceneLine[];
    readonly cells?: readonly SceneCell[];
    readonly columns?: readonly SceneColumn[];
    readonly blocks?: readonly SceneColumn[];
}

export interface SceneCell {
    readonly tableId: string;
    readonly cellId: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly tableX: number;
    readonly columnEdges: readonly number[];
    readonly direction: 'ltr' | 'rtl';
}

export function cellAt(scene: DocumentScene, pageIndex: number, x: number, y: number): SceneCell | undefined {
    return scene.pages[pageIndex]?.cells
        ?.filter((cell) => x >= cell.x && x <= cell.x + cell.width && y >= cell.y && y <= cell.y + cell.height)
        .sort((a, b) => a.width * a.height - b.width * b.height)[0];
}

export function columnAt(scene: DocumentScene, pageIndex: number, x: number, y: number): SceneColumn | undefined {
    return scene.pages[pageIndex]?.columns
        ?.filter(
            (column) => x >= column.x && x <= column.x + column.width && y >= column.y && y <= column.y + column.height,
        )
        .sort((a, b) => a.width * a.height - b.width * b.height)[0];
}

export interface DocumentScene {
    readonly documentId: string;
    readonly revision: number;
    readonly fontHash: string;
    readonly pages: readonly ScenePage[];
    readonly margin: number;
    readonly glyphCount: number;
    readonly coverPages?: number;
}

export function layoutDocument(
    document: NativeDocument,
    kernel: NativeTextKernel,
    surfaceWidth?: number,
): DocumentScene {
    return createDocumentScene(document, kernel, surfaceWidth);
}

export function assertSceneRevision(scene: DocumentScene, document: NativeDocument, fontHash: string): void {
    if (scene.documentId !== document.id || scene.revision !== document.revision)
        throw new Error('The displayed layout is stale');
    if (scene.fontHash !== fontHash) throw new Error('The document font has changed');
}

export function hitTest(
    scene: DocumentScene,
    pageIndex: number,
    x: number,
    y: number,
): { nodeId: string; offset: number; blockId: string; blockOffset: number; affinity: Affinity } | null {
    const page = scene.pages[pageIndex],
        cell = cellAt(scene, pageIndex, x, y),
        column = columnAt(scene, pageIndex, x, y);
    const includes = (line: SceneLine) =>
        (!cell || line.cellId === cell.cellId) && (!column || line.columnIds?.includes(column.id));
    let candidates =
        page?.lines.filter(includes).map((line) => ({
            line,
            top: line.top,
        })) ?? [];
    if ((cell || column) && !candidates.length) {
        const offsets = [0];
        for (const page of scene.pages) offsets.push(offsets.at(-1)! + page.height);
        candidates = scene.pages.flatMap((page, index) =>
            page.lines.filter(includes).map((line) => ({ line, top: line.top + offsets[index] - offsets[pageIndex] })),
        );
    }
    if (!candidates.length) return null;
    const distance = ({ line, top }: { line: SceneLine; top: number }): number => {
        const left = line.left ?? scene.margin;
        const dx = Math.max(left - x, 0, x - left - line.shaped.width);
        const dy = Math.max(top - y, 0, y - top - line.height);
        return dx * dx + dy * dy + Math.abs(top + line.height / 2 - y) * 0.001;
    };
    const { line, top } = candidates.reduce((best, candidate) =>
        distance(candidate) < distance(best) ? candidate : best,
    );
    const position = line.shaped.paragraph.getGlyphPositionAtCoordinate(
        x - (line.left ?? scene.margin),
        Math.max(0, Math.min(y - top, line.height - 0.001)) + line.originalTop,
    );
    const bounded = Math.min(position.pos, line.shaped.text.length);
    const source =
        line.shaped.sources.find((source) => bounded >= source.from && bounded < source.to) ??
        line.shaped.sources[line.shaped.sources.length - 1];
    const first = line.shaped.sources[0];
    const prefix = first?.nodeId === line.paragraphId && !first.editable ? first.to : 0;
    return {
        nodeId: source?.nodeId ?? line.paragraphId,
        offset: source ? Math.max(0, Math.min(bounded - source.from, source.to - source.from)) : 0,
        blockId: line.paragraphId,
        blockOffset: Math.max(0, bounded - prefix),
        affinity: position.affinity,
    };
}
