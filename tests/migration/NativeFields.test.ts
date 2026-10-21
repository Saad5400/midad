import { DocumentSession, exportDocument, findNode, importDocument } from '@saad5400/midad/document';
import { blockText, pasteBlocks } from '@saad5400/midad/editing';
import {
    floatingFieldPlacement,
    inlineNativeField,
    insertFloatingNativeField,
    placeNativeField,
    transformField,
} from '@saad5400/midad/field-placement';
import {
    NATIVE_FIELD_TYPES,
    fieldDisplayValue,
    fieldStyle,
    insertNativeField,
    nativeFields,
    removeNativeField,
    stampNativeFields,
    updateNativeField,
} from '@saad5400/midad/fields';
import type { DocumentScene } from '@saad5400/midad/layout';
import { describe, expect, it } from 'vitest';

const source = () =>
    importDocument(
        {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    attrs: { id: 'p', dir: 'rtl' },
                    content: [{ type: 'text', text: 'قبل بعد', marks: [{ type: 'bold' }] }],
                },
            ],
        },
        'fields',
    );
const insert = (type: 'text' | 'date' | 'signature' = 'text') =>
    insertNativeField(source(), { blockId: 'p', from: 4, to: 4, expectedRevision: 0 }, { type, name: 'اسم الحقل' });

