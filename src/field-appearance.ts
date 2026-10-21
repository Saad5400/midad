import type { Attributes } from './document.js';
import { fieldPaintCommands } from './field-layout.js';
import type { NativeTextKernel, ShapedParagraph } from './kernel.js';
import type { FieldCommand, ScenePage } from './layout.js';

export interface FrozenFieldBox {
    readonly id: string;
    readonly page: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
export interface FieldAppearance {
    readonly field: FrozenFieldBox;
    readonly page: ScenePage;
}

export function fieldAppearancePage(
    id: string,
    attributes: Attributes,
    width: number,
    height: number,
    kernel: NativeTextKernel,
    used: Set<ShapedParagraph>,
): ScenePage {
    if (![width, height].every((size) => Number.isFinite(size) && size > 0 && size <= 3000))
        throw new Error('Invalid field appearance dimensions');
    const field: FieldCommand = { kind: 'field', nodeId: id, attributes, x: 0, y: 0, width, height };
    return {
        width,
        height,
        lines: [],
        commands: fieldPaintCommands(field, kernel, used).filter((command) => command.kind !== 'field'),
    };
}
