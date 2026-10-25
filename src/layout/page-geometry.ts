import { pageLayoutForPage, pageSize } from '../content/page-layout-queries.js';
import type { NativeDocument } from '../document/model.js';
import { point } from '../typography/metrics.js';

export interface PageGeometry {
    readonly width: number;
    readonly height: number;
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
    readonly area: number;
    readonly availableHeight: number;
}
export function pageGeometry(document: NativeDocument, pageNumber: number, surfaceWidth?: number): PageGeometry {
    const layout = pageLayoutForPage(document, pageNumber),
        size = pageSize(layout.orientation, layout.size);
    const width = point(surfaceWidth ?? size.width),
        height = point(size.height);
    if (!Number.isFinite(width) || width < 72 || width > 14400) throw new Error('Invalid layout surface width');
    const [left, right, top, bottom] = ['left', 'right', 'top', 'bottom'].map(
        (side) => layout.margins[side as keyof typeof layout.margins] * 0.75,
    );
    const area = point(width - left - right),
        availableHeight = point(height - top - bottom);
    if (area < 36 || availableHeight < 36) throw new Error('Page margins leave no writable area');
    return { width, height, left, right, top, bottom, area, availableHeight };
}
