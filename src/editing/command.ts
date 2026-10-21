import { findNode, type NativeDocument } from '../document/model.js';
import { replaceInlineText, blockText } from './text.js';
import type { NativeSelection } from './selection.js';
import { writeAtPosition, type WritingResult, type WritingTarget } from './writing-position.js';

export interface CommandTrigger {
    readonly documentId: string;
    readonly revision: number;
    readonly blockId: string;
    readonly from: number;
    readonly to: number;
    readonly text: string;
    readonly query: string;
}

export function commandTrigger(
    document: NativeDocument,
    selection: NativeSelection | null,
): CommandTrigger | undefined {
    if (
        !selection ||
        selection.cells ||
        selection.scopeId ||
        selection.anchor.blockId !== selection.focus.blockId ||
        selection.anchor.offset !== selection.focus.offset
    )
        return;
    const block = findNode(document, selection.focus.blockId);
    if (!block || !['paragraph', 'heading', 'clauseTitle'].includes(block.kind)) return;
    const prefix = blockText(block).slice(0, selection.focus.offset);
    if (!/^\/[^\s/\uFFFC]{0,80}$/u.test(prefix)) return;
    return {
        documentId: document.id,
        revision: document.revision,
        blockId: block.id,
        from: 0,
        to: prefix.length,
        text: prefix,
        query: prefix.slice(1),
    };
}

export function commandSelection(document: NativeDocument, trigger: CommandTrigger): NativeSelection {
    const block = findNode(document, trigger.blockId);
    if (
        document.id !== trigger.documentId ||
        document.revision < trigger.revision ||
        !block ||
        !['paragraph', 'heading', 'clauseTitle'].includes(block.kind) ||
        !Number.isSafeInteger(trigger.from) ||
        !Number.isSafeInteger(trigger.to) ||
        trigger.from < 0 ||
        trigger.to < trigger.from ||
        trigger.to > blockText(block).length ||
        blockText(block).slice(trigger.from, trigger.to) !== trigger.text
    )
        throw new Error('The command position has changed');
    return {
        anchor: { blockId: trigger.blockId, offset: trigger.from },
        focus: { blockId: trigger.blockId, offset: trigger.to },
    };
}

export function runDocumentCommand<T extends WritingResult>(
    document: NativeDocument,
    selection: NativeSelection | null,
    target: WritingTarget | undefined,
    trigger: CommandTrigger | undefined,
    action: (document: NativeDocument, selection: NativeSelection) => T | undefined | null,
): T | undefined {
    if (trigger) selection = commandSelection(document, trigger);
    return writeAtPosition(document, selection, target, (working, selected) => {
        if (trigger) {
            const removed = replaceInlineText(working, {
                blockId: trigger.blockId,
                from: trigger.from,
                to: trigger.to,
                text: '',
                expectedRevision: working.revision,
            });
            working = Object.freeze({ ...removed, revision: working.revision });
            selected = { anchor: selected.anchor, focus: selected.anchor };
        }
        return action(working, selected);
    });
}
