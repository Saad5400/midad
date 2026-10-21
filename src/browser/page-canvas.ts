import type { Surface } from 'canvaskit-wasm';
import type { ScenePage } from '../layout/scene.js';
import { paintPage } from '../rendering/canvas.js';
import type { NativeTextKernel } from '../rendering/kernel.js';

export interface PageCanvasTarget {
    readonly canvas: HTMLCanvasElement;
    readonly kernel: NativeTextKernel;
    readonly page: ScenePage;
    readonly revision: number;
    readonly scale: number;
    readonly pixelRatio?: number;
}

export class PageCanvasController {
    private surface?: Surface;
    private canvas?: HTMLCanvasElement;
    private kernel?: NativeTextKernel;
    private revision?: number;

    get paintedRevision(): number | undefined {
        return this.revision;
    }

    invalidate(): void {
        this.revision = undefined;
    }

    paint(target: PageCanvasTarget): void {
        this.revision = undefined;
        try {
            if (!Number.isFinite(target.scale) || target.scale <= 0) throw new Error('Invalid canvas scale');
            const requestedRatio = target.pixelRatio ?? globalThis.devicePixelRatio ?? 1;
            const ratio = Number.isFinite(requestedRatio) && requestedRatio > 0 ? requestedRatio : 1;
            const pixelScale = Math.min(
                Math.min(ratio, 2) * target.scale,
                Math.sqrt(12_000_000 / (target.page.width * target.page.height)),
            );
            const width = Math.ceil(target.page.width * pixelScale),
                height = Math.ceil(target.page.height * pixelScale);
            if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
                throw new Error('Invalid canvas dimensions');
            if (
                !this.surface ||
                this.canvas !== target.canvas ||
                this.kernel !== target.kernel ||
                target.canvas.width !== width ||
                target.canvas.height !== height
            ) {
                this.dispose();
                this.canvas = target.canvas;
                this.kernel = target.kernel;
                target.canvas.width = width;
                target.canvas.height = height;
                this.surface = target.kernel.surface(target.canvas);
            }
            paintPage(target.kernel, this.surface, target.page, pixelScale);
            this.revision = target.revision;
        } catch (error) {
            this.dispose();
            throw error;
        }
    }

    dispose(): void {
        const surface = this.surface,
            canvas = this.canvas;
        this.surface = undefined;
        this.canvas = undefined;
        this.kernel = undefined;
        this.revision = undefined;
        try {
            surface?.dispose();
        } catch {
        } finally {
            if (canvas) canvas.width = canvas.height = 0;
        }
    }
}
