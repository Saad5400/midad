import { findNode, type NativeDocument } from '../../document/model.js';
import type { NativeSelection } from '../../editing/selection.js';
import { blockText, editableTextBlock, textDifference } from '../../editing/text.js';

export interface TemplateRange {
    readonly id: string;
    readonly blockId: string;
    readonly from: number;
    readonly to: number;
}

export class LiveTemplateController {
    private documentId?: string;
    private ranges: readonly TemplateRange[] = [];
    private index = 0;
    get entries(): readonly TemplateRange[] {
        return this.ranges;
    }
    get activeId(): string | undefined {
        return this.ranges[this.index]?.id;
    }
    get active(): boolean {
        return !!this.ranges.length;
    }
    cancel(): void {
        this.ranges = [];
        this.documentId = undefined;
        this.index = 0;
    }
    start(document: NativeDocument, ranges: readonly TemplateRange[]): NativeSelection | undefined {
        for (const range of ranges)
            editableTextBlock(document, { ...range, text: '', expectedRevision: document.revision });
        this.documentId = document.id;
        this.ranges = ranges.map((range) => Object.freeze({ ...range }));
        this.index = 0;
        return this.selection();
    }
    private selection(): NativeSelection | undefined {
        const range = this.ranges[this.index];
        return range
            ? {
                  anchor: { blockId: range.blockId, offset: range.from },
                  focus: { blockId: range.blockId, offset: range.to },
              }
            : undefined;
    }
    changed(selection: NativeSelection | null): void {
        if (!this.active) return;
        const index =
            selection && !selection.cells && !selection.scopeId
                ? this.ranges.findIndex(
                      (range) =>
                          selection.anchor.blockId === range.blockId &&
                          selection.focus.blockId === range.blockId &&
                          Math.min(selection.anchor.offset, selection.focus.offset) >= range.from &&
                          Math.max(selection.anchor.offset, selection.focus.offset) <= range.to,
                  )
                : -1;
        if (index === -1 || index === null) this.cancel();
        else this.index = index;
    }
    update(before: NativeDocument, after: NativeDocument): void {
        if (!this.active) return;
        if (before.id !== this.documentId || after.id !== this.documentId) {
            this.cancel();
            return;
        }
        const ranges: TemplateRange[] = [];
        for (const range of this.ranges) {
            const old = findNode(before, range.blockId),
                next = findNode(after, range.blockId);
            if (!old || !next) {
                this.cancel();
                return;
            }
            const a = blockText(old),
                b = blockText(next);
            if (range.from === 0 && range.to === a.length) {
                ranges.push({ ...range, to: b.length });
                continue;
            }
            const change = textDifference(a, b);
            const delta = change.text.length - (change.to - change.from);
            const map = (offset: number, end: boolean) =>
                offset < change.from || (!end && offset === change.from)
                    ? offset
                    : offset >= change.to
                      ? offset + delta
                      : change.from + (end ? change.text.length : 0);
            ranges.push({ ...range, from: map(range.from, false), to: map(range.to, true) });
        }
        this.ranges = ranges;
    }
    key(event: {
        key: string;
        shiftKey?: boolean;
        ctrlKey?: boolean;
        metaKey?: boolean;
        altKey?: boolean;
        isComposing?: boolean;
    }): { handled: boolean; selection?: NativeSelection } {
        if (!this.active || event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
            return { handled: false };
        if (event.key === 'Escape') {
            this.cancel();
            return { handled: true };
        }
        if (!['Tab', 'Enter'].includes(event.key)) return { handled: false };
        const index = Math.max(0, this.index + (event.key === 'Tab' && event.shiftKey ? -1 : 1));
        if (index >= this.ranges.length) {
            const last = this.ranges.at(-1)!;
            this.cancel();
            const point = { blockId: last.blockId, offset: last.to };
            return { handled: true, selection: { anchor: point, focus: point } };
        }
        this.index = index;
        return { handled: true, selection: this.selection() };
    }
}
