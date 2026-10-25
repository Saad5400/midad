import { rejectedClause } from '../content/clauses/numbering.js';
import type { NativeDocument, NativeNode } from '../document/model.js';
import { blockText, isTextBlock } from '../document/text.js';
import { tableGrid, type TableGrid } from '../editing/table-grid.js';
import { sliceInlineContent } from '../editing/text.js';
import type { Band } from './bands.js';
import type { TextContinuation } from './context.js';

export class FlowContinuation {
    readonly tableColumns = new Map<string, number>();
    readonly fragments = new Map<string, TextContinuation>();
    readonly completed = new Set<string>();
    readonly listStarts = new Map<string, string>();
    readonly listNumbers = new Map<string, number>();
    private readonly originals = new Map<string, NativeNode>();
    private readonly texts = new Map<string, string>();
    private readonly offsets = new Map<string, number>();
    private readonly rowHeights = new Map<string, number>();
    private readonly rowIndexes = new Map<string, number>();
    private readonly grids = new Map<string, TableGrid>();

    constructor(document: NativeDocument) {
        const visit = (node: NativeNode): void => {
            this.originals.set(node.id, node);
            if (isTextBlock(node)) this.texts.set(node.id, blockText(node));
            if (node.kind === 'table') {
                const grid = tableGrid(node);
                this.grids.set(node.id, grid);
                this.tableColumns.set(node.id, grid.columns);
                grid.rows.forEach((row, index) => this.rowIndexes.set(row.node.id, index));
            }
            if (['orderedList', 'bulletList'].includes(node.kind)) {
                let number = Number(node.attributes?.start ?? 1);
                for (const item of node.children ?? []) {
                    const first = item.children?.[0];
                    if (!first) continue;
                    this.listStarts.set(item.id, first.id);
                    if (['paragraph', 'heading', 'codeBlock'].includes(first.kind))
                        this.listNumbers.set(item.id, number++);
                }
            }
            node.children?.forEach(visit);
        };
        visit(document.root);
    }

    accept(band: Band): void {
        for (const id of band.completedNodes ?? []) this.completed.add(id);
        for (const line of band.lines) {
            const original = this.originals.get(line.paragraphId);
            const row = line.shaped.lines.find((entry) => entry.top === line.originalTop);
            if (!original || !row) continue;
            const first = line.shaped.sources[0];
            const prefix = first?.nodeId === original.id && !first.editable ? first.to : 0;
            const end = Math.min(
                this.texts.get(original.id)!.length,
                (line.fragmentFrom ?? 0) + row.endWithBreak - prefix,
            );
            this.offsets.set(original.id, Math.max(this.offsets.get(original.id) ?? 0, end));
            if (end >= this.texts.get(original.id)!.length && row === line.shaped.lines.at(-1))
                this.completed.add(original.id);
        }
        for (const row of band.tableRows ?? []) {
            this.rowHeights.set(row.rowId, (this.rowHeights.get(row.rowId) ?? 0) + row.height);
            if (row.ends) this.completed.add(row.rowId);
        }
        for (const command of band.commands)
            if ((command.kind === 'image' || command.kind === 'field') && command.nodeId)
                this.completed.add(command.nodeId);
    }

    rowIndex(id: string, fallback: number): number {
        return this.rowIndexes.get(id) ?? fallback;
    }

    remaining(node: NativeNode, geometry = false): NativeNode | undefined {
        if (this.done(node)) return geometry ? { ...node, children: [] } : undefined;
        if (isTextBlock(node)) {
            const from = this.offsets.get(node.id) ?? 0;
            if (!from) return node;
            let position = 0;
            const nodeOffsets = new Map<string, number>();
            for (const child of node.children ?? []) {
                const length = child.kind === 'text' ? (child.text?.length ?? 0) : 1;
                if (from > position && from < position + length) nodeOffsets.set(child.id, from - position);
                position += length;
            }
            this.fragments.set(node.id, {
                from,
                byteFrom: new TextEncoder().encode(this.texts.get(node.id)!.slice(0, from)).length,
                nodeOffsets,
            });
            return { ...node, children: sliceInlineContent(node.children ?? [], from, Infinity) };
        }
        if (!this.hasProgress(node)) return node;
        if (node.kind === 'table') return this.table(node);
        if (!node.children?.length) return node;
        const children = node.children.flatMap((child) => {
            const rest = this.remaining(child, child.kind === 'parallelCell');
            return rest ? [rest] : [];
        });
        return { ...node, children };
    }

    private hasProgress(node: NativeNode): boolean {
        return (
            this.completed.has(node.id) ||
            this.offsets.has(node.id) ||
            this.rowHeights.has(node.id) ||
            (node.children?.some((child) => this.hasProgress(child)) ?? false)
        );
    }

    private done(node: NativeNode): boolean {
        if (this.completed.has(node.id)) return true;
        if (node.kind === 'clause' && rejectedClause(node)) return true;
        if (node.kind === 'table') return this.grids.get(node.id)!.rows.every((row) => this.completed.has(row.node.id));
        if (node.kind === 'tableRow' || isTextBlock(node) || !node.children?.length) return false;
        const children =
            node.kind === 'clause' && node.attributes?.isTitleHidden
                ? node.children.filter((child) => child.kind !== 'clauseTitle')
                : node.children;
        const done = children.length > 0 && children.every((child) => this.done(child));
        if (done) this.completed.add(node.id);
        return done;
    }

    private table(node: NativeNode): NativeNode | undefined {
        const grid = this.grids.get(node.id)!;
        const kept = grid.rows
            .map((row, index) => ({ ...row, index }))
            .filter((row) => !this.completed.has(row.node.id));
        if (!kept.length) return;
        const first = kept[0].index;
        const rows = new Map<string, NativeNode>();
        for (const row of kept) {
            const cells = grid.cells.filter(
                (cell) =>
                    cell.row === row.index ||
                    (row.index === first && cell.row < first && cell.row + cell.rowspan > first),
            );
            const children = cells
                .sort((a, b) => a.column - b.column)
                .map((cell) => {
                    const rest = this.remaining(cell.node, true)!;
                    const rowspan = Math.max(1, cell.row + cell.rowspan - Math.max(first, cell.row));
                    return rowspan === cell.rowspan
                        ? rest
                        : {
                              ...rest,
                              attributes: {
                                  ...rest.attributes,
                                  rowspan,
                                  ...(rest.attributes?.rmMergeOrigin ? { rmRowspan: rowspan } : {}),
                              },
                          };
                });
            const consumed = this.rowHeights.get(row.node.id) ?? 0;
            const attrs =
                typeof row.node.attributes?.rowHeight === 'number' && consumed
                    ? {
                          ...row.node.attributes,
                          rowHeight: Math.max(0, row.node.attributes.rowHeight - consumed / 0.75),
                      }
                    : row.node.attributes;
            rows.set(row.node.id, { ...row.node, attributes: attrs, children });
        }
        const children = (node.children ?? []).flatMap((child) => {
            if (child.kind !== 'tableRowGroup') return rows.has(child.id) ? [rows.get(child.id)!] : [];
            const entries = child.children?.flatMap((row) => (rows.has(row.id) ? [rows.get(row.id)!] : [])) ?? [];
            return entries.length ? [{ ...child, children: entries }] : [];
        });
        return { ...node, children };
    }
}
