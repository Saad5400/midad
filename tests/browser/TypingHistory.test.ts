import { describe, expect, it, vi, afterEach } from 'vitest';
import { TypingHistory, type TypingHistoryEdit } from '@saad5400/midad/browser/input';
import { DocumentSession, importDocument } from '@saad5400/midad/document';
import { replaceInlineText } from '@saad5400/midad/editing';
const edit = (values: Partial<TypingHistoryEdit> = {}): TypingHistoryEdit => ({
    revision: 0,
    blockId: 'p',
    from: 0,
    to: 0,
    text: 'a',
    inputType: 'insertText',
    collapsed: true,
    ...values,
});
afterEach(() => vi.useRealTimers());
describe('typing undo boundaries', () => {
    it('groups adjacent insertions, backward deletions and forward deletions', () => {
        for (const inputType of ['insertText', 'deleteContentBackward', 'deleteContentForward']) {
            const history = new TypingHistory();
            const from = inputType === 'deleteContentBackward' ? 4 : 5;
            const first = history.group(
                edit({
                    from,
                    to: inputType === 'insertText' ? from : from + 1,
                    text: inputType === 'insertText' ? 'a' : '',
                    inputType,
                }),
            );
            const next =
                inputType === 'insertText' ? from + 1 : inputType === 'deleteContentBackward' ? from - 1 : from;
            expect(
                history.group(
                    edit({
                        revision: 1,
                        from: next,
                        to: inputType === 'insertText' ? next : next + 1,
                        text: inputType === 'insertText' ? 'b' : '',
                        inputType,
                    }),
                ),
            ).toBe(first);
        }
    });
    it('breaks on selection replacement, composition, paste, navigation, style or intervening commands', () => {
        for (const patch of [
            { collapsed: false },
            { inputType: 'insertCompositionText' },
            { inputType: 'insertFromPaste' },
            { from: 8, to: 8 },
            { style: 'bold' },
            { revision: 4 },
            { blockId: 'other' },
        ]) {
            const history = new TypingHistory(),
                first = history.group(edit());
            expect(history.group(edit({ revision: 1, from: 1, to: 1, ...patch }))).not.toBe(first);
        }
        const history = new TypingHistory(),
            first = history.group(edit());
        history.reset();
        expect(history.group(edit({ revision: 1, from: 1, to: 1 }))).not.toBe(first);
    });
    it('keeps one initial snapshot per typing burst and separates pauses, explicit boundaries and redo branches', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);
        const session = new DocumentSession(
            importDocument(
                { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'p' }, content: [] }] },
                'typing',
            ),
        );
        const token = {};
        const write = (text: string, group?: object) =>
            session.commit(
                replaceInlineText(session.document, {
                    blockId: 'p',
                    from: 0,
                    to: 0,
                    text,
                    expectedRevision: session.document.revision,
                }),
                group,
            );
        expect(write('a', token)).toBe(true);
        expect(write('b', token)).toBe(false);
        expect(session.undo()).toBe(true);
        expect(session.document.root.children![0].children).toEqual([]);
        expect(session.redo()).toBe(true);
        expect(write('c', token)).toBe(true);
        vi.advanceTimersByTime(501);
        expect(write('d', token)).toBe(true);
        session.stopCapturing();
        expect(write('e', token)).toBe(true);
        expect(write('f')).toBe(true);
        expect(write('g')).toBe(true);
    });
});
