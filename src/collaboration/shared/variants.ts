import { importDocument } from '../../document/codec.js';
import { persistNativeIdentities } from '../../document/identities.js';
import { isRecord, type Json, type NativeNode } from '../../document/model.js';

export function variantScope(scope: string, clause: string, variant: string): string {
    return JSON.stringify([scope, clause, variant]);
}
export function variantBody(value: Json, id: string): NativeNode {
    const content =
        isRecord(value) && value.type === 'clauseBody'
            ? value
            : {
                  type: 'clauseBody',
                  content:
                      isRecord(value) && value.type === 'doc'
                          ? (value.content ?? [])
                          : Array.isArray(value)
                            ? value
                            : [{ type: 'paragraph' }],
              };
    return persistNativeIdentities(importDocument({ type: 'doc', content: [content] }, id)).root.children![0];
}
