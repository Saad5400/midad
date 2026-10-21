import type { NativeDocument } from '../document/model.js';
import type { NativeTextKernel } from '../rendering/kernel.js';
import { createDocumentScene } from './pages.js';
import type { DocumentScene } from './scene.js';

export function layoutDocument(
    document: NativeDocument,
    kernel: NativeTextKernel,
    surfaceWidth?: number,
): DocumentScene {
    return createDocumentScene(document, kernel, surfaceWidth);
}
