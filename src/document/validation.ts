import type { NativeDocument } from './model.js';

export class DocumentEditError extends Error {
    constructor(
        readonly code: 'INVALID_DOCUMENT_EDIT' | 'STALE_DOCUMENT_EDIT',
        cause?: unknown,
    ) {
        super(
            code === 'STALE_DOCUMENT_EDIT'
                ? 'The document changed while preparing this edit'
                : 'The edit could not be prepared',
            { cause },
        );
    }
}

export async function applyDocumentEdit<Prepared, Result>(
    candidate: NativeDocument,
    current: () => NativeDocument,
    prepare: (document: NativeDocument) => Prepared | Promise<Prepared>,
    apply: (prepared: Prepared) => Result,
    release?: (prepared: Prepared) => void,
): Promise<Result> {
    const base = current();
    if (candidate.id !== base.id || candidate.revision !== base.revision + 1)
        throw new DocumentEditError('STALE_DOCUMENT_EDIT');
    let prepared: Prepared;
    try {
        prepared = await prepare(candidate);
    } catch (cause) {
        throw new DocumentEditError('INVALID_DOCUMENT_EDIT', cause);
    }
    try {
        if (current() !== base) throw new DocumentEditError('STALE_DOCUMENT_EDIT');
        return apply(prepared);
    } finally {
        release?.(prepared);
    }
}
