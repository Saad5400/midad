import { findNode, type NativeDocument, type NativeMark } from '../document/model.js';
import { runDocumentCommand, type CommandTrigger } from '../editing/command.js';
import {
    changeTextMarks,
    formatBlock,
    formatText,
    marksAtCaret,
    type BlockFormat,
    type FormatCommand,
} from '../editing/formatting.js';
import { toggleList, type ListKind } from '../editing/lists.js';
import { replaceSelection, selectionRanges, type NativeSelection } from '../editing/selection.js';
import { insertTable } from '../editing/tables.js';
import { allocator, pasteBlocks, nodePath, textBlocks, blockText } from '../editing/text.js';
import type { WritingTarget } from '../editing/writing-position.js';
import type { WritingResult } from '../editing/writing-position.js';
import { insertNativeClause, type LibraryClause } from './clauses/commands.js';
import { insertNativeField, type FieldDraft } from './fields/commands.js';

export type DocumentCommand =
    | { kind: 'format'; format: FormatCommand }
    | { kind: 'block'; attributes: BlockFormat }
    | { kind: 'list'; list: ListKind }
    | { kind: 'table'; rows: number; columns: number; header: boolean }
    | { kind: 'clause'; source?: LibraryClause; placeholder?: { title: string; body: string } }
    | { kind: 'field'; field: FieldDraft }
    | { kind: 'separator' };

export interface DocumentCommandResult extends WritingResult {
    readonly marks?: readonly NativeMark[];
    readonly fieldId?: string;
    readonly template?: readonly { id: string; blockId: string; from: number; to: number }[];
}

export function applyDocumentCommand(
    document: NativeDocument,
    selection: NativeSelection | null,
    command: DocumentCommand,
    options: {
        target?: WritingTarget;
        trigger?: CommandTrigger;
        marks?: readonly NativeMark[];
    } = {},
): DocumentCommandResult | undefined {
    return runDocumentCommand<DocumentCommandResult>(
        document,
        selection,
        options.target,
        options.trigger,
        (working, selected) => {
            const point = selected.focus;
            if (command.kind === 'format') {
                const ranges = selectionRanges(working, selected);
                if (ranges.every((range) => range.from === range.to)) {
                    const block = findNode(working, point.blockId)!;
                    return {
                        document: working,
                        caret: point,
                        marks: changeTextMarks(options.marks ?? marksAtCaret(block, point.offset), command.format),
                    };
                }
                let next = working;
                for (const range of ranges)
                    next = formatText(next, { ...range, expectedRevision: next.revision }, command.format);
                return { document: next, caret: point };
            }
            if (command.kind === 'block') {
                let next = working;
                for (const range of selectionRanges(working, selected))
                    next = formatBlock(next, range.blockId, command.attributes);
                return { document: next, caret: point };
            }
            if (command.kind === 'list') return { document: toggleList(working, selected, command.list), caret: point };
            const replaced = replaceSelection(working, selected, '');
            if (command.kind === 'table')
                return insertTable(replaced.document, replaced.caret, command.rows, command.columns, command.header);
            if (command.kind === 'clause') {
                let source = command.source;
                if (!source && command.placeholder) {
                    const id = crypto.randomUUID();
                    source = {
                        uuid: crypto.randomUUID(),
                        title: command.placeholder.title,
                        variants: [
                            {
                                uuid: id,
                                body_content: {
                                    type: 'doc',
                                    content: [
                                        {
                                            type: 'paragraph',
                                            content: [{ type: 'text', text: command.placeholder.body }],
                                        },
                                    ],
                                },
                            },
                        ],
                    };
                }
                const result = insertNativeClause(replaced.document, replaced.caret, source);
                if (!command.placeholder) return result;
                const path = nodePath(result.document, result.caret.blockId);
                const clause = path.find((node) => node.kind === 'clause')!;
                return {
                    ...result,
                    template: textBlocks(clause)
                        .slice(0, 2)
                        .map((block, index) => ({
                            id: `${clause.id}:${index}`,
                            blockId: block.id,
                            from: 0,
                            to: blockText(block).length,
                        })),
                };
            }
            if (command.kind === 'field')
                return insertNativeField(
                    replaced.document,
                    {
                        blockId: replaced.caret.blockId,
                        from: replaced.caret.offset,
                        to: replaced.caret.offset,
                        expectedRevision: replaced.document.revision,
                    },
                    command.field,
                );
            const id = allocator(replaced.document)();
            return pasteBlocks(
                replaced.document,
                {
                    blockId: replaced.caret.blockId,
                    from: replaced.caret.offset,
                    to: replaced.caret.offset,
                    expectedRevision: replaced.document.revision,
                },
                [{ id, kind: 'horizontalRule' }],
            );
        },
    );
}
