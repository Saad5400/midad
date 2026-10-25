import { SharedNativeDocument } from '@saad5400/midad/collaboration';
import {
    clearPageLayout,
    documentPageLayout,
    MARGIN_PRESETS,
    pageLayoutForPage,
    pageLayoutOverride,
    pageSize,
    setDocumentPageLayout,
    setPageLayout,
} from '@saad5400/midad/content/page-layout';
import { exportDocument, importDocument } from '@saad5400/midad/document';
import { describe, expect, it } from 'vitest';

describe('native page setup', () => {
    const create = () =>
        importDocument(
            {
                type: 'doc',
                attrs: { untouched: ['metadata'], pageLayout: { extra: 'preserve' } },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'العقد' }] }],
            },
            'contract',
        );
    it('uses the original CLM default margins and physical A4 dimensions', () => {
        expect(documentPageLayout(create())).toEqual({ orientation: 'portrait', margins: MARGIN_PRESETS.normal });
        expect(pageSize('portrait').width).toBeCloseTo(595.27559);
        expect(pageSize('landscape')).toEqual({
            width: pageSize('portrait').height,
            height: pageSize('portrait').width,
        });
    });
    it('changes only page settings, preserves metadata and leaves the original revision intact', () => {
        const source = create();
        const layout = { orientation: 'landscape' as const, margins: MARGIN_PRESETS.wide };
        const changed = setDocumentPageLayout(source, layout);
        expect(changed.revision).toBe(1);
        expect(source.revision).toBe(0);
        expect(changed.root.children).toBe(source.root.children);
        expect(exportDocument(changed)).toMatchObject({
            attrs: { untouched: ['metadata'], pageLayout: { extra: 'preserve', ...layout } },
        });
        expect(setDocumentPageLayout(changed, layout)).toBe(changed);
    });
    it.each([NaN, Infinity, 0, 37, 201])('rejects an invalid authored margin %s', (left) => {
        expect(() =>
            setDocumentPageLayout(create(), { orientation: 'portrait', margins: { ...MARGIN_PRESETS.normal, left } }),
        ).toThrow('Invalid page margins');
    });
});

