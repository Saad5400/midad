import type { NativeDocument, NativeMark } from '../../document/model.js';
import { captureCommandBookmark, commandBookmarkValid, type CommandBookmark } from '../../editing/bookmark.js';
import { commandTrigger, type CommandTrigger } from '../../editing/command.js';
import type { NativeSelection } from '../../editing/selection.js';
import type { WritingTarget } from '../../editing/writing-position.js';

export interface DocumentCommandKey {
    key: string;
    isComposing?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    preventDefault: () => void;
}
export interface DocumentCommandState {
    document: () => NativeDocument;
    selection: () => NativeSelection | null;
    target?: () => WritingTarget | undefined;
    marks?: () => readonly NativeMark[] | undefined;
    objectId?: () => string | undefined;
    enabled?: () => boolean;
}
export interface PendingDocumentCommand<Kind extends string = string> {
    readonly kind: Kind;
    readonly context: CommandBookmark;
    readonly signal: AbortSignal;
}
export class DocumentCommandController<Pending extends string = string> {
    private currentTrigger?: CommandTrigger;
    private currentPending?: PendingDocumentCommand<Pending>;
    private dismissed?: string;
    private pendingAbort?: AbortController;
    constructor(private readonly state: DocumentCommandState) {}
    get trigger(): CommandTrigger | undefined {
        return this.currentTrigger;
    }
    get pending(): PendingDocumentCommand<Pending> | undefined {
        return this.currentPending;
    }
    private origin(value: CommandTrigger): string {
        return `${value.documentId}:${value.blockId}:${value.from}`;
    }
    refresh(): void {
        if (this.state.enabled?.() === false) {
            this.hide();
            return;
        }
        const next = commandTrigger(this.state.document(), this.state.selection());
        if (!next) {
            this.hide();
            this.dismissed = undefined;
            return;
        }
        if (this.dismissed === this.origin(next)) {
            this.hide();
            return;
        }
        const current = this.currentTrigger;
        if (
            !current ||
            current.documentId !== next.documentId ||
            current.revision !== next.revision ||
            current.blockId !== next.blockId ||
            current.to !== next.to ||
            current.text !== next.text
        )
            this.currentTrigger = Object.freeze(next);
    }
    hide(): void {
        this.currentTrigger = undefined;
    }
    dismiss(): void {
        if (this.currentTrigger) this.dismissed = this.origin(this.currentTrigger);
        this.hide();
    }
    context(slash = false): CommandBookmark {
        return captureCommandBookmark({
            document: this.state.document(),
            selection: this.state.selection(),
            target: this.state.target?.(),
            marks: this.state.marks?.(),
            objectId: this.state.objectId?.(),
            ...(slash ? { trigger: this.currentTrigger } : {}),
        });
    }
    valid(context: CommandBookmark): boolean {
        return commandBookmarkValid(this.state.document(), context, this.state.objectId?.());
    }
    beginPending(kind: Pending, context: CommandBookmark): void {
        this.pendingAbort?.abort();
        this.pendingAbort = new AbortController();
        this.currentPending = Object.freeze({
            kind,
            context: captureCommandBookmark(context),
            signal: this.pendingAbort.signal,
        });
    }
    endPending(kind: Pending): void {
        if (this.currentPending?.kind !== kind) return;
        this.pendingAbort?.abort();
        this.pendingAbort = undefined;
        this.currentPending = undefined;
    }
    key(event: DocumentCommandKey, menuKey?: (event: DocumentCommandKey) => boolean): boolean {
        if (!this.currentTrigger || event.isComposing) return false;
        if (menuKey?.(event)) return true;
        if (event.key === 'Escape') {
            this.dismiss();
            event.preventDefault();
            return true;
        }
        if (event.ctrlKey || event.metaKey || event.altKey || ['ArrowLeft', 'ArrowRight'].includes(event.key))
            this.dismiss();
        return false;
    }
    reset(): void {
        this.hide();
        this.pendingAbort?.abort();
        this.pendingAbort = undefined;
        this.currentPending = undefined;
        this.dismissed = undefined;
    }
}
