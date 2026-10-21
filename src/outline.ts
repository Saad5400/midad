import type { NativeDocument, NativeNode } from './document.js';
import { blockText } from './editing.js';
import type { DocumentScene } from './layout.js';

export interface OutlineHeading {
    readonly id: string;
    readonly level: number;
    readonly text: string;
    readonly page: number;
    readonly top: number;
}
export interface OutlineGroup {
    readonly page: number;
    readonly headings: readonly OutlineHeading[];
}
export function documentOutline(document: NativeDocument, scene: DocumentScene): readonly OutlineGroup[] {
    if (document.id !== scene.documentId || document.revision !== scene.revision)
        throw new Error('The outline layout is stale');
    const locations = new Map<string, { page: number; top: number }>();
    scene.pages.forEach((page, index) =>
        page.lines.forEach((line) => {
            if (!locations.has(line.paragraphId)) locations.set(line.paragraphId, { page: index + 1, top: line.top });
        }),
    );
    const collect = (node: NativeNode): OutlineHeading[] => {
        if (node.kind === 'heading' || node.kind === 'clauseTitle') {
            const text = blockText(node).replaceAll('\uFFFC', '').trim();
            const location = locations.get(node.id);
            return text && location
                ? [
                      {
                          id: node.id,
                          level:
                              node.kind === 'clauseTitle'
                                  ? 3
                                  : Math.max(1, Math.min(6, Number(node.attributes?.level) || 1)),
                          text,
                          ...location,
                      },
                  ]
                : [];
        }
        if (node.kind === 'parallelRow') {
            for (const cell of node.children ?? []) {
                const headings = collect(cell);
                if (headings.length) return headings;
            }
            return [];
        }
        return node.children?.flatMap(collect) ?? [];
    };
    const groups = scene.pages.map((_, index) => ({ page: index + 1, headings: [] as OutlineHeading[] }));
    collect(document.root).forEach((heading) => groups[heading.page - 1].headings.push(heading));
    return groups;
}
