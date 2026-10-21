import { applyDocumentCommand } from '@saad5400/midad/content/commands';
import { DocumentSession, exportDocument, importDocument } from '@saad5400/midad/document';
import { blockText, commandTrigger, runDocumentCommand } from '@saad5400/midad/editing';
import { describe, expect, it } from 'vitest';

const source = (text: string) =>
    importDocument(
        {
            type: 'doc',
            content: [{ type: 'paragraph', attrs: { id: 'p', retained: 'yes' }, content: [{ type: 'text', text }] }],
        },
        'command',
    );
const at = (offset: number) => ({ anchor: { blockId: 'p', offset }, focus: { blockId: 'p', offset } });
describe('command transactions', () => {
    it.each(['/', '/h1', '/عنوان'])('detects the start-of-paragraph trigger %s', (text) => {
        expect(commandTrigger(source(text), at(text.length))).toMatchObject({
            from: 0,
            to: text.length,
            query: text.slice(1),
        });
    });
    it.each(['Text /h1', ' /h1', '/h1 ', '/a/b', '/\n', '/\uFFFC'])('does not hijack literal input %j', (text) => {
        expect(commandTrigger(source(text), at(text.length))).toBeUndefined();
    });
    it('consumes a query and changes the block in one revision while preserving suffix, metadata and history', () => {
        const document = source('/h1 suffix'),
            before = exportDocument(document),
            session = new DocumentSession(document);
        const selection = at(3),
            trigger = commandTrigger(document, selection)!;
        const result = applyDocumentCommand(
            document,
            selection,
            { kind: 'block', attributes: { kind: 'heading', level: 1 } },
            { trigger },
        )!;
        expect(result.document.revision).toBe(1);
        expect(result.document.root.children![0].kind).toBe('heading');
        expect(result.document.root.children![0].attributes?.retained).toBe('yes');
        expect(blockText(result.document.root.children![0])).toBe(' suffix');
        session.commit(result.document);
        session.undo();
        expect(exportDocument(session.document)).toEqual(before);
        session.redo();
        expect(session.document.root).toBe(result.document.root);
    });
    it.each(['table', 'separator', 'clause', 'field'] as const)('replaces /query with %s as one action', (kind) => {
        const document = source('/query'),
            selection = at(6),
            trigger = commandTrigger(document, selection)!;
        const command =
            kind === 'table'
                ? { kind, rows: 2, columns: 2, header: false }
                : kind === 'field'
                  ? { kind, field: { type: 'text' as const, name: 'Name' } }
                  : { kind };
        const result = applyDocumentCommand(document, selection, command, { trigger })!;
        expect(result.document.revision).toBe(1);
        expect(JSON.stringify(exportDocument(result.document))).not.toContain('/query');
        expect(result.caret).toBeTruthy();
    });
    it.each([
        ['ar', 'rtl'],
        ['en', 'ltr'],
    ])('inherits table direction from a %s column after removing the query', (lang, dir) => {
        const document = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'parallelRow',
                        content: [
                            {
                                type: 'parallelCell',
                                attrs: { lang },
                                content: [
                                    {
                                        type: 'paragraph',
                                        attrs: { id: 'p' },
                                        content: [{ type: 'text', text: '/table' }],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            'command',
        );
        const selection = at(6),
            trigger = commandTrigger(document, selection)!;
        const result = applyDocumentCommand(
            document,
            selection,
            { kind: 'table', rows: 2, columns: 2, header: false },
            { trigger },
        )!;
        expect(result.document.root.children![0].children![0].children![0].attributes?.dir).toBe(dir);
    });

    it('returns collapsed formatting with a consumed query and leaves cancellations and stale positions unchanged', () => {
        const document = source('/bold'),
            selection = at(5),
            trigger = commandTrigger(document, selection)!;
        const result = applyDocumentCommand(
            document,
            selection,
            { kind: 'format', format: { kind: 'toggle', mark: 'bold' } },
            { trigger },
        )!;
        expect(result.marks).toContainEqual({ kind: 'bold' });
        expect(blockText(result.document.root.children![0])).toBe('');
        expect(runDocumentCommand(document, selection, undefined, trigger, () => undefined)).toBeUndefined();
        const rebased = {
            ...document,
            revision: 1,
            root: { ...document.root, attributes: { retainedRemoteChange: true } },
        };
        expect(
            applyDocumentCommand(
                rebased,
                selection,
                { kind: 'block', attributes: { kind: 'heading', level: 1 } },
                { trigger },
            )?.document.root.attributes,
        ).toEqual({ retainedRemoteChange: true });
        expect(() => runDocumentCommand(source('/changed'), selection, undefined, trigger, () => undefined)).toThrow(
            'position',
        );
        expect(blockText(document.root.children![0])).toBe('/bold');
    });
});
