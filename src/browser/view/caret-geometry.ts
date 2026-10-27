import type { TextCaret } from '../../editing/text.js';
import type { CaretAffinity, NativeNavigation } from '../input/navigation.js';
import type { OverlayCaret, OverlayPoint } from './editing-overlay.js';

export function caretViewportRect(
    navigation: NativeNavigation | undefined,
    target: TextCaret,
    pageOrigin: (pageIndex: number) => OverlayPoint | undefined,
    scale: number,
    affinity: CaretAffinity = 'downstream',
): OverlayCaret | null {
    if (!navigation || !Number.isFinite(scale) || scale <= 0) return null;
    const position = navigation.caret(target, affinity);
    if (!position) return null;
    const { row } = position;
    const origin = pageOrigin(row.pageIndex);
    if (!origin) return null;
    return {
        left: origin.left + ((row.placement.left ?? navigation.scene.margin) + position.x) * scale,
        top: origin.top + (row.placement.top + position.top - row.placement.originalTop) * scale,
        height: Math.max(2, (position.bottom - position.top) * scale),
    };
}
