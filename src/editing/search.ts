import type { NativeDocument } from '../document/model.js';
import type { NativeSelection } from './selection.js';
import { blockText, textBlocks } from './text.js';

export interface SearchOptions {
    readonly caseSensitive?: boolean;
    readonly wholeWord?: boolean;
    readonly blockIds?: ReadonlySet<string>;
}
export interface TextMatch {
    readonly blockId: string;
    readonly from: number;
    readonly to: number;
}
const word = /[\p{L}\p{N}\p{M}_]/u;
const preceding = (text: string, index: number): string => {
    const low = text.charCodeAt(index - 1),
        high = text.charCodeAt(index - 2);
    return text.slice(
        Math.max(0, index - (low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff ? 2 : 1)),
        index,
    );
};
function normalized(source: string) {
    const text = source.normalize('NFC');
    if (source === text) return { text, from: (index: number) => index, to: (index: number) => index };
    const starts: number[] = [],
        ends: number[] = [];
    for (const part of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(source)) {
        for (let index = 0; index < part.segment.normalize('NFC').length; index++) {
            starts.push(part.index);
            ends.push(part.index + part.segment.length);
        }
    }
    return { text, from: (index: number) => starts[index], to: (index: number) => ends[index - 1] };
}

export function findText(document: NativeDocument, query: string, options: SearchOptions = {}): readonly TextMatch[] {
    if (!query || query.includes('\uFFFC')) return [];
    const pattern = new RegExp(
        query.normalize('NFC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        options.caseSensitive ? 'gu' : 'giu',
    );
    const matches: TextMatch[] = [];
    for (const block of textBlocks(document.root)) {
        if (options.blockIds && !options.blockIds.has(block.id)) continue;
        const source = normalized(blockText(block)),
            text = source.text;
        pattern.lastIndex = 0;
        for (let match; (match = pattern.exec(text)); ) {
            const from = match.index,
                to = from + match[0].length;
            if (
                options.wholeWord &&
                (word.test(preceding(text, from)) || word.test(String.fromCodePoint(text.codePointAt(to) ?? 0)))
            )
                continue;
            matches.push(Object.freeze({ blockId: block.id, from: source.from(from), to: source.to(to) }));
        }
    }
    return Object.freeze(matches);
}

export function matchSelection(match: TextMatch): NativeSelection {
    return {
        anchor: { blockId: match.blockId, offset: match.from },
        focus: { blockId: match.blockId, offset: match.to },
    };
}

export class DocumentSearch {
    private results: readonly TextMatch[] = [];
    private position = -1;
    private query = '';
    private options = '';

    get matches(): readonly TextMatch[] {
        return this.results;
    }
    get index(): number {
        return this.position;
    }
    get current(): TextMatch | undefined {
        return this.results[this.position];
    }
    update(document: NativeDocument, query: string, options: SearchOptions = {}): void {
        const previous = this.current;
        const previousIndex = this.position;
        const key = JSON.stringify([!!options.caseSensitive, !!options.wholeWord]);
        this.results = findText(document, query, options);
        this.position = this.results.length ? 0 : -1;
        if (previous && this.query === query && this.options === key) {
            let distance = Infinity;
            this.position = Math.min(previousIndex, this.results.length - 1);
            this.results.forEach((match, index) => {
                if (match.blockId !== previous.blockId) return;
                const next = Math.abs(match.from - previous.from);
                if (next < distance) {
                    distance = next;
                    this.position = index;
                }
            });
        }
        this.query = query;
        this.options = key;
    }
    move(direction: -1 | 1): TextMatch | undefined {
        if (this.results.length)
            this.position = (this.position + direction + this.results.length) % this.results.length;
        return this.current;
    }
}
