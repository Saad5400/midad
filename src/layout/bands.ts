import { point } from '../typography/metrics.js';
import type { PaintCommand, SceneCell, SceneColumn, SceneLine, SceneTableRow } from './scene.js';

export interface Band {
    completedNodes?: readonly string[];
    height: number;
    commands: PaintCommand[];
    lines: SceneLine[];
    cells?: SceneCell[];
    tableRows?: SceneTableRow[];
    columns?: SceneColumn[];
    keepNext?: boolean;
    writable?: boolean;
    minimumHeight?: number;
    split?: (available: number) => BandParts | undefined;
}
export interface BandParts {
    head: Band;
    rest?: Band;
}
const placements = new WeakMap<Band, { x: number; y: number; band: Band }>();
export const blank = (height: number): Band => ({ height: point(height), minimumHeight: 0, commands: [], lines: [] });
export function flowSpace(height: number): Band {
    return {
        ...blank(height),
        minimumHeight: 0,
        split: (available) => {
            if (available <= 0) return;
            const used = Math.min(height, available);
            return { head: blank(used), ...(height > used ? { rest: flowSpace(point(height - used)) } : {}) };
        },
    };
}

export function decorateBand(band: Band, decorate: (band: Band) => Band): Band {
    return {
        ...decorate(band),
        ...(band.split
            ? {
                  split: (available: number) => {
                      const parts = band.split!(available);
                      return (
                          parts && {
                              head: decorate(parts.head),
                              ...(parts.rest ? { rest: decorateBand(parts.rest, decorate) } : {}),
                          }
                      );
                  },
              }
            : {}),
    };
}
export function shiftCommand(command: PaintCommand, x: number, y: number): PaintCommand {
    if (command.kind === 'clipEnd') return command;
    if ('glyphs' in command)
        return {
            ...command,
            positions: command.positions.map((value, index) => point(value + (index % 2 === 0 ? x : y))),
            ...(command.reading
                ? {
                      reading: command.reading.map((part) => ({
                          ...part,
                          box: { ...part.box, x: point(part.box.x + x), y: point(part.box.y + y) },
                      })),
                  }
                : {}),
        };
    if (command.kind === 'line')
        return {
            ...command,
            x: point(command.x + x),
            y: point(command.y + y),
            toX: point(command.toX + x),
            toY: point(command.toY + y),
        };
    return { ...command, x: point(command.x + x), y: point(command.y + y) };
}

export function shiftBand(band: Band, x: number, y = 0): Band {
    const previous = placements.get(band);
    if (previous?.x === x && previous.y === y) return previous.band;
    const shifted = {
        ...band,
        ...(band.split
            ? {
                  split: (available: number) => {
                      const parts = band.split!(available);
                      return (
                          parts && {
                              head: shiftBand(parts.head, x, y),
                              ...(parts.rest ? { rest: shiftBand(parts.rest, x, y) } : {}),
                          }
                      );
                  },
              }
            : {}),
        commands: band.commands.map((command) => shiftCommand(command, x, y)),
        lines: band.lines.map((line) => ({ ...line, left: point((line.left ?? 0) + x), top: point(line.top + y) })),
        ...(band.tableRows
            ? { tableRows: band.tableRows.map((row) => ({ ...row, x: point(row.x + x), y: point(row.y + y) })) }
            : {}),
        ...(band.columns
            ? { columns: band.columns.map((column) => ({ ...column, x: point(column.x + x), y: point(column.y + y) })) }
            : {}),
        ...(band.cells
            ? {
                  cells: band.cells.map((cell) => ({
                      ...cell,
                      x: point(cell.x + x),
                      y: point(cell.y + y),
                      tableX: point(cell.tableX + x),
                  })),
              }
            : {}),
    };
    placements.set(band, { x, y, band: shifted });
    return shifted;
}

export function requiredHeight(bands: readonly Band[], start: number, fullHeight: number): number {
    let height = 0;
    for (let index = start; index < bands.length; index++) {
        const band = bands[index];
        height += band.minimumHeight ?? band.height;
        if (!band.keepNext) break;
    }
    return height <= fullHeight ? height : (bands[start]?.minimumHeight ?? bands[start]?.height ?? 0);
}

