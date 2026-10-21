import { importDocument, type Attributes, type NativeDocument } from '@saad5400/midad/document';
import { floatingFieldPlacement, placementAttributes } from '@saad5400/midad/content/fields';
import {
    bindFloatingAnchors,
    floatingAnchorIndex,
    resolveFloatingAnchor,
} from '@saad5400/midad/content/floating-anchors';
import type { DocumentScene, ScenePage } from '@saad5400/midad/layout';
import { SharedNativeDocument } from '@saad5400/midad/collaboration';
import { describe, expect, it } from 'vitest';

const paragraph = (id: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text: id }] });
const rawField = { id: 'field', type: 'text', x: 160, y: 280, width: 120, height: 40, settings: {} };
const document = (attrs: Record<string, unknown> = {}, content: unknown[] = ['a', 'b', 'c'].map(paragraph)) =>
    importDocument({ type: 'doc', attrs: { blockVariables: [rawField], ...attrs }, content }, 'anchors');
const field = (doc: NativeDocument) => (doc.root.attributes!.blockVariables as readonly Attributes[])[0];
const page = (blocks: Array<[string, number]>, extra: Partial<ScenePage> = {}): ScenePage => ({
    width: 600,
    height: 800,
    lines: [],
    commands: [],
    blocks: blocks.map(([id, y]) => ({ id, x: 60, y, width: 480, height: 40 })),
    ...extra,
});
const scene = (
    doc: NativeDocument,
    pages = [
        page([
            ['a', 100],
            ['b', 200],
            ['c', 300],
        ]),
    ],
    coverPages = 0,
): DocumentScene => ({
    documentId: doc.id,
    revision: doc.revision,
    fontHash: '',
    margin: 60,
    glyphCount: 0,
    coverPages,
    pages: pages.map((entry, index) => ({
        ...entry,
        commands: [
            ...entry.commands,
            ...(index === coverPages
                ? [
                      {
                          kind: 'field' as const,
                          nodeId: 'field',
                          attributes: rawField,
                          x: 120,
                          y: 210,
                          width: 90,
                          height: 30,
                      },
                  ]
                : []),
        ],
    })),
});
const placed = () => {
    const doc = document();
    return bindFloatingAnchors(doc, scene(doc));
};
const resolve = (doc: NativeDocument, pages: readonly ScenePage[]) =>
    resolveFloatingAnchor(
        field(doc),
        floatingFieldPlacement(field(doc), { width: 600, height: 800 }, 1100),
        floatingAnchorIndex(doc, { pages }),
    );

