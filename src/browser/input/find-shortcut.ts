import { SurfaceShortcut } from './surface-shortcut.js';

export class FindShortcut extends SurfaceShortcut {
    constructor(root: HTMLElement, find: () => void, enabled?: () => boolean) {
        super(root, 'KeyF', find, enabled);
    }
}
