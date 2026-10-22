import type { NativeNode } from '../../document/model.js';

export const NATIVE_CLIPBOARD_TYPE = 'application/x-clm-native-fragment+json';
export const NATIVE_WEB_CLIPBOARD_TYPE = `web ${NATIVE_CLIPBOARD_TYPE}`;
export interface NativeFragment {
    readonly blocks: readonly NativeNode[];
    readonly plain?: boolean;
}
export interface ClipboardPayload {
    readonly native: string;
    readonly html: string;
    readonly text: string;
}
export const textKinds = new Set(['paragraph', 'heading', 'clauseTitle', 'codeBlock']);
export const limit = 2_000_000;
export const customBlocks = new Set([
    'clause',
    'clauseTitle',
    'clauseBody',
    'parallelRow',
    'parallelCell',
    'tableRowGroup',
]);