describe('native contract fields', () => {
    it.each(NATIVE_FIELD_TYPES)('allows clearing a %s name while preserving its identity and settings', (type) => {
        const inserted = insertNativeField(
            source(),
            { blockId: 'p', from: 4, to: 4, expectedRevision: 0 },
            {
                type,
                name: 'Original name',
                description: 'Keep this hint',
                settings: { required: false },
            },
        );
        const updated = updateNativeField(inserted.document, inserted.fieldId, { name: '  ' });
        expect(nativeFields(updated)[0]).toMatchObject({
            id: inserted.fieldId,
            attributes: {
                type,
                name: '',
                description: 'Keep this hint',
                settings: { required: false },
            },
        });
        const session = new DocumentSession(inserted.document);
        session.commit(updated);
        session.undo();
        expect(nativeFields(session.document)[0].attributes.name).toBe('Original name');
    });
    it('copies floating field attributes with a fresh identity and rebinds its page geometry', () => {
        const document = source();
        const scene = {
            documentId: document.id,
            revision: document.revision,
            pages: [{ width: 600, height: 800, lines: [], commands: [] }],
        } as unknown as DocumentScene;
        const original = {
            id: 'original',
            type: 'text',
            name: 'Copied',
            description: 'Hint',
            manuallyResized: true,
            nativeAnchor: { paragraphId: 'obsolete' },
            settings: { fontFamily: 'Amiri', multiline: true },
        };
        const copy = insertFloatingNativeField(
            document,
            { type: 'text', name: 'Copied' },
            scene,
            { page: 0, x: 120, y: 150, width: 160, height: 80 },
            original,
        );
        const field = nativeFields(copy.document)[0];
        expect(field.id).not.toBe(original.id);
        expect(field.attributes).toMatchObject({
            name: 'Copied',
            description: 'Hint',
            manuallyResized: true,
            x: 160,
            y: 200,
            settings: { fontFamily: 'Amiri', multiline: true, relativeXPct: 0.2, page: 1 },
        });
        expect(field.attributes.nativeAnchor).not.toEqual(original.nativeAnchor);
        expect(original).toMatchObject({ id: 'original', nativeAnchor: { paragraphId: 'obsolete' } });
    });
    it('inserts a positioned field without adding text or pages and undoes it atomically', () => {
        const document = importDocument({ type: 'doc', attrs: { label: 'Untouched' }, content: [] }, 'direct-field');
        const scene = {
            documentId: document.id,
            revision: document.revision,
            pages: [{ width: 600, height: 800, lines: [], commands: [] }],
        } as unknown as DocumentScene;
        const session = new DocumentSession(document);
        const result = insertFloatingNativeField(document, { type: 'signature', name: 'Signature' }, scene, {
            page: 0,
            x: 90,
            y: 120,
            width: 180,
            height: 60,
        });
        session.commit(result.document);
        expect(session.document.root.children).toEqual([]);
        expect(session.document.revision).toBe(document.revision + 1);
        expect(nativeFields(session.document)).toMatchObject([
            {
                id: result.fieldId,
                floating: true,
                attributes: { name: 'Signature', x: 120, y: 160, width: 240, height: 80 },
            },
        ]);
        session.undo();
        expect(exportDocument(session.document)).toEqual(exportDocument(document));
    });
    it('refuses stale layouts, invalid fields and out-of-page placement before changing the document', () => {
        const document = importDocument({ type: 'doc', content: [] }, 'direct-invalid');
        const scene = {
            documentId: document.id,
            revision: document.revision,
            pages: [{ width: 600, height: 800, lines: [], commands: [] }],
        } as unknown as DocumentScene;
        const box = { page: 0, x: 90, y: 120, width: 180, height: 60 };
        expect(() => insertFloatingNativeField(document, { type: 'text', name: 'x'.repeat(256) }, scene, box)).toThrow(
            'name',
        );
        expect(() =>
            insertFloatingNativeField(document, { type: 'text', name: 'Text' }, { ...scene, revision: 1 }, box),
        ).toThrow('stale');
        expect(() =>
            insertFloatingNativeField(document, { type: 'text', name: 'Text' }, scene, { ...box, x: 590 }),
        ).toThrow('fit');
        expect(nativeFields(document)).toEqual([]);
    });
    const sceneFor = (document: ReturnType<typeof source>): DocumentScene =>
        ({
            documentId: document.id,
            revision: document.revision,
            pages: [0, 1].map(() => ({
                width: 600,
                height: 800,
                lines: [],
                commands: [
                    {
                        kind: 'field',
                        nodeId: nativeFields(document)[0].id,
                        attributes: nativeFields(document)[0].attributes,
                        x: 60,
                        y: 80,
                        width: 150,
                        height: 18,
                    },
                ],
            })),
        }) as unknown as DocumentScene;

    it('converts an inline field to a page position and back without changing identity or surrounding text', () => {
        const original = insert(),
            session = new DocumentSession(original.document);
        const positioned = placeNativeField(original.document, original.fieldId, sceneFor(original.document), {
            page: 1,
            x: 120,
            y: 160,
            width: 150,
            height: 18,
        });
        session.commit(positioned.document);
        expect(positioned.caret).toEqual({ blockId: 'p', offset: 4 });
        expect(blockText(findNode(session.document, 'p')!)).toBe('قبل بعد');
        expect(nativeFields(session.document)[0]).toMatchObject({
            id: original.fieldId,
            floating: true,
            attributes: {
                display: 'block',
                x: 160,
                width: 200,
                settings: { page: 2, relativeXPct: 0.2, relativeYPct: 0.2, widthPct: 0.25 },
            },
        });
        expect(session.document.revision).toBe(original.document.revision + 1);
        session.undo();
        expect(exportDocument(session.document)).toEqual(exportDocument(original.document));
        session.redo();
        const inline = inlineNativeField(session.document, original.fieldId, { blockId: 'p', offset: 4 });
        expect(blockText(findNode(inline.document, 'p')!)).toBe('قبل \uFFFCبعد');
        expect(nativeFields(inline.document)).toHaveLength(1);
        expect(nativeFields(inline.document)[0]).toMatchObject({ id: original.fieldId, floating: false });
        expect(inline.document.root.attributes?.blockVariables).toEqual([]);
        expect(inline.document.revision).toBe(session.document.revision + 1);
    });

    it('keeps exact page fractions when a field is stamped and reopened on a later page', () => {
        const original = insert(),
            scene = sceneFor(original.document);
        const positioned = placeNativeField(original.document, original.fieldId, scene, {
            page: 1,
            x: 123.456,
            y: 234.567,
            width: 150,
            height: 18,
        });
        const attrs = nativeFields(positioned.document)[0].attributes;
        expect(floatingFieldPlacement(attrs, scene.pages[1], 1123 + 30)).toEqual({
            page: 1,
            x: 123.456,
            y: 234.567,
            width: 150,
            height: 18,
        });
        const resized = updateNativeField(positioned.document, original.fieldId, { width: 300, height: 40 });
        expect(floatingFieldPlacement(nativeFields(resized)[0].attributes, scene.pages[1], 1153)).toMatchObject({
            width: 225,
            height: 30,
        });
    });

    it('supports legacy absolute positions when normalized geometry is absent', () => {
        expect(
            floatingFieldPlacement({ x: 100, y: 1173, width: 200, height: 80 }, { width: 600, height: 800 }, 1153),
        ).toEqual({ page: 1, x: 75, y: 15, width: 150, height: 60 });
    });

    it('clamps moves and opposite resizing edges to the page without flipping the field', () => {
        const box = { x: 60, y: 80, width: 150, height: 18 },
            page = { width: 600, height: 800 };
        expect(transformField(box, 'move', -1000, 1000, page)).toEqual({ ...box, x: 0, y: 782 });
        expect(transformField(box, 'nw', 1000, 1000, page)).toEqual({ x: 201, y: 89, width: 9, height: 9 });
        expect(transformField(box, 'se', 1000, 1000, page)).toEqual({ x: 60, y: 80, width: 540, height: 720 });
        expect(() => transformField(box, 'move', NaN, 0, page)).toThrow();
    });

    it('rejects stale scenes, off-page positions and invalid inline insertion without modifying the source', () => {
        const original = insert(),
            scene = sceneFor(original.document);
        expect(() => placeNativeField(original.document, original.fieldId, { ...scene, revision: 99 })).toThrow(
            'stale',
        );
        for (const patch of [{ page: 3 }, { x: -1 }, { width: 1000 }, { y: NaN }])
            expect(() =>
                placeNativeField(original.document, original.fieldId, scene, {
                    page: 0,
                    x: 0,
                    y: 0,
                    width: 150,
                    height: 18,
                    ...patch,
                }),
            ).toThrow();
        const floating = placeNativeField(original.document, original.fieldId, scene).document;
        expect(() => inlineNativeField(floating, original.fieldId, { blockId: 'missing', offset: 0 })).toThrow();
        expect(nativeFields(original.document)[0].floating).toBe(false);
        expect(nativeFields(floating)).toHaveLength(1);
    });
    it('inserts an atomic field with a database-compatible UUID and keeps surrounding text and marks', () => {
        const result = insert();
        expect(result.fieldId).toMatch(/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i);
        const field = nativeFields(result.document)[0];
        expect(field).toMatchObject({
            id: result.fieldId,
            blockId: 'p',
            offset: 4,
            floating: false,
            attributes: {
                id: result.fieldId,
                type: 'text',
                width: 200,
                height: 24,
                settings: { required: true, fontFamily: 'Arial', textAlign: 'center' },
            },
        });
        expect(blockText(findNode(result.document, 'p')!)).toBe('قبل \uFFFCبعد');
        expect(findNode(result.document, 'p')?.children?.[2].marks?.[0].kind).toBe('bold');
        expect(() => importDocument(exportDocument(result.document), 'fields')).not.toThrow();
    });

    it('uses the existing CLM defaults for dates and signing fields', () => {
        expect(nativeFields(insert('date').document)[0].attributes).toMatchObject({
            width: 92,
            settings: { calendarType: 'gregorian', dateFormat: 'dd/mm/yyyy' },
        });
        expect(nativeFields(insert('signature').document)[0].attributes).toMatchObject({
            width: 250,
            height: 80,
            settings: { required: true },
        });
    });

    it('merges setting changes, preserves unknown metadata and clears the previous participant value on reassignment', () => {
        const original = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'variable',
                                attrs: {
                                    id: 'field',
                                    name: 'Field',
                                    type: 'text',
                                    participant_id: '7',
                                    value: 'Previous participant',
                                    reference_id: 'REF',
                                    custom: { retained: true },
                                    settings: { options: ['One'], required: false, direction: 'ltr' },
                                },
                            },
                        ],
                    },
                ],
            },
            'fields',
        );
        const changed = updateNativeField(original, 'field', { name: 'Renamed', settings: { required: true } });
        expect(nativeFields(changed)[0].attributes).toMatchObject({
            reference_id: 'REF',
            custom: { retained: true },
            value: 'Previous participant',
            settings: { required: true, options: ['One'], direction: 'ltr' },
        });
        const reassigned = updateNativeField(changed, 'field', { participant_id: '9' });
        expect(nativeFields(reassigned)[0].attributes).toMatchObject({ participant_id: '9', value: '' });
        expect(
            nativeFields(updateNativeField(reassigned, 'field', { participant_id: '' }))[0].attributes.participant_id,
        ).toBe('');
    });

    it('does not create an author value for a field assigned to a participant', () => {
        const result = insertNativeField(
            source(),
            { blockId: 'p', from: 0, to: 0, expectedRevision: 0 },
            { type: 'text', name: 'Assigned', participant_id: '12', value: 'not an author value' },
        );
        expect(nativeFields(result.document)[0].attributes.value).toBe('');
    });

    it('edits and removes floating fields without dropping document metadata or neighboring fields', () => {
        const original = importDocument(
            {
                type: 'doc',
                attrs: {
                    brand: 'preserved',
                    blockVariables: [
                        {
                            id: 'one',
                            name: 'One',
                            type: 'signature',
                            x: 10,
                            y: 20,
                            width: 200,
                            height: 80,
                            settings: { required: true },
                        },
                        { id: 'two', name: 'Two', type: 'text', value: 'keep' },
                    ],
                },
                content: [{ type: 'paragraph' }],
            },
            'fields',
        );
        const changed = updateNativeField(original, 'one', { name: 'Signing field' });
        expect(nativeFields(changed)[0]).toMatchObject({
            floating: true,
            attributes: { name: 'Signing field', x: 10, y: 20 },
        });
        const removed = removeNativeField(changed, 'one').document;
        expect(nativeFields(removed).map((field) => field.id)).toEqual(['two']);
        expect(removed.root.attributes?.brand).toBe('preserved');
    });

    it('removes an inline field in one undo step', () => {
        const result = insert(),
            session = new DocumentSession(result.document);
        const removed = removeNativeField(session.document, result.fieldId);
        session.commit(removed.document);
        expect(blockText(findNode(session.document, 'p')!)).toBe('قبل بعد');
        session.undo();
        expect(nativeFields(session.document)).toHaveLength(1);
    });

    it('gives pasted fields fresh UUIDs while preserving their type, settings and participant', () => {
        const result = insert(),
            original = findNode(result.document, result.fieldId)!;
        const pasted = pasteBlocks(result.document, { blockId: 'p', from: 0, to: 0, expectedRevision: 1 }, [
            { id: 'fragment', kind: 'paragraph', children: [original] },
        ]);
        const fields = nativeFields(pasted.document);
        expect(fields).toHaveLength(2);
        expect(new Set(fields.map((field) => field.id)).size).toBe(2);
        expect(fields[0].id).toMatch(/^[\da-f-]{36}$/i);
        expect(fields[0].attributes.id).toBe(fields[0].id);
        expect(fields[0].attributes.settings).toEqual(fields[1].attributes.settings);
    });

    it('projects dates in the configured reading order and retains other field values', () => {
        expect(
            fieldDisplayValue({
                type: 'date',
                value: '2026-10-19',
                settings: { direction: 'ltr', dateFormat: 'dd/mm/yyyy' },
            }),
        ).toBe('19/10/2026');
        expect(
            fieldDisplayValue({
                type: 'date',
                value: '1448-05-08',
                settings: { direction: 'rtl', calendarType: 'hijri', dateFormat: 'dd/mm/yyyy' },
            }),
        ).toBe('1448/05/08');
        expect(fieldDisplayValue({ type: 'text', value: '0' })).toBe('0');
        expect(fieldDisplayValue({ type: 'attachment', name: 'Attachment name', value: 'private-media-id' })).toBe(
            'Attachment name',
        );
        expect(fieldDisplayValue({ type: 'signature', value: 'media-id' })).toBe('');
        expect(
            fieldStyle({
                type: 'text',
                settings: {
                    fontFamily: 'Amiri',
                    fontSize: '24px',
                    color: '#ff0000',
                    fontWeight: 'bold',
                    fontStyle: 'italic',
                    textDecoration: 'underline',
                },
            }),
        ).toMatchObject({ family: 'Amiri', size: 18, color: [1, 0, 0, 1], bold: true, italic: true, underline: true });
    });

    it('stamps authoritative page geometry for inline and floating fields without mutating history', () => {
        const result = insert(),
            attrs = nativeFields(result.document)[0].attributes;
        const scene: DocumentScene = {
            documentId: result.document.id,
            revision: result.document.revision,
            fontHash: 'font',
            margin: 54,
            glyphCount: 0,
            pages: [
                { width: 600, height: 800, lines: [], commands: [] },
                {
                    width: 600,
                    height: 800,
                    lines: [],
                    commands: [
                        {
                            kind: 'field',
                            nodeId: result.fieldId,
                            attributes: attrs,
                            x: 60,
                            y: 80,
                            width: 120,
                            height: 24,
                        },
                    ],
                },
            ],
        };
        const stamped = stampNativeFields(result.document, scene),
            field = nativeFields(stamped)[0];
        expect(field.attributes).toMatchObject({
            x: 80,
            width: 160,
            height: 32,
            settings: { page: 2, relativeXPct: 0.1, relativeYPct: 0.1, widthPct: 0.2, heightPct: 0.03 },
        });
        expect(field.attributes.y).toBeCloseTo((800 + 80) / 0.75 + 30, 8);
        expect(nativeFields(result.document)[0].attributes.x).toBe(0);
        expect(stamped.revision).toBe(result.document.revision);
        expect(() => stampNativeFields(result.document, { ...scene, revision: 9 })).toThrow('stale');
    });

    it('rejects stale revisions, malformed dimensions, invalid participants and partial grapheme selections', () => {
        const doc = importDocument(
            {
                type: 'doc',
                content: [{ type: 'paragraph', attrs: { id: 'p' }, content: [{ type: 'text', text: 'عَربي' }] }],
            },
            'fields',
        );
        const draft = { type: 'text' as const, name: 'Field' };
        expect(() => insertNativeField(doc, { blockId: 'p', from: 1, to: 1, expectedRevision: 0 }, draft)).toThrow(
            'grapheme',
        );
        expect(() => insertNativeField(doc, { blockId: 'p', from: 0, to: 0, expectedRevision: 1 }, draft)).toThrow(
            'conflict',
        );
        for (const patch of [
            { width: 0 },
            { height: NaN },
            { participant_id: 'another-workspace' },
            { name: 'x'.repeat(256) },
        ])
            expect(() =>
                insertNativeField(doc, { blockId: 'p', from: 0, to: 0, expectedRevision: 0 }, { ...draft, ...patch }),
            ).toThrow();
    });
});
