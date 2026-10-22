import type { ScenePage } from '../../layout/scene.js';
export function fragmentPageHeight(page: ScenePage, scale: number, minimum = 150, padding = 24): number {
    if (![scale, minimum, padding].every(Number.isFinite) || scale <= 0 || minimum < 0 || padding < 0)
        throw new Error('Invalid fragment view dimensions');
    let bottom = Math.max(0, ...page.lines.map((line) => line.top + line.height));
    for (const command of page.commands) {
        if (command.kind === 'line') bottom = Math.max(bottom, command.y, command.toY);
        else if ('height' in command && command.kind !== 'clipStart')
            bottom = Math.max(bottom, command.y + command.height);
    }
    return Math.ceil(Math.min(page.height, Math.max(minimum, bottom + padding)) * scale);
}
