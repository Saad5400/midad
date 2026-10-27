import { importDocument } from '../../document/codec.js';
import type { NativeNode } from '../../document/model.js';
import { blockTextStyle, documentTextStyle, nodeTextStyle, type TextStyle } from '../../typography/style.js';
import { limit, type NativeFragment } from './model.js';

export function parseNativeFragment(source: string): NativeFragment {
    if (source.length > limit) throw new Error('The clipboard content is too large');
    const value = JSON.parse(source);
    if (value?.version !== 1 || !value.content) throw new Error('Unsupported clipboard format');
    let count = 0;
    const check = (node: { content?: unknown[] }, depth: number): void => {
        if (++count > 10000 || depth > 64 || !node || typeof node !== 'object')
            throw new Error('The clipboard structure is too large');
        if (Array.isArray(node.content)) node.content.forEach((child) => check(child as typeof node, depth + 1));
    };
    check(value.content, 0);
    const document = importDocument(value.content, 'clipboard');
    const blocks = document.root.children ?? [];
    if (!document.root.attributes?.typography) return { blocks };
    const inherit = (node: NativeNode, style: TextStyle): NativeNode => {
        if (node.kind === 'text') {
            const family = nodeTextStyle(node, style).family;
            if (nodeTextStyle(node).family === family) return node;
            return {
                ...node,
                marks: [...(node.marks ?? []), { kind: 'textStyle', attributes: { fontFamily: family } }],
            };
        }
        return node.children
            ? {
                  ...node,
                  children: node.children.map((child) => inherit(child, blockTextStyle(node, style))),
              }
            : node;
    };
    const style = documentTextStyle(document);
    return { blocks: blocks.map((node) => inherit(node, style)) };
}

export function plainTextFragment(text: string): NativeFragment {
    if (text.length > limit) throw new Error('The clipboard content is too large');
    if (!text) return { blocks: [], plain: true };
    return {
        plain: true,
        blocks: text
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map((text, index) => ({
                id: `clipboard:p:${index}`,
                kind: 'paragraph',
                children: text ? [{ id: `clipboard:t:${index}`, kind: 'text', text }] : [],
            })),
    };
}
