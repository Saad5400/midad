import type { NativeNode } from '../document/model.js';
import type { NativeTextKernel } from '../rendering/kernel.js';
import type { ShapedParagraph } from '../rendering/text/model.js';
import { inheritedDirection } from '../typography/direction.js';
import type { TextStyle } from '../typography/style.js';
import type { Band } from './bands.js';

export interface TextContinuation {
    readonly from: number;
    readonly byteFrom: number;
    readonly nodeOffsets: ReadonlyMap<string, number>;
}

export interface LayoutContext {
    tableColumns?: ReadonlyMap<string, number>;
    fragments?: ReadonlyMap<string, TextContinuation>;
    completed?: ReadonlySet<string>;
    listStarts?: ReadonlyMap<string, string>;
    listNumbers?: ReadonlyMap<string, number>;
    used: Set<ShapedParagraph>;
    kernel: NativeTextKernel;
    fontHash: string;
    numbers: ReadonlyMap<string, number>;
    direction: 'ltr' | 'rtl';
    measured: Set<NativeNode>;
    availableHeight: number;
    tableDepth?: number;
    defaultStyle?: TextStyle;
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
