export interface TypingHistoryEdit {
    readonly revision: number;
    readonly blockId: string;
    readonly from: number;
    readonly to: number;
    readonly text: string;
    readonly inputType?: string;
    readonly collapsed: boolean;
    readonly style?: string;
}
export class TypingHistory {
    private previous?: {
        revision: number;
        blockId: string;
        offset: number;
        kind: string;
        style?: string;
        token: object;
    };
    reset(): void {
        this.previous = undefined;
    }
    group(edit: TypingHistoryEdit): object | undefined {
        const kind = edit.inputType;
        if (
            !edit.collapsed ||
            !['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(kind ?? '') ||
            edit.text.includes('\n') ||
            (kind === 'insertText' && (!edit.text || edit.from !== edit.to))
        ) {
            this.reset();
            return;
        }
        const before = kind === 'deleteContentBackward' ? edit.to : edit.from;
        const prior = this.previous;
        const token =
            prior &&
            prior.revision === edit.revision &&
            prior.blockId === edit.blockId &&
            prior.kind === kind &&
            prior.style === edit.style &&
            prior.offset === before
                ? prior.token
                : {};
        this.previous = {
            revision: edit.revision + 1,
            blockId: edit.blockId,
            offset: edit.from + edit.text.length,
            kind: kind!,
            style: edit.style,
            token,
        };
        return token;
    }
}
