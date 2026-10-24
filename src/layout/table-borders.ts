import { point } from '../typography/metrics.js';
import type { LineCommand, PaintCommand, SceneCell } from './scene.js';

function closeTableCells(commands: readonly PaintCommand[], cells: readonly SceneCell[]): readonly PaintCommand[] {
    const horizontal = new Map<string, LineCommand[]>();
    const key = (y: number, color: readonly number[]) => `${point(y)}:${color.join(',')}`;
    for (const command of commands) {
        if (command.kind !== 'line' || Math.abs(command.y - command.toY) >= 0.002 || command.width !== 0.5) continue;
        const id = key(command.y, command.color);
        const lines = horizontal.get(id) ?? [];
        lines.push(command);
        horizontal.set(id, lines);
    }
    const added: LineCommand[] = [];
    for (const cell of cells) {
        const color = cell.borderColor;
        if (!color) continue;
        for (const y of [cell.y, point(cell.y + cell.height)]) {
            const id = key(y, color);
            const lines = horizontal.get(id) ?? [];
            if (
                lines.some(
                    (line) =>
                        Math.min(line.x, line.toX) <= cell.x + 0.002 &&
                        Math.max(line.x, line.toX) >= cell.x + cell.width - 0.002,
                )
            )
                continue;
            const end = point(cell.x + cell.width);
            let at = cell.x;
            const cover = lines
                .map((line) => [Math.min(line.x, line.toX), Math.max(line.x, line.toX)])
                .sort((a, b) => a[0] - b[0]);
            const append = (from: number, to: number): void => {
                if (to - from < 0.002) return;
                const line: LineCommand = {
                    kind: 'line',
                    tableBorder: cell.borderDepth ?? 0,
                    x: point(from),
                    y,
                    toX: point(to),
                    toY: y,
                    width: 0.5,
                    color,
                };
                added.push(line);
                lines.push(line);
            };
            for (const [left, right] of cover) {
                if (right <= at || left >= end) continue;
                append(at, Math.min(left, end));
                at = Math.min(end, Math.max(at, right));
            }
            append(at, end);
            horizontal.set(id, lines);
        }
    }
    return added.length ? [...commands, ...added] : commands;
}

export function tableBorders(commands: readonly PaintCommand[], cells: readonly SceneCell[]): readonly PaintCommand[] {
    const closed = closeTableCells(commands, cells);
    const groups = new Map<string, Map<string, { line: LineCommand; ranges: number[][] }>>();
    const other: PaintCommand[] = [];
    let first = -1,
        depth = 0;
    for (const command of closed) {
        if (command.kind === 'clipStart') depth++;
        if (command.kind === 'line' && command.tableBorder !== undefined && depth === 0) {
            if (first < 0) first = other.length;
            const key = JSON.stringify([command.tableBorder, command.width, command.color]);
            const group = groups.get(key) ?? new Map();
            groups.set(key, group);
            const horizontal = command.y === command.toY;
            const axis = `${horizontal ? 'h' : 'v'}:${horizontal ? command.y : command.x}`;
            const entry = group.get(axis) ?? { line: command, ranges: [] };
            entry.ranges.push(
                horizontal
                    ? [Math.min(command.x, command.toX), Math.max(command.x, command.toX)]
                    : [Math.min(command.y, command.toY), Math.max(command.y, command.toY)],
            );
            group.set(axis, entry);
        } else other.push(command);
        if (command.kind === 'clipEnd') depth--;
    }
    if (first < 0) return closed;
    const normalized: LineCommand[] = [];
    for (const group of groups.values())
        for (const { line, ranges } of group.values()) {
            const merged: number[][] = [];
            for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
                const last = merged.at(-1);
                if (last && start <= last[1] + 0.002) last[1] = Math.max(last[1], end);
                else merged.push([start, end]);
            }
            for (const [start, end] of merged) {
                if (end <= start) continue;
                normalized.push(
                    line.y === line.toY ? { ...line, x: start, toX: end } : { ...line, y: start, toY: end },
                );
            }
        }
    return [...other.slice(0, first), ...normalized, ...other.slice(first)];
}
