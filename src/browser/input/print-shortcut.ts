import { SurfaceShortcut } from './surface-shortcut.js';

export class PrintShortcut extends SurfaceShortcut {
    constructor(root: HTMLElement, print: () => void) {
        super(root, 'KeyP', print);
    }
}
