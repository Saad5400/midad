import type { DocumentScene } from '../layout/scene.js';
import type { PdfOverlayViewport } from './source-pages.js';

export function pdfSourceFieldBoxes(scene: DocumentScene, viewports: readonly PdfOverlayViewport[]) {
    const offset = scene.coverPages ?? 0;
    if (![0, 1].includes(offset) || viewports.length + offset !== scene.pages.length)
        throw new Error('The field layout does not match its PDF source');
    return scene.pages.flatMap((page, index) => {
        const viewport = index < offset ? undefined : viewports[index - offset];
        if (
            viewport &&
            (Math.abs(page.width - viewport.width) > 0.001 || Math.abs(page.height - viewport.height) > 0.001)
        )
            throw new Error('The field layout does not match its PDF source');
        const matrix = viewport ? overlayMatrix(viewport) : [1, 0, 0, 1, 0, 0];
        const rotation = viewport
            ? (Math.round((Math.atan2(viewport.transform[1], viewport.transform[0]) * 180) / Math.PI) + 360) % 360
            : 0;
        return page.commands.flatMap((command) => {
            if (command.kind !== 'field') return [];
            const rect = transformRectangle(
                {
                    x: command.x,
                    y: page.height - command.y - command.height,
                    width: command.width,
                    height: command.height,
                },
                matrix,
            );
            return [
                {
                    id: command.nodeId,
                    page: index + 1,
                    x: command.x,
                    y: command.y,
                    width: command.width,
                    height: command.height,
                    pdfBox: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
                    pdfRotation: rotation,
                },
            ];
        });
    });
}

export function overlayMatrix(viewport: PdfOverlayViewport): readonly number[] {
    if (
        viewport.transform.length !== 6 ||
        !viewport.transform.every(Number.isFinite) ||
        ![viewport.width, viewport.height].every((value) => Number.isFinite(value) && value > 0)
    )
        throw new Error('Invalid overlay transform');
    const [a, b, c, d, e, f] = viewport.transform;
    const determinant = a * d - b * c;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) throw new Error('Invalid overlay transform');
    return [
        d / determinant,
        -b / determinant,
        c / determinant,
        -a / determinant,
        (c * f - d * e - c * viewport.height) / determinant,
        (b * e - a * f + a * viewport.height) / determinant,
    ];
}

export function transformRectangle(
    rect: { x: number; y: number; width: number; height: number },
    matrix: readonly number[],
): { x: number; y: number; width: number; height: number } {
    if (
        matrix.length !== 6 ||
        !matrix.every(Number.isFinite) ||
        ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
        rect.width <= 0 ||
        rect.height <= 0
    )
        throw new Error('Invalid PDF field geometry');
    const [a, b, c, d, e, f] = matrix;
    const corners = [
        [rect.x, rect.y],
        [rect.x + rect.width, rect.y],
        [rect.x, rect.y + rect.height],
        [rect.x + rect.width, rect.y + rect.height],
    ];
    const xs = corners.map(([x, y]) => a * x + c * y + e),
        ys = corners.map(([x, y]) => b * x + d * y + f);
    const x = Math.min(...xs),
        y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
