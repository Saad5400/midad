export const forceLtr = (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D | null): void => {
    canvas.dir = 'ltr';
    if (context) context.direction = 'ltr';
};

export class LtrCanvasFactory {
    private readonly ownerDocument: Document;
    private readonly willReadFrequently: boolean;

    constructor({
        ownerDocument = globalThis.document,
        enableHWA = false,
    }: { ownerDocument?: Document; enableHWA?: boolean } = {}) {
        this.ownerDocument = ownerDocument;
        this.willReadFrequently = !enableHWA;
    }

    create(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D | null } {
        if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
        const canvas = this.ownerDocument.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: this.willReadFrequently });
        forceLtr(canvas, context);
        return { canvas, context };
    }

    reset(
        pair: { canvas: HTMLCanvasElement | null; context: CanvasRenderingContext2D | null },
        width: number,
        height: number,
    ): void {
        if (!pair.canvas) throw new Error('Canvas is not specified');
        if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
        pair.canvas.width = width;
        pair.canvas.height = height;
        // Resizing resets the context state, direction included.
        forceLtr(pair.canvas, pair.context);
    }

    destroy(pair: { canvas: HTMLCanvasElement | null; context: CanvasRenderingContext2D | null }): void {
        if (!pair.canvas) throw new Error('Canvas is not specified');
        pair.canvas.width = pair.canvas.height = 0;
        pair.canvas = null;
        pair.context = null;
    }
}
