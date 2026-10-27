import { Window } from 'happy-dom';
import { randomUUID } from 'node:crypto';
import type { NativeNode } from '../../document/index.js';
import { exportDocument, importDocument } from '../../document/index.js';
import { parseHtmlFragment } from '../../interchange/index.js';

const dom = new Window({
    settings: {
        enableJavaScriptEvaluation: false,
        disableJavaScriptFileLoading: true,
        disableCSSFileLoading: true,
        disableIframePageLoading: true,
    },
});

export function importHtmlContent(input: unknown) {
    if (!input || typeof input !== 'object' || !('html' in input)) throw new Error('Missing HTML content');
    if (typeof input?.html !== 'string') throw new Error('Invalid document HTML');
    const previous = globalThis.document;
    globalThis.document = dom.document as unknown as Document;
    try {
        const fragment = parseHtmlFragment(input.html);
        const identity = (node: NativeNode): NativeNode => ({
            ...node,
            id: randomUUID(),
            ...(node.children ? { children: node.children.map(identity) } : {}),
        });
        const document = importDocument({ type: 'doc', content: [] }, randomUUID());
        return {
            content: exportDocument({
                ...document,
                root: {
                    ...document.root,
                    children: fragment.blocks.length
                        ? fragment.blocks.map(identity)
                        : [{ id: randomUUID(), kind: 'paragraph' }],
                },
            }),
        };
    } finally {
        if (previous === undefined) delete (globalThis as { document?: Document }).document;
        else globalThis.document = previous;
    }
}
