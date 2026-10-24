import type { NativeNode } from '../document/model.js';
import type { NativeTextKernel } from '../rendering/kernel.js';
import type { ShapedParagraph } from '../rendering/text/model.js';
import { inheritedDirection } from '../typography/direction.js';
import type { Band } from './bands.js';

export interface LayoutContext {
    used: Set<ShapedParagraph>;
    kernel: NativeTextKernel;
    fontHash: string;
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
