export const VIEW_ZOOM_MIN = 0.1;
export const VIEW_ZOOM_MAX = 4;
export const POINT_TO_PIXEL = 96 / 72;
export function viewZoom(
    mode: string,
    page: { width: number; height: number },
    viewport: { width: number; height: number },
): number {
    const width = viewport.width / (page.width * POINT_TO_PIXEL);
    const height = viewport.height / (page.height * POINT_TO_PIXEL);
    const value =
        mode === 'auto'
            ? Math.min(1, width)
            : mode === 'width'
              ? width
              : mode === 'page'
                ? Math.min(width, height)
                : Number(mode) / 100;
    return Number.isFinite(value) ? Math.max(VIEW_ZOOM_MIN, Math.min(VIEW_ZOOM_MAX, value)) : 1;
}
