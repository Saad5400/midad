import type { NativeNode } from '../document/model.js';
import type { NativeTextKernel, ShapedParagraph } from '../rendering/kernel.js';
import { inheritedDirection } from '../typography/direction.js';
import type { Band } from './bands.js';

export interface LayoutContext {
    used: Set<ShapedParagraph>;
    kernel: NativeTextKernel;
    numbers: ReadonlyMap<string, number>;
    direction: 'ltr' | 'rtl';
    measured: Set<NativeNode>;
    availableHeight: number;
    tableDepth?: number;
}
export type MeasureBlocks = (
    nodes: readonly NativeNode[],
    width: number,
    context: LayoutContext,
    ensureLine?: boolean,
) => Band[];

export function scope(node: NativeNode, parent: LayoutContext): LayoutContext {
    return {
        ...parent,
        direction: inheritedDirection(node, parent.direction),
    };
}
