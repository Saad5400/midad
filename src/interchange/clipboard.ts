import { exportDocument } from '../document/codec.js';
import type { NativeDocument } from '../document/model.js';
import type { NativeSelection } from '../editing/selection.js';
import { inheritedDirection } from '../typography/direction.js';
import { documentTextStyle } from '../typography/style.js';
import { fragmentHtml } from './clipboard/html-writer.js';
import { parseHtmlFragment } from './clipboard/html-reader.js';
import { parseNativeFragment, plainTextFragment } from './clipboard/native-format.js';
import {
    NATIVE_CLIPBOARD_TYPE,
    NATIVE_WEB_CLIPBOARD_TYPE,
    type ClipboardPayload,
    type NativeFragment,
} from './clipboard/model.js';
import { selectionFragment, fragmentText } from './clipboard/selection.js';

export { NATIVE_CLIPBOARD_TYPE, NATIVE_WEB_CLIPBOARD_TYPE } from './clipboard/model.js';
export type { ClipboardPayload, NativeFragment } from './clipboard/model.js';
export { selectionFragment } from './clipboard/selection.js';
export { fragmentHtml } from './clipboard/html-writer.js';
export { parseHtmlFragment } from './clipboard/html-reader.js';
export { parseNativeFragment, plainTextFragment } from './clipboard/native-format.js';
export { pasteFragment } from './clipboard/paste.js';

export function clipboardPayload(document: NativeDocument, selection: NativeSelection): ClipboardPayload {
    const fragment = selectionFragment(document, selection);
    const content = exportDocument({
        ...document,
        root: {
            id: 'clipboard',
            kind: 'doc',
            ...(document.root.attributes?.typography
                ? { attributes: { typography: document.root.attributes.typography } }
                : {}),
            children: fragment.blocks,
        },
    });
    return {
        native: JSON.stringify({ version: 1, content }),
        html: fragmentHtml(fragment, inheritedDirection(document.root, 'rtl'), true, documentTextStyle(document)),
        text: fragmentText(fragment),
    };
}

export function readClipboard(get: (type: string) => string, plain = false): NativeFragment {
    if (!plain) {
        const native = get(NATIVE_CLIPBOARD_TYPE) || get(NATIVE_WEB_CLIPBOARD_TYPE);
        if (native) {
            try {
                return parseNativeFragment(native);
            } catch {
                /* Fall back to standard clipboard formats. */
            }
        }
        const html = get('text/html');
        if (html) {
            const fragment = parseHtmlFragment(html);
            if (fragment.blocks.length) return fragment;
        }
    }
    return plainTextFragment(get('text/plain'));
}
