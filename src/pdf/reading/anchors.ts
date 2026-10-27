import type { PdfReviewMap } from '../review.js';
import type { PdfPageText } from './text.js';

export interface PdfReviewRequest {
    blockIds?: readonly string[];
    quote?: string | null;
    offset?: number | null;
    text?: string | null;
    prefix?: string | null;
    suffix?: string | null;
    wholeBlock?: boolean;
}
export interface PdfReviewPiece {
    page: number;
    row?: number;
    span: number;
    from: number;
    to: number;
    source?: string;
    pdfBox?: readonly number[];
    clip?: { x: number; y: number; width: number; height: number };
}
export interface PdfReviewLocation {
    page: number;
    box?: { x: number; y: number; width: number; height: number };
    pieces: PdfReviewPiece[];
    boxes?: { page: number; x: number; y: number; width: number; height: number }[];
    exact: boolean;
}
interface Normalized {
    text: string;
    from: number[];
    to: number[];
}
function normalized(value: string): Normalized {
    const result: Normalized = { text: '', from: [], to: [] };
    for (const part of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(value)) {
        let text = part.segment.replace(/[\uFFFC\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').normalize('NFC');
        if (!text) continue;
        if (/^\s+$/.test(text)) {
            if (result.text.endsWith(' ')) {
                result.to[result.to.length - 1] = part.index + part.segment.length;
                continue;
            }
            text = ' ';
        }
        result.text += text;
        for (let index = 0; index < text.length; index++) {
            result.from.push(part.index);
            result.to.push(part.index + part.segment.length);
        }
    }
    return result;
}
function matches(
    value: string,
    request: PdfReviewRequest,
    start = 0,
    end = value.length,
): { from: number; to: number }[] {
    const needle = normalized(request.quote ?? '').text.trim();
    if (!needle) return [];
    let tail = Math.min(value.length - end, needle.length * 4 + 128);
    while (end + tail < value.length && normalized(value.slice(end, end + tail)).text.length < needle.length + 64)
        tail = Math.min(value.length - end, Math.max(1, tail * 2));
    const source = normalized(value.slice(start, end + tail));
    let prefix = normalized(request.prefix ?? '').text.trimEnd(),
        suffix = normalized(request.suffix ?? '').text.trimStart();
    if (request.text != null && request.offset != null) {
        const old = normalized(request.text);
        let at = old.text.indexOf(needle);
        while (at !== -1) {
            const from = old.from[at];
            if (from >= request.offset && !normalized(request.text.slice(request.offset, from)).text.trim()) {
                prefix = old.text.slice(Math.max(0, at - 32), at).trimEnd();
                suffix = old.text.slice(at + needle.length, at + needle.length + 32).trimStart();
                break;
            }
            at = old.text.indexOf(needle, at + 1);
        }
    }
    const result: { from: number; to: number; score: number }[] = [];
    let at = source.text.indexOf(needle);
    while (at !== -1) {
        const from = start + source.from[at],
            to = start + source.to[at + needle.length - 1];
        if (from >= start && from < end)
            result.push({
                from,
                to,
                score:
                    (prefix &&
                    source.text
                        .slice(Math.max(0, at - prefix.length - 1), at)
                        .trimEnd()
                        .endsWith(prefix)
                        ? 1
                        : 0) +
                    (suffix &&
                    source.text
                        .slice(at + needle.length, at + needle.length + suffix.length + 1)
                        .trimStart()
                        .startsWith(suffix)
                        ? 1
                        : 0),
            });
        at = source.text.indexOf(needle, at + 1);
    }
    const score = Math.max(0, ...result.map((match) => match.score));
    const contextual = result.filter((match) => score > 0 && match.score === score);
    return (contextual.length ? contextual : result).map(({ from, to }) => ({ from, to }));
}
export function mappedReviewLocations(map: PdfReviewMap, request: PdfReviewRequest): PdfReviewLocation[] {
    if (map.version !== 1) return [];
    const ids = new Set(request.blockIds ?? []);
    const candidates = map.blocks.filter((block) => block.aliases.some((id) => ids.has(id)));
    if (!candidates.length) return [];
    const blocks = new Map(map.blocks.map((block) => [block.id, block]));
    const starts = new Map<string, number>();
    let text = '';
    for (const block of map.blocks) {
        if (text) text += '\n';
        starts.set(block.id, text.length);
        text += block.text;
    }
    const rangeLocation = (from: number, to: number, exact: boolean): PdfReviewLocation | undefined => {
        const pieces: PdfReviewPiece[] = [];
        let first: (typeof map.rows)[number] | undefined;
        let firstOffset = Infinity;
        for (const row of map.rows) {
            const start = starts.get(row.block)!;
            row.parts.forEach((part, span) => {
                if (part.from === part.to || start + part.from >= to || start + part.to <= from) return;
                const fromOffset = Math.max(0, from - start),
                    toOffset = to - start;
                const lowerBound = (value: number): number => {
                    const offsets = part.offsets!;
                    let low = 0,
                        high = offsets.length;
                    while (low < high) {
                        const middle = (low + high) >>> 1;
                        if (offsets[middle] < value) low = middle + 1;
                        else high = middle;
                    }
                    return low;
                };
                const visibleFrom = part.offsets ? lowerBound(fromOffset) : Math.max(0, fromOffset - part.from);
                const visibleTo = part.offsets
                    ? lowerBound(toOffset)
                    : Math.min(part.to - part.from, toOffset - part.from);
                if (!part.atomic && visibleFrom === visibleTo) return;
                if (start + part.from < firstOffset) {
                    first = row;
                    firstOffset = start + part.from;
                }
                pieces.push({
                    page: row.page,
                    row: row.row,
                    span,
                    from: part.atomic ? 0 : visibleFrom,
                    to: part.atomic ? Number.MAX_SAFE_INTEGER : visibleTo,
                    ...(part.clip ? { clip: part.clip } : {}),
                    ...(part.pdfBox ? { pdfBox: part.pdfBox } : {}),
                    ...(!part.atomic
                        ? {
                              source: part.offsets
                                  ? part.offsets.map((offset) => blocks.get(row.block)!.text[offset]).join('')
                                  : blocks.get(row.block)!.text.slice(part.from, part.to),
                          }
                        : {}),
                });
            });
        }
        if (!first || !pieces.length) return;
        return { page: first.page, box: first.box, pieces, exact };
    };
    const locations: PdfReviewLocation[] = [];
    for (const block of candidates) {
        const start = starts.get(block.id)!;
        if (request.quote && !request.wholeBlock) {
            let found = matches(text, request, start, start + block.text.length);
            if (request.text === block.text && request.offset != null) {
                const exact = found.filter(
                    (match) =>
                        match.from >= start + request.offset! &&
                        !normalized(block.text.slice(request.offset!, match.from - start)).text.trim(),
                );
                if (exact.length) found = exact;
            }
            for (const match of found) {
                const location = rangeLocation(match.from, match.to, true);
                if (location) locations.push(location);
            }
        }
    }
    if (locations.length) return locations;
    for (const block of candidates) {
        const start = starts.get(block.id)!;
        const location = rangeLocation(start, start + block.text.length, false);
        if (location) locations.push(location);
        else if (block.empty?.length)
            locations.push({
                page: block.empty[0].page,
                box: block.empty[0],
                boxes: block.empty,
                pieces: [],
                exact: false,
            });
    }
    if (request.wholeBlock && locations.length > 1)
        return [
            {
                ...locations[0],
                pieces: locations.flatMap((location) => location.pieces),
                boxes: locations.flatMap((location) => location.boxes ?? []),
            },
        ];
    return locations;
}

export function reviewLocationValid(location: PdfReviewLocation, pages: ReadonlyMap<number, PdfPageText>): boolean {
    return location.pieces.every((piece) => {
        const page = pages.get(piece.page);
        const span = piece.row === undefined ? page?.content.items[piece.span] : page?.rows[piece.row]?.[piece.span];
        const text = span && ('text' in span ? span.text : 'str' in span ? span.str : undefined);
        return (
            typeof text === 'string' &&
            (piece.source === undefined || piece.source === text) &&
            (!piece.pdfBox ||
                (!!span &&
                    'box' in span &&
                    piece.pdfBox.length === span.box.length &&
                    piece.pdfBox.every((value, index) => Math.abs(value - span.box[index]) < 0.002)))
        );
    });
}

export function textReviewLocations(pages: readonly PdfPageText[], request: PdfReviewRequest): PdfReviewLocation[] {
    if (!request.quote) return [];
    const results: PdfReviewLocation[] = [];
    for (const separator of ['', '\n']) {
        const runs: { page: number; row?: number; span: number; from: number; to: number }[] = [];
        let text = '';
        pages.forEach((page, index) => {
            if (text) text += '\n\n';
            if (page.rows.length)
                page.rows.forEach((row, rowIndex) => {
                    if (rowIndex) text += separator;
                    row.forEach((span, spanIndex) => {
                        const start = text.length;
                        text += span.text;
                        runs.push({ page: index + 1, row: rowIndex, span: spanIndex, from: start, to: text.length });
                    });
                });
            else
                page.content.items.forEach((item, span) => {
                    if (!('str' in item)) return;
                    const start = text.length;
                    text += item.str;
                    runs.push({ page: index + 1, span, from: start, to: text.length });
                    if (item.hasEOL) text += separator;
                });
        });
        for (const match of matches(text, request)) {
            const pieces = runs
                .filter((run) => run.from < match.to && run.to > match.from)
                .map((run) => ({
                    page: run.page,
                    row: run.row,
                    span: run.span,
                    from: Math.max(0, match.from - run.from),
                    to: Math.min(run.to - run.from, match.to - run.from),
                    source: text.slice(run.from, run.to),
                }));
            if (!pieces.length) continue;
            const key = JSON.stringify(pieces);
            if (!results.some((result) => JSON.stringify(result.pieces) === key))
                results.push({ page: pieces[0].page, pieces, exact: true });
        }
    }
    return results;
}
