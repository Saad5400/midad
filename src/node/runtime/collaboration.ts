import { createHash } from 'node:crypto';
import { SharedNativeDocument } from '../../collaboration/document.js';
import { decodeSharedBytes, encodeSharedBytes } from '../../collaboration/values.js';
import { initializeDocumentTypography } from '../../content/typography.js';
import type { NativeNode } from '../../document/index.js';
import { exportDocument, importDocument } from '../../document/index.js';
import { NATIVE_RENDERER_VERSION } from '../../rendering/version.js';

export interface CollaborationInput {
    id: string;
    content?: unknown;
    state?: string;
    update?: string;
    vector?: string;
    includeContent?: boolean;
    initializeTypography?: boolean;
}
export function applyCollaboration(input: CollaborationInput, identity = NATIVE_RENDERER_VERSION): unknown {
    if (typeof input.id !== 'string' || !input.id || input.id.length > 255)
        throw new Error('Invalid shared document identity');
    const initial = input.state ? undefined : importDocument(input.content, input.id);
    const shared = input.state
        ? SharedNativeDocument.fromState(decodeSharedBytes(input.state), input.id)
        : SharedNativeDocument.create(input.initializeTypography ? initializeDocumentTypography(initial!) : initial!);
    try {
        const structure = (node: NativeNode, unorderedRoot = false): unknown => ({
            id: node.id,
            kind: node.kind,
            variant: node.kind === 'clause' ? node.attributes?.activeVariantId : undefined,
            children: node.children
                ?.filter((child) => child.kind !== 'text')
                .toSorted((a, b) => (unorderedRoot ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : 0))
                .map((child) => structure(child)),
            floating:
                node.kind === 'doc'
                    ? [node.attributes?.blockVariables, node.attributes?.floatingImages].map((value) =>
                          Array.isArray(value)
                              ? value.map((entry) =>
                                    entry && typeof entry === 'object' && 'id' in entry ? entry.id : null,
                                )
                              : [],
                      )
                    : undefined,
        });
        const fingerprint = (unorderedRoot = false) =>
            createHash('sha256')
                .update(JSON.stringify(structure(shared.document().root, unorderedRoot)))
                .digest('hex');
        const beforeStructure = fingerprint();
        const beforeMembership = fingerprint(true);
        if (input.update) shared.receive(decodeSharedBytes(input.update));
        if (input.state && input.content) shared.publish(importDocument(input.content, input.id));
        const document = shared.document();
        shared.publish({
            ...document,
            revision: document.revision + 1,
            root: {
                ...document.root,
                attributes: {
                    ...document.root.attributes,
                    nativeEditor: {
                        schema: 1,
                        renderer: identity,
                        ...(document.root.children?.some((node) => node.kind === 'pdfPage') ? { surface: 'pdf' } : {}),
                    },
                },
            },
        });
        const afterStructure = fingerprint();
        return {
            renderer: identity,
            structureChanged: afterStructure !== beforeStructure,
            reorderOnly: afterStructure !== beforeStructure && fingerprint(true) === beforeMembership,
            epoch: shared.epoch(),
            state: encodeSharedBytes(shared.state()),
            vector: encodeSharedBytes(shared.vector()),
            update: encodeSharedBytes(shared.state(input.vector ? decodeSharedBytes(input.vector, 65536) : undefined)),
            ...(input.includeContent ? { content: exportDocument(shared.document()) } : {}),
        };
    } finally {
        shared.destroy();
    }
}
