import type { NativeDocument, NativeNode } from '../document/model.js';
import { blockText, isTextBlock } from '../editing/text.js';
import type { DocumentScene, TextReading } from '../layout/scene.js';
import { compareReading } from '../layout/text-reading.js';
import type { ShapedParagraph } from '../rendering/text/model.js';

export interface PdfReviewMap {
    version: 1;
    pages: { width: number; height: number }[];
    blocks: {
        id: string;
        aliases: string[];
        text: string;
        empty?: { page: number; x: number; y: number; width: number; height: number }[];
    }[];
    rows: PdfReviewRow[];
}
export interface PdfReviewRow {
    block: string;
    page: number;
    row: number;
    box: { x: number; y: number; width: number; height: number };
    parts: {
        from: number;
        to: number;
        atomic?: boolean;
        offsets?: number[];
        pdfBox?: number[];
        clip?: { x: number; y: number; width: number; height: number };
    }[];
}
export function sceneReviewMap(document: NativeDocument, scene: DocumentScene): PdfReviewMap {
    const blocks: PdfReviewMap['blocks'] = [];
    const visit = (node: NativeNode, ancestors: readonly string[] = []): void => {
        if (isTextBlock(node)) {
            const aliases = [node.id, node.attributes?.id, node.attributes?.nativeId, ...ancestors].filter(
                (id): id is string => typeof id === 'string' && !!id,
            );
            blocks.push({ id: node.id, aliases: [...new Set(aliases)], text: blockText(node) });
        } else {
            const own =
                node.kind === 'doc'
                    ? []
                    : [node.attributes?.id, node.attributes?.nativeId].filter(
                          (id): id is string => typeof id === 'string' && !!id,
                      );
            node.children?.forEach((child) => visit(child, [...ancestors, ...own]));
        }
    };
    visit(document.root);
    const known = new Map(blocks.map((block) => [block.id, block]));
    const rows: PdfReviewRow[] = [];
    const geometry = new Map<string, NonNullable<PdfReviewMap['blocks'][number]['empty']>>();
    const encoder = new TextEncoder();
    const offsets = new WeakMap<ShapedParagraph, Map<number, number>>();
    const shapedLines = new WeakMap<ShapedParagraph, Map<number, number>>();
    const sourceOffset = (shaped: ShapedParagraph): Map<number, number> => {
        const cached = offsets.get(shaped);
        if (cached) return cached;
        const result = new Map<number, number>();
        let byte = 0,
            offset = 0;
        for (const character of shaped.text) {
            result.set(byte, offset);
            byte += encoder.encode(character).length;
            offset += character.length;
        }
        result.set(byte, offset);
        offsets.set(shaped, result);
        return result;
    };
    scene.pages.forEach((page, pageIndex) => {
        for (const line of page.lines) {
            const block = known.get(line.paragraphId);
            if (!block) continue;
            let box = {
                x: Math.max(0, line.left ?? scene.margin),
                y: Math.max(0, line.top),
                width: line.shaped.width,
                height: line.height,
            };
            const cell = page.cells?.find((cell) => cell.cellId === line.cellId);
            if (cell)
                box = {
                    x: Math.max(box.x, cell.x),
                    y: Math.max(box.y, cell.y),
                    width: Math.max(0, Math.min(box.x + box.width, cell.x + cell.width) - Math.max(box.x, cell.x)),
                    height: Math.max(0, Math.min(box.y + box.height, cell.y + cell.height) - Math.max(box.y, cell.y)),
                };
            box.width = Math.max(0, Math.min(box.width, page.width - box.x));
            box.height = Math.max(0, Math.min(box.height, page.height - box.y));
            if (box.width && box.height) {
                const rectangles = geometry.get(block.id) ?? [];
                rectangles.push({ page: pageIndex + 1, ...box });
                geometry.set(block.id, rectangles);
            }
        }
        const lineIndex = new Map<string, (typeof page.lines)[number]>();
        for (const line of page.lines) {
            let starts = shapedLines.get(line.shaped);
            if (!starts) {
                starts = new Map(line.shaped.lines.map((source) => [source.top, source.start]));
                shapedLines.set(line.shaped, starts);
            }
            const start = starts.get(line.originalTop);
            if (start !== undefined) lineIndex.set(JSON.stringify(['paragraph', line.paragraphId, start]), line);
        }
        type Rectangle = { x: number; y: number; width: number; height: number };
        const intersect = (a: Rectangle, b: Rectangle): Rectangle => ({
            x: Math.max(a.x, b.x),
            y: Math.max(a.y, b.y),
            width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
            height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
        });
        const clips: Rectangle[] = [];
        const groups = new Map<string, { part: TextReading; clip?: Rectangle }[]>();
        for (const command of page.commands) {
            if (command.kind === 'clipStart') {
                clips.push(intersect(clips.at(-1) ?? { x: 0, y: 0, width: page.width, height: page.height }, command));
            } else if (command.kind === 'clipEnd') clips.pop();
            else if (command.kind === 'glyphs')
                for (const part of command.reading ?? []) {
                    if (!part.text || part.from >= command.glyphs.length) continue;
                    const group = groups.get(part.group) ?? [];
                    group.push({ part, ...(clips.length ? { clip: clips.at(-1) } : {}) });
                    groups.set(part.group, group);
                }
        }
        let row = 0;
        for (const [group, entries] of groups) {
            const index = row++;
            let key: unknown;
            try {
                key = JSON.parse(group);
            } catch {
                continue;
            }
            if (!Array.isArray(key) || key[0] !== 'paragraph' || typeof key[1] !== 'string') continue;
            const block = known.get(key[1]);
            const line = lineIndex.get(group);
            if (!block || !line) continue;
            const first = line.shaped.sources[0];
            const prefix = first?.nodeId === block.id && !first.editable ? first.to : 0;
            const byteToUtf16 = sourceOffset(line.shaped);
            entries.sort((a, b) => compareReading(a.part.order, b.part.order));
            const ranges = entries.map(({ part, clip }) => {
                const offset = byteToUtf16.get(part.order[0]);
                if (offset === undefined) throw new Error('Invalid PDF review text offset');
                const from = Math.max(0, offset - prefix);
                if (offset < prefix) return { from: 0, to: 0 };
                const atomic = part.order.length > 1;
                let to = Math.min(block.text.length, from + 1);
                let offsets: number[] | undefined;
                if (!atomic) {
                    const positions: number[] = [];
                    let cursor = from;
                    while (positions.length < part.text.length && cursor < block.text.length) {
                        const character = block.text[cursor];
                        if (/[\r\n\uFFFC]/.test(character)) {
                            cursor++;
                            continue;
                        }
                        if (character !== part.text[positions.length])
                            throw new Error(`PDF review source range mismatch (${block.id}:${cursor})`);
                        positions.push(cursor++);
                    }
                    if (positions.length !== part.text.length) throw new Error('Incomplete PDF review source range');
                    to = (positions.at(-1) ?? from - 1) + 1;
                    if (positions.some((position, index) => position !== from + index)) offsets = positions;
                }
                return {
                    from,
                    to,
                    pdfBox: [
                        part.box.x,
                        page.height - part.box.y - part.box.height,
                        part.box.x + part.box.width,
                        page.height - part.box.y,
                    ],
                    ...(atomic ? { atomic: true } : {}),
                    ...(offsets ? { offsets } : {}),
                    ...(clip ? { clip } : {}),
                };
            });
            const parts = entries.map(({ part, clip }) => ({
                ...part,
                box: clip ? intersect(part.box, clip) : part.box,
            }));
            const left = Math.min(...parts.map((part) => part.box.x));
            const top = Math.min(...parts.map((part) => part.box.y));
            rows.push({
                block: block.id,
                page: pageIndex + 1,
                row: index,
                parts: ranges,
                box: {
                    x: left,
                    y: top,
                    width: Math.max(...parts.map((part) => part.box.x + part.box.width)) - left,
                    height: Math.max(...parts.map((part) => part.box.y + part.box.height)) - top,
                },
            });
        }
    });
    const visible = new Set(
        rows.filter((row) => row.parts.some((part) => part.to > part.from)).map((row) => row.block),
    );
    for (const block of blocks)
        if (!visible.has(block.id) && geometry.has(block.id)) block.empty = geometry.get(block.id);
    return {
        version: 1,
        pages: scene.pages.map(({ width, height }) => ({ width, height })),
        blocks: blocks.filter((block) => visible.has(block.id) || block.empty?.length),
        rows,
    };
}