describe('native floating anchors', () => {
    it('binds legacy positions without changing their visible geometry or creating an undo revision', () => {
        const doc = document(),
            bound = bindFloatingAnchors(doc, scene(doc));
        expect(bound.revision).toBe(doc.revision);
        expect(field(bound).nativeAnchor).toMatchObject({ block: 'b', edge: 'start', x: 60, y: 10 });
        expect(resolve(bound, scene(doc).pages)).toMatchObject({ page: 0, x: 120, y: 210, width: 90, height: 30 });
        expect(bindFloatingAnchors(bound, scene(bound))).toBe(bound);
    });
    it('follows block movement and resolves the same position after a saved JSON reload', () => {
        const doc = placed(),
            pages = [
                page([
                    ['a', 100],
                    ['c', 200],
                    ['b', 400],
                ]),
            ];
        expect(resolve(doc, pages)).toMatchObject({ page: 0, x: 120, y: 410 });
        const reloaded = document({ blockVariables: [field(doc)] });
        expect(resolve(reloaded, pages)).toEqual(resolve(doc, pages));
    });
    it('follows an anchor onto another page and keeps an overflowing object inside a page', () => {
        const doc = placed();
        expect(
            resolve(doc, [
                page([['a', 100]]),
                page([
                    ['b', 80],
                    ['c', 200],
                ]),
            ]),
        ).toMatchObject({ page: 1, y: 90 });
        const crossing = resolve(doc, [
            page([
                ['a', 100],
                ['b', 795],
            ]),
        ]);
        expect(crossing.page).toBe(1);
        expect(crossing.y).toBe(0);
        expect(crossing.y + crossing.height).toBeLessThanOrEqual(800);
    });
    it('uses a surviving paragraph when its original anchor is removed', () => {
        const source = placed();
        const doc = document({ blockVariables: [field(source)] }, [paragraph('a'), paragraph('c')]);
        expect(
            resolve(doc, [
                page([
                    ['a', 100],
                    ['c', 200],
                ]),
            ]),
        ).toMatchObject({ y: 210 });
    });
    it('follows the retained body paragraph when a clause with a hidden title is unwrapped', () => {
        const clause = {
            type: 'clause',
            attrs: { id: 'clause', isTitleHidden: true },
            content: [{ type: 'clauseBody', attrs: { id: 'body' }, content: [paragraph('b')] }],
        };
        const doc = document({}, [clause]);
        const lines = [
            { paragraphId: 'b', left: 60, top: 200, height: 40, shaped: { width: 480 } },
        ] as unknown as ScenePage['lines'];
        const bound = bindFloatingAnchors(doc, scene(doc, [page([['clause', 200]], { lines })]));
        expect(field(bound).nativeAnchor).toMatchObject({ fallbacks: [{ block: 'b', edge: 'start' }] });
        const unwrapped = document({ blockVariables: [field(bound)] }, [paragraph('b')]);
        expect(resolve(unwrapped, [page([['b', 300]])]).y).toBe(310);
    });
    it('retains the anchor when its paragraph is wrapped inside columns', () => {
        const source = placed();
        const doc = document({ blockVariables: [field(source)] }, [
            {
                type: 'parallelRow',
                attrs: { id: 'columns' },
                content: [{ type: 'parallelCell', attrs: { lang: 'en' }, content: [paragraph('b')] }],
            },
        ]);
        const pages = [
            page([['columns', 100]], {
                lines: [
                    { paragraphId: 'b', left: 300, top: 150, height: 40, shaped: { width: 200 } },
                ] as unknown as ScenePage['lines'],
            }),
        ];
        expect(resolve(doc, pages)).toMatchObject({ x: 360, y: 160 });
    });
    it('keeps cover objects and locked images fixed and removes stale anchors from them', () => {
        const saved = field(placed()).nativeAnchor!;
        const doc = document({
            blockVariables: [{ ...rawField, surface: 'cover', nativeAnchor: saved }],
            floatingImages: [{ id: 'locked', src: 'image', locked: true, nativeAnchor: saved }],
        });
        const bound = bindFloatingAnchors(doc, scene(doc));
        expect(field(bound).nativeAnchor).toBeUndefined();
        expect((bound.root.attributes!.floatingImages as readonly Attributes[])[0].nativeAnchor).toBeUndefined();
        const original = { page: 0, x: 10, y: 10, width: 20, height: 20 };
        expect(
            resolveFloatingAnchor(
                { src: 'image', locked: true, nativeAnchor: saved },
                original,
                floatingAnchorIndex(doc, scene(doc)),
            ),
        ).toBe(original);
    });
    it('treats body page numbers independently of the cover page', () => {
        const doc = document(),
            withCover = scene(
                doc,
                [
                    page([]),
                    page([
                        ['a', 100],
                        ['b', 200],
                        ['c', 300],
                    ]),
                ],
                1,
            );
        const bound = bindFloatingAnchors(doc, withCover);
        expect(field(bound).nativeAnchor).toMatchObject({ block: 'b', y: 10 });
        expect(
            resolve(bound, [
                page([
                    ['a', 100],
                    ['b', 200],
                    ['c', 300],
                ]),
            ]),
        ).toMatchObject({ page: 0, y: 210 });
    });
    it('rebinds a manually moved object to its new paragraph', () => {
        const doc = placed(),
            layout = scene(doc);
        const moved = placementAttributes(
            field(doc),
            'field',
            layout,
            { page: 0, x: 180, y: 310, width: 90, height: 30 },
            doc,
        );
        expect(moved.nativeAnchor).toMatchObject({ block: 'c', x: 120, y: 10 });
    });
    it('follows the end of a paragraph when an object sits in the space after its text', () => {
        const doc = document({}, [paragraph('b')]);
        const line = (height: number) => ({ paragraphId: 'b', left: 60, top: 200, height, shaped: { width: 480 } });
        const initial = scene(doc, [page([['b', 200]], { lines: [line(20)] as unknown as ScenePage['lines'] })]);
        const pages = initial.pages.map((entry) => ({
            ...entry,
            commands: entry.commands.map((command) => (command.kind === 'field' ? { ...command, y: 230 } : command)),
        }));
        const bound = bindFloatingAnchors(doc, { ...initial, pages });
        expect(field(bound).nativeAnchor).toMatchObject({ block: 'b', edge: 'end', y: 10 });
        const longer = [page([['b', 200]], { lines: [line(60)] as unknown as ScenePage['lines'] })];
        expect(resolve(bound, longer).y).toBe(270);
    });
    it('rejects malformed anchor coordinates instead of rendering a different position', () => {
        const doc = placed();
        expect(() =>
            resolveFloatingAnchor(
                { nativeAnchor: { block: 'b', edge: 'start', x: 'bad', y: 0, fallbacks: [] } },
                { page: 0, x: 0, y: 0, width: 20, height: 20 },
                floatingAnchorIndex(doc, scene(doc)),
            ),
        ).toThrow('anchor is invalid');
    });
    it('merges concurrent object moves as one anchor instead of combining an offset from another paragraph', () => {
        const a = SharedNativeDocument.create(placed()),
            b = SharedNativeDocument.fromState(a.state(), 'anchors');
        const changed = (doc: NativeDocument, value: Attributes): NativeDocument =>
            Object.freeze({
                ...doc,
                revision: doc.revision + 1,
                root: {
                    ...doc.root,
                    attributes: { ...doc.root.attributes, blockVariables: [{ ...field(doc), nativeAnchor: value }] },
                },
            });
        const first = { block: 'c', edge: 'start', x: 60, y: 10, fallbacks: [] },
            second = { block: 'b', edge: 'start', x: 80, y: 10, fallbacks: [] };
        try {
            a.publish(changed(a.document(), first));
            b.publish(changed(b.document(), second));
            a.receive(b.state());
            b.receive(a.state());
            expect([first, second]).toContainEqual(field(a.document()).nativeAnchor);
            expect(field(a.document()).nativeAnchor).toEqual(field(b.document()).nativeAnchor);
        } finally {
            a.destroy();
            b.destroy();
        }
    });
});