describe('independent physical page settings', () => {
    it('inherits document defaults and keeps sparse overrides independent of later defaults', () => {
        const original = importDocument({ type: 'doc' }, 'pages');
        const page = setPageLayout(original, 2, {
            orientation: 'landscape',
            size: 'letter',
            margins: { left: 48 },
            background: { color: '#eaf4ff' },
            footer: false,
        });
        expect(pageLayoutForPage(page, 1)).toEqual(documentPageLayout(page));
        expect(pageLayoutForPage(page, 2)).toMatchObject({
            orientation: 'landscape',
            size: 'letter',
            margins: { ...MARGIN_PRESETS.normal, left: 48 },
            footer: false,
        });
        const updated = setDocumentPageLayout(page, {
            orientation: 'portrait',
            margins: MARGIN_PRESETS.narrow,
            background: { color: '#ffffff' },
            header: true,
        });
        expect(pageLayoutForPage(updated, 2)).toMatchObject({
            orientation: 'landscape',
            size: 'letter',
            margins: MARGIN_PRESETS.narrow,
            background: { color: '#eaf4ff' },
            header: true,
            footer: false,
        });
        expect(pageLayoutOverride(updated, 2)?.margins).toEqual({ left: 48 });
        expect(pageLayoutOverride(original, 2)).toBeUndefined();
        expect(pageSize('landscape', 'letter')).toEqual({ width: 792, height: 612 });
    });
    it('merges page patches, preserves metadata, clears to inheritance and round-trips through JSON', () => {
        const original = importDocument({ type: 'doc', attrs: { pageLayout: { extra: 'preserve' } } }, 'pages');
        const first = setPageLayout(original, 3, { orientation: 'landscape', margins: { top: 48 } });
        const second = setPageLayout(first, 3, {
            background: { src: '/owned-image', fit: 'contain' },
            margins: { left: 72 },
        });
        expect(pageLayoutOverride(second, 3)).toEqual({
            orientation: 'landscape',
            margins: { top: 48, left: 72 },
            background: { src: '/owned-image', fit: 'contain' },
        });
        const decoded = importDocument(exportDocument(second), 'pages');
        expect(pageLayoutForPage(decoded, 3)).toEqual(pageLayoutForPage(second, 3));
        expect(exportDocument(decoded)).toMatchObject({ attrs: { pageLayout: { extra: 'preserve' } } });
        const cleared = clearPageLayout(decoded, 3);
        expect(pageLayoutOverride(cleared, 3)).toBeUndefined();
        expect(exportDocument(cleared)).toMatchObject({ attrs: { pageLayout: { extra: 'preserve' } } });
        expect(clearPageLayout(cleared, 3)).toBe(cleared);
        expect(setPageLayout(original, 2, {})).toBe(original);
        expect(setPageLayout(original, 2, { margins: {} })).toBe(original);
        expect(setPageLayout(second, 3, { margins: { left: 72 } })).toBe(second);
    });
    it('uses named and custom physical paper sizes without losing orientation', () => {
        const original = importDocument({ type: 'doc' }, 'pages');
        const changed = setDocumentPageLayout(original, {
            orientation: 'landscape',
            size: { width: 500, height: 800 },
            margins: MARGIN_PRESETS.normal,
        });
        expect(pageSize('landscape', documentPageLayout(changed).size)).toEqual({ width: 800, height: 500 });
        expect(setDocumentPageLayout(changed, documentPageLayout(changed))).toBe(changed);
        expect(pageSize('portrait', 'legal')).toEqual({ width: 612, height: 1008 });
        expect(pageSize('portrait', 'a5').width).toBeCloseTo(419.527559);
    });
    it('can remove a document background on one page without removing other overrides', () => {
        const original = setDocumentPageLayout(importDocument({ type: 'doc' }, 'pages'), {
            orientation: 'portrait',
            margins: MARGIN_PRESETS.normal,
            background: { color: 'blue' },
        });
        const changed = setPageLayout(original, 2, { background: null });
        expect(pageLayoutForPage(changed, 1).background).toEqual({ color: 'blue' });
        expect(pageLayoutForPage(changed, 2).background).toBeNull();
    });
    it.each([0, -1, 1.5, NaN, Infinity, 10001])('rejects invalid physical page %s', (page) => {
        expect(() => setPageLayout(importDocument({ type: 'doc' }, 'pages'), page, {})).toThrow('Invalid page number');
    });
    it.each([
        { size: 'unknown' },
        { size: { width: 0, height: 800 } },
        { background: { color: 'not-a-color' } },
        { background: { src: '' } },
        { background: { fit: 'invalid' } },
        { header: 'yes' },
        { margins: { left: 0 } },
    ])('rejects invalid page settings %j', (patch) => {
        expect(() => setPageLayout(importDocument({ type: 'doc' }, 'pages'), 2, patch as never)).toThrow();
    });
});

it.each([false, true])(
    'merges separate page settings and undo preserves a peer page configuration (reverse IDs: %s)',
    (reverse) => {
        const a = SharedNativeDocument.create(importDocument({ type: 'doc' }, 'shared-pages'));
        const b = SharedNativeDocument.fromState(a.state(), a.document().id);
        const client = a.ydoc.clientID;
        a.ydoc.clientID = (client + (reverse ? 2 : 1)) >>> 0;
        b.ydoc.clientID = (client + (reverse ? 1 : 2)) >>> 0;
        try {
            a.publish(setPageLayout(a.document(), 2, { orientation: 'landscape', size: 'letter' }));
            b.publish(setPageLayout(b.document(), 3, { background: { color: '#fafafa' }, footer: false }));
            a.receive(b.state(a.vector()));
            b.receive(a.state(b.vector()));
            expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
            expect(pageLayoutForPage(a.document(), 2).orientation).toBe('landscape');
            expect(pageLayoutForPage(a.document(), 3).footer).toBe(false);
            a.undo();
            b.receive(a.state(b.vector()));
            expect(pageLayoutOverride(a.document(), 2)).toBeUndefined();
            expect(pageLayoutForPage(a.document(), 3).footer).toBe(false);
            expect(exportDocument(a.document())).toEqual(exportDocument(b.document()));
            a.redo();
            expect(pageLayoutForPage(a.document(), 2).orientation).toBe('landscape');
        } finally {
            a.destroy();
            b.destroy();
        }
    },
);
