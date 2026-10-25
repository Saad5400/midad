import { point } from '../typography/metrics.js';
import type { PaintCommand, RectCommand, SceneCell, SceneColumn, ScenePage, SceneTableRow } from './scene.js';
import { tableBorders } from './table-borders.js';

export function finalizePages(pages: readonly ScenePage[]): ScenePage[] {
    return pages.map((entry) => {
        const cells = coalesceCells(entry.cells ?? []);
        return Object.freeze({
            ...entry,
            commands: Object.freeze(
                layerTableBackgrounds(tableBorders(entry.commands, cells)).map((command) => {
                    if ('glyphs' in command) {
                        Object.freeze(command.glyphs);
                        Object.freeze(command.text);
                        Object.freeze(command.positions);
                        if (command.reading) {
                            for (const part of command.reading) {
                                Object.freeze(part.order);
                                Object.freeze(part.box);
                                Object.freeze(part);
                            }
                            Object.freeze(command.reading);
                        }
                    }
                    if ('color' in command && command.color) Object.freeze(command.color);
                    return Object.freeze(command);
                }),
            ),
            lines: Object.freeze(entry.lines.map((line) => Object.freeze(line))),
            cells,
            tableRows: coalesceRows(entry.tableRows ?? []),
            columns: coalesceColumns(entry.columns ?? []),
            blocks: coalesceColumns(entry.blocks ?? []),
        });
    });
}

function coalesceRows(rows: readonly SceneTableRow[]): readonly SceneTableRow[] {
    const result: SceneTableRow[] = [];
    const last = new Map<string, number>();
    for (const row of rows) {
        const index = last.get(row.rowId);
        const previous = index === undefined ? undefined : result[index];
        if (
            previous &&
            previous.tableId === row.tableId &&
            previous.x === row.x &&
            previous.width === row.width &&
            Math.abs(previous.y + previous.height - row.y) < 0.002
        )
            result[index!] = { ...previous, height: point(row.y + row.height - previous.y), ends: row.ends };
        else {
            last.set(row.rowId, result.length);
            result.push(row);
        }
    }
    return Object.freeze(result.map((row) => Object.freeze(row)));
}

function coalesceColumns(columns: readonly SceneColumn[]): readonly SceneColumn[] {
    const result: SceneColumn[] = [],
        last = new Map<string, number>();
    for (const column of columns) {
        const index = last.get(column.id),
            previous = index === undefined ? undefined : result[index];
        if (
            previous &&
            previous.x === column.x &&
            previous.width === column.width &&
            Math.abs(previous.y + previous.height - column.y) < 0.002
        )
            result[index!] = { ...previous, height: point(column.y + column.height - previous.y) };
        else {
            last.set(column.id, result.length);
            result.push(column);
        }
    }
    return Object.freeze(result.map((column) => Object.freeze(column)));
}

function coalesceCells(cells: readonly SceneCell[]): readonly SceneCell[] {
    const result: SceneCell[] = [],
        last = new Map<string, number>();
    for (const cell of cells) {
        const index = last.get(cell.cellId),
            previous = index === undefined ? undefined : result[index];
        if (
            previous &&
            previous.x === cell.x &&
            previous.width === cell.width &&
            cell.y >= previous.y - 0.002 &&
            cell.y <= previous.y + previous.height + 0.002
        )
            result[index!] = {
                ...previous,
                height: point(Math.max(previous.y + previous.height, cell.y + cell.height) - previous.y),
            };
        else {
            last.set(cell.cellId, result.length);
            result.push(cell);
        }
    }
    return Object.freeze(
        result.map((cell) => {
            Object.freeze(cell.columnEdges);
            if (cell.minimumColumnWidths) Object.freeze(cell.minimumColumnWidths);
            return Object.freeze(cell);
        }),
    );
}

function layerTableBackgrounds(commands: readonly PaintCommand[]): readonly PaintCommand[] {
    const background = (command: PaintCommand): command is RectCommand =>
        command.kind === 'rect' && command.tableBackground !== undefined;
    const first = commands.findIndex(background);
    if (first < 0) return commands;
    const backgrounds: RectCommand[] = [];
    const foreground: PaintCommand[] = [];
    let depth = 0;
    for (const command of commands.slice(first)) {
        if (command.kind === 'clipStart') depth++;
        if (background(command) && depth === 0) backgrounds.push(command);
        else foreground.push(command);
        if (command.kind === 'clipEnd') depth--;
    }
    return [
        ...commands.slice(0, first),
        ...backgrounds.sort((a, b) => a.tableBackground! - b.tableBackground!),
        ...foreground,
    ];
}
