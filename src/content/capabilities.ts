export interface InsertCapabilities {
    readonly fields: boolean;
    readonly images: boolean;
    readonly tables: boolean;
    readonly clauses: boolean;
    readonly bilingual: boolean;
}
export function insertCapabilities(overrides: Partial<InsertCapabilities> = {}, textOnly = false): InsertCapabilities {
    return Object.freeze({
        fields: !textOnly,
        images: !textOnly,
        tables: !textOnly,
        clauses: !textOnly,
        bilingual: !textOnly,
        ...overrides,
    });
}
