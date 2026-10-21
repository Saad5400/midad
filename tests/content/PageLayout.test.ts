import { exportDocument, importDocument } from '@saad5400/midad/document';
import {
    documentPageLayout,
    MARGIN_PRESETS,
    pageSize,
    setDocumentPageLayout,
} from '@saad5400/midad/content/page-layout';
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
