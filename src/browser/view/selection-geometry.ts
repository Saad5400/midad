import type { CanvasKit } from 'canvaskit-wasm';
import type { NativeDocument } from '../../document/model.js';
import { selectionRanges, type NativeSelection } from '../../editing/selection.js';
import type { DocumentScene } from '../../layout/scene.js';
import type { OverlayPoint, OverlayRect } from './editing-overlay.js';
import { searchRectangles } from './search.js';

export function selectionViewportRectangles(
    document: NativeDocument,
    scene: DocumentScene,
    selected: NativeSelection,
    options: {
        canvasKit: CanvasKit;
        scale: number;
        pageOrigin: (pageIndex: number) => OverlayPoint | undefined;
        pages?: ReadonlySet<number>;
    },
): OverlayRect[] {
    if (!Number.isFinite(options.scale) || options.scale <= 0) return [];
    const origins = new Map<number, OverlayPoint | undefined>();
    return searchRectangles(scene, selectionRanges(document, selected), options.canvasKit, options.pages).flatMap(
        (box) => {
            if (!origins.has(box.pageIndex)) origins.set(box.pageIndex, options.pageOrigin(box.pageIndex));
            const origin = origins.get(box.pageIndex);
            return origin
                ? [
                      {
                          left: origin.left + box.x * options.scale,
                          top: origin.top + box.y * options.scale,
                          width: box.width * options.scale,
                          height: box.height * options.scale,
                      },
                  ]
                : [];
        },
    );
}