export function isSpacing(band: Band): boolean {
    return (
        !band.writable &&
        !band.split &&
        !band.commands.length &&
        !band.lines.length &&
        !band.cells?.length &&
        !band.columns?.length
    );
}

export function takeBands(
    bands: readonly Band[],
    available: number,
    fullHeight: number,
): { head: Band[]; rest: Band[] } {
    const head: Band[] = [];
    let height = 0;
    for (let index = 0; index < bands.length; index++) {
        const band = bands[index];
        const room = point(available - height);
        if (isSpacing(band)) {
            const used = Math.max(0, Math.min(band.height, room));
            head.push(blank(used));
            height = point(height + used);
            continue;
        }
        if (requiredHeight(bands, index, fullHeight) > room) return { head, rest: bands.slice(index) };
        if (band.height <= room && !band.split) {
            head.push(band);
            height = point(height + band.height);
            continue;
        }
        const split = band.split?.(room);
        if (split) {
            head.push(split.head);
            height = point(height + split.head.height);
            if (!split.rest) continue;
        }
        return { head, rest: [split?.rest ?? band, ...bands.slice(index + 1)] };
    }
    return { head, rest: [] };
}

export function flowTracks(
    tracks: readonly (readonly Band[])[],
    fullHeight: number,
    compose: (tracks: readonly (readonly Band[])[], state: { last: boolean }) => Band,
): Band {
    const height = point(Math.max(0, ...tracks.map((bands) => bands.reduce((sum, band) => sum + band.height, 0))));
    const minimumHeight = Math.min(
        ...tracks.filter((bands) => bands.length).map((bands) => requiredHeight(bands, 0, fullHeight)),
    );
    return {
        height,
        commands: [],
        lines: [],
        minimumHeight,
        split: (available) => {
            const parts = tracks.map((bands) => takeBands(bands, available, fullHeight));
            if (!parts.some((part) => part.head.length)) return;
            const last = parts.every((part) => !part.rest.length);
            return {
                head: compose(
                    parts.map((part) => part.head),
                    { last },
                ),
                ...(last
                    ? {}
                    : {
                          rest: flowTracks(
                              parts.map((part) => part.rest),
                              fullHeight,
                              compose,
                          ),
                      }),
            };
        },
    };
}

export function materializeBands(bands: readonly Band[], available: number): Band[] {
    return bands.flatMap((original) => {
        const result: Band[] = [];
        let pending: Band | undefined = original;
        while (pending?.split) {
            const parts = pending.split(available);
            if (!parts) throw new Error('A document block exceeds the writable page height');
            result.push(parts.head);
            pending = parts.rest;
        }
        if (pending) result.push(pending);
        return result;
    });
}

export function stretchBand(band: Band, height: number): Band {
    const delta = point(height - band.height);
    if (delta <= 0) return band;
    const near = (a: number, b: number) => Math.abs(a - b) < 0.002;
    const cells = band.cells?.filter((cell) => near(cell.y + cell.height, band.height)) ?? [];
    return {
        ...band,
        height,
        tableRows: band.tableRows?.map((row) =>
            near(row.y + row.height, band.height) ? { ...row, height: point(row.height + delta) } : row,
        ),
        cells: band.cells?.map((cell) =>
            cells.includes(cell) ? { ...cell, height: point(cell.height + delta) } : cell,
        ),
        columns: band.columns?.map((column) =>
            near(column.y + column.height, band.height) ? { ...column, height: point(column.height + delta) } : column,
        ),
        commands: band.commands.map((command) => {
            if (
                command.kind === 'rect' &&
                cells.some(
                    (cell) =>
                        near(command.x, cell.x) &&
                        near(command.y, cell.y) &&
                        near(command.width, cell.width) &&
                        near(command.height, cell.height),
                )
            )
                return { ...command, height: point(command.height + delta) };
            if (command.kind !== 'line') return command;
            if (
                near(command.x, command.toX) &&
                near(command.toY, band.height) &&
                cells.some((cell) => near(command.x, cell.x) || near(command.x, cell.x + cell.width))
            )
                return { ...command, toY: point(command.toY + delta) };
            if (
                near(command.y, band.height) &&
                near(command.toY, band.height) &&
                cells.some((cell) => near(command.x, cell.x) && near(command.toX, cell.x + cell.width))
            )
                return { ...command, y: height, toY: height };
            return command;
        }),
    };
}
