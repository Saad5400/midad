export interface GutterRect {
    left: number;
    right: number;
    top: number;
    bottom: number;
}
export function blockGutterPosition(block: GutterRect, bounds: GutterRect, direction: 'rtl' | 'ltr', lineHeight = 24) {
    const gap = 6,
        room = direction === 'rtl' ? bounds.right - block.right : block.left - bounds.left;
    const vertical = room < 62 && room >= 36,
        above = room < 36;
    const width = vertical ? 30 : 56,
        height = vertical ? 52 : 28;
    const x = above
        ? direction === 'rtl'
            ? block.right - width
            : block.left
        : direction === 'rtl'
          ? block.right + gap
          : block.left - width - gap;
    const stacked = block.top - height - gap < bounds.top ? block.bottom + gap : block.top - height - gap;
    const y = above ? stacked : block.top + (Math.min(lineHeight, block.bottom - block.top) - 28) / 2;
    const top = Math.max(bounds.top, Math.min(y, bounds.bottom - height));
    return {
        left: Math.max(bounds.left, Math.min(x, bounds.right - width)),
        top,
        width,
        height,
        vertical,
        visible:
            bounds.right - bounds.left >= width &&
            bounds.bottom - bounds.top >= height &&
            block.bottom > bounds.top &&
            block.top < bounds.bottom &&
            block.right > bounds.left &&
            block.left < bounds.right &&
            !(above && top + height > block.top && top < block.bottom),
    };
}

export function columnGutterSide<T extends { id: string; x: number; width: number }>(
    columns: readonly T[],
    id: string,
    fallback: 'rtl' | 'ltr',
) {
    const column = columns.find((column) => column.id === id);
    if (!column) return { direction: fallback, column: undefined };
    const left = column.x <= Math.min(...columns.map((column) => column.x)) + 0.001;
    const right = column.x + column.width >= Math.max(...columns.map((column) => column.x + column.width)) - 0.001;
    return {
        direction: left ? ('ltr' as const) : right ? ('rtl' as const) : fallback,
        column: left || right ? column : undefined,
    };
}
