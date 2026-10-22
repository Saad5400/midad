import { describe, expect, it } from 'vitest';
import { insertCapabilities } from '@saad5400/midad/content/capabilities';
describe('embedded insertion capabilities', () => {
    it('preserves default full-document and text-only modes', () => {
        expect(Object.values(insertCapabilities()).every(Boolean)).toBe(true);
        expect(Object.values(insertCapabilities({}, true)).some(Boolean)).toBe(false);
    });
    it('can enable rich tables without fields or images', () => {
        const capabilities = insertCapabilities({ tables: true }, true);
        expect(capabilities).toEqual({ tables: true, fields: false, images: false, clauses: false, bilingual: false });
        expect(Object.isFrozen(capabilities)).toBe(true);
    });
});
