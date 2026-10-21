// @vitest-environment node
import { DocumentSession, exportDocument, importDocument } from '@saad5400/midad';
import { getDefaultVariableSettings } from '@saad5400/midad/field-schema';
import { fontAssets } from '@saad5400/midad/font-assets';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('standalone package entrypoints', () => {
    it('edits stored document content through its public API without a CLM loader', () => {
        const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'عقد ABC' }] }] };
        const document = importDocument(content, 'standalone');
        const session = new DocumentSession(document);
        expect(exportDocument(session.document)).toMatchObject(content);
        expect(getDefaultVariableSettings('date')).toMatchObject({ calendarType: 'gregorian', required: true });
    });
    it('resolves every bundled font as an installed package asset', async () => {
        expect(Object.keys(fontAssets).length).toBeGreaterThan(40);
        for (const url of Object.values(fontAssets)) {
            const bytes = await readFile(new URL(url));
            expect(bytes.length).toBeGreaterThan(1000);
        }
    });
});
