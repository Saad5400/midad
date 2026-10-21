import { importDocument } from '@saad5400/midad/document';
import { compareHistory } from '@saad5400/midad/history';
import { describe, expect, it } from 'vitest';

const paragraph = (id: string | undefined, text: string, attrs = {}) => ({
    type: 'paragraph',
    attrs: { ...(id ? { nativeId: id } : {}), ...attrs },
    content: [{ type: 'text', text }],
});
const document = (content: unknown[], attrs = {}) => importDocument({ type: 'doc', attrs, content }, 'history');

describe('native version comparison', () => {
    it('compares Arabic and English wording using stable paragraph identities', () => {
        const changes = compareHistory(
            document([paragraph('p', 'السداد خلال thirty يوماً')]),
            document([paragraph('p', 'السداد خلال sixty يوماً')]),
        );
        expect(changes).toHaveLength(1);
        expect(changes[0].kind).toBe('modified');
        expect(
            changes[0].text
                .filter((part) => part.kind === 'removed')
                .map((part) => part.text)
                .join(''),
        ).toBe('thirty');
        expect(
            changes[0].text
                .filter((part) => part.kind === 'added')
                .map((part) => part.text)
                .join(''),
        ).toBe('sixty');
    });
    it('compares legacy snapshots without persisted editor identities', () => {
        const changes = compareHistory(
            document([paragraph(undefined, 'Before')]),
            document([paragraph(undefined, 'After')]),
        );
        expect(changes).toHaveLength(1);
        expect(changes[0].kind).toBe('modified');
    });
    it('detects formatting-only changes and ignores renderer markers and generated identities', () => {
        expect(
            compareHistory(
                document([paragraph('p', 'Text')], { nativeEditor: { renderer: 'old' } }),
                document([paragraph('p', 'Text')], { nativeEditor: { renderer: 'new' } }),
            ),
        ).toEqual([]);
        const changes = compareHistory(
            document([paragraph('p', 'Text')]),
            document([paragraph('p', 'Text', { textAlign: 'center' })]),
        );
        expect(changes).toHaveLength(1);
        expect(changes[0].formatting).toBe(true);
    });
    it('reports inserted and removed blocks without losing surrounding unchanged text', () => {
        const changes = compareHistory(
            document([paragraph('a', 'A'), paragraph('b', 'B')]),
            document([paragraph('a', 'A'), paragraph('c', 'C'), paragraph('b', 'B')]),
        );
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({ kind: 'added', after: { id: 'c', text: 'C' } });
    });
    it('recognizes moved blocks', () => {
        const changes = compareHistory(
            document([paragraph('a', 'A'), paragraph('b', 'B')]),
            document([paragraph('b', 'B'), paragraph('a', 'A')]),
        );
        expect(changes).toHaveLength(1);
        expect(changes[0].kind).toBe('moved');
    });
    it('detects fields, images and floating-object settings without duplicating the paragraph change', () => {
        const source = (value: string, src: string) =>
            document([
                {
                    type: 'paragraph',
                    attrs: { id: 'p' },
                    content: [
                        { type: 'variable', attrs: { id: 'field', type: 'text', name: 'Name', value } },
                        { type: 'image', attrs: { id: 'image', src, width: 50, height: 40 } },
                    ],
                },
            ]);
        const changes = compareHistory(source('Old', 'first'), source('New', 'second'));
        expect(changes.map((change) => change.after!.kind)).toEqual(['variable', 'image']);
        expect(
            compareHistory(
                document([], { blockVariables: [{ id: 'f', type: 'text', name: 'Field', x: 10 }] }),
                document([], { blockVariables: [{ id: 'f', type: 'text', name: 'Field', x: 20 }] }),
            ),
        ).toHaveLength(1);
    });
    it('keeps comparison bounded for large unrelated documents', () => {
        const before = document(Array.from({ length: 600 }, (_, i) => paragraph(undefined, `Old ${i} `.repeat(20))));
        const after = document(Array.from({ length: 600 }, (_, i) => paragraph(undefined, `New ${i} `.repeat(20))));
        const started = performance.now();
        expect(compareHistory(before, after).length).toBeGreaterThan(0);
        expect(performance.now() - started).toBeLessThan(1000);
    });
});
