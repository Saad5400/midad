import type { FieldBounds } from '../content/fields/geometry.js';
import type { Attributes } from '../document/model.js';
import type { ScenePage } from './scene.js';

export interface ObjectRegion extends FieldBounds {
    readonly nodeId: string;
    readonly attributes: Attributes;
    readonly kind: 'field' | 'image';
    readonly visible: FieldBounds;
}
function intersect(a: FieldBounds, b: FieldBounds): FieldBounds {
    const x = Math.max(a.x, b.x),
        y = Math.max(a.y, b.y);
    return {
        x,
        y,
        width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
        height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
    };
}
export function objectRegions(page: ScenePage, includeImages = true): readonly ObjectRegion[] {
    const clips: FieldBounds[] = [{ x: 0, y: 0, width: page.width, height: page.height }],
        result: ObjectRegion[] = [];
    for (const command of page.commands) {
        if (command.kind === 'clipStart') clips.push(intersect(clips.at(-1)!, command));
        else if (command.kind === 'clipEnd') {
            if (clips.length > 1) clips.pop();
        } else if (
            (command.kind === 'field' || (includeImages && command.kind === 'image')) &&
            command.nodeId &&
            command.attributes
        ) {
            const visible = intersect(clips.at(-1)!, command);
            if (visible.width > 0 && visible.height > 0)
                result.push(
                    Object.freeze({
                        ...command,
                        nodeId: command.nodeId,
                        attributes: command.attributes,
                        visible: Object.freeze(visible),
                    }),
                );
        }
    }
    return Object.freeze(result);
}
