import { PdfPrintController, type PdfPrintOptions } from '@saad5400/midad/browser/view';
import { afterEach, expect, it, vi } from 'vitest';

const pdf = new TextEncoder().encode('%PDF-1.7\nfixture');
const controllers: PdfPrintController[] = [];
afterEach(() => {
    controllers.forEach((controller) => controller.dispose());
    controllers.length = 0;
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});
function fixture(bytes = vi.fn(async (_signal: AbortSignal) => pdf), overrides: Partial<PdfPrintOptions> = {}) {
    const root = document.createElement('section');
    document.body.append(root);
    const create = document.createElement.bind(document);
    const loads = new WeakMap<Element, () => void>();
    vi.spyOn(document, 'createElement').mockImplementation(((name: string) => {
        const element = create(name);
        if (name === 'iframe') {
            Object.defineProperty(element, 'src', {
                get: () => 'about:blank',
                set: () => {},
            });
            Object.defineProperty(element, 'onload', {
                get: () => null,
                set: (value) => loads.set(element, value),
            });
        }
        return element;
    }) as typeof document.createElement);
    const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:midad-print');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let identity = 1;
    const error = vi.fn(),
        busy = vi.fn();
    const controller = new PdfPrintController(root, {
        bytes,
        identity: () => identity,
        ready: () => true,
        error,
        busy,
        ...overrides,
    });
    controllers.push(controller);
    async function loaded(behavior?: (frame: HTMLIFrameElement) => void) {
        await vi.waitFor(() => expect(document.querySelector('iframe[data-midad-print]')).not.toBeNull());
        const frame = document.querySelector<HTMLIFrameElement>('iframe[data-midad-print]')!;
        const print = vi.fn(() => behavior?.(frame));
        frame.contentWindow!.print = print;
        loads.get(frame)!();
        return { frame, print };
    }
    return { root, controller, loaded, error, busy, objectUrl, revoke, change: () => identity++ };
}
it('prints the complete PDF through its own frame and retains bytes until printing finishes', async () => {
    const f = fixture();
    const pending = f.controller.print();
    const { frame, print } = await f.loaded();
    await pending;
    expect(print).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(await f.objectUrl.mock.calls[0][0].arrayBuffer())).toEqual(pdf);
    expect(f.revoke).not.toHaveBeenCalled();
    frame.contentWindow!.dispatchEvent(new Event('afterprint'));
    expect(frame.isConnected).toBe(false);
    expect(f.revoke).toHaveBeenCalledWith('blob:midad-print');
});
it('coalesces repeated requests while preparing a PDF', async () => {
    const f = fixture();
    const first = f.controller.print(),
        second = f.controller.print();
    expect(first).toBe(second);
    const { print } = await f.loaded();
    await first;
    expect(print).toHaveBeenCalledTimes(1);
});
it('rejects a document changed before its PDF frame is ready', async () => {
    const f = fixture();
    const pending = f.controller.print();
    const rejected = expect(pending).rejects.toThrow('source changed');
    f.change();
    await rejected;
    expect(f.objectUrl).not.toHaveBeenCalled();
    expect(f.error).toHaveBeenCalledTimes(1);
});
it('rejects a document changed while its PDF frame loads', async () => {
    const f = fixture();
    const pending = f.controller.print();
    const rejected = expect(pending).rejects.toThrow('source changed');
    await vi.waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
    f.change();
    const { print } = await f.loaded();
    await rejected;
    expect(print).not.toHaveBeenCalled();
    expect(f.revoke).toHaveBeenCalled();
});
it('rejects a non-PDF response without creating a frame', async () => {
    const f = fixture(vi.fn(async () => new TextEncoder().encode('not a PDF')));
    await expect(f.controller.print()).rejects.toThrow('valid PDF');
    expect(f.objectUrl).not.toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
});
it('flushes pending edits before capturing the PDF identity', async () => {
    let f: ReturnType<typeof fixture>;
    const before = vi.fn(async () => {
        f.change();
    });
    f = fixture(undefined, { before });
    const pending = f.controller.print();
    const { print } = await f.loaded();
    await pending;
    expect(before).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledTimes(1);
});
it('reuses a retained frame when the exact source is printed again', async () => {
    const f = fixture(undefined, { reuse: () => true });
    const first = f.controller.print();
    const { print } = await f.loaded();
    await first;
    await f.controller.print();
    expect(print).toHaveBeenCalledTimes(2);
    expect(f.objectUrl).toHaveBeenCalledTimes(1);
    expect(f.revoke).not.toHaveBeenCalled();
});
it('refreshes authoritative bytes on later requests by default even when the editor identity is unchanged', async () => {
    const load = vi.fn(async (_signal: AbortSignal) => pdf),
        f = fixture(load);
    const first = f.controller.print();
    await f.loaded();
    await first;
    const second = f.controller.print();
    const { print } = await f.loaded();
    await second;
    expect(load).toHaveBeenCalledTimes(2);
    expect(f.objectUrl).toHaveBeenCalledTimes(2);
    expect(print).toHaveBeenCalledTimes(1);
});
it('restores the editing focus and selection after the print frame takes focus', async () => {
    const f = fixture(),
        input = document.createElement('input');
    f.root.append(input);
    input.value = 'Keep this selection';
    input.focus();
    input.setSelectionRange(2, 7);
    const pending = f.controller.print();
    await f.loaded((frame) => frame.focus());
    await pending;
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 7]);
});
it('reports a failed byte producer once and permits retry without changing the source', async () => {
    const failure = new Error('PDF request failed');
    const load = vi.fn(async (_signal: AbortSignal) => pdf).mockRejectedValueOnce(failure);
    const f = fixture(load);
    await expect(f.controller.print()).rejects.toBe(failure);
    expect(f.error).toHaveBeenCalledExactlyOnceWith(failure);
    expect(f.objectUrl).not.toHaveBeenCalled();
    const retry = f.controller.print();
    const { print } = await f.loaded();
    await retry;
    expect(print).toHaveBeenCalledTimes(1);
});
it('times out a PDF frame that never loads and releases its URL', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = f.controller.print();
    const rejected = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('iframe')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(document.querySelector('iframe')).toBeNull();
    expect(f.revoke).toHaveBeenCalledTimes(1);
});
it('does not print while the source is unavailable', async () => {
    const load = vi.fn(async (_signal: AbortSignal) => pdf);
    const f = fixture(load, { ready: () => false });
    await expect(f.controller.print()).rejects.toThrow('not ready');
    expect(load).not.toHaveBeenCalled();
    expect(f.objectUrl).not.toHaveBeenCalled();
});
it('keeps the PDF bytes immutable while its frame is loading', async () => {
    const bytes = new Uint8Array(pdf),
        f = fixture(vi.fn(async () => bytes));
    const pending = f.controller.print();
    await vi.waitFor(() => expect(f.objectUrl).toHaveBeenCalledTimes(1));
    bytes.fill(0);
    await f.loaded();
    await pending;
    expect(new Uint8Array(await f.objectUrl.mock.calls[0][0].arrayBuffer())).toEqual(pdf);
});
it('cancels disposal without printing a late response or reporting a stale error', async () => {
    let resolve!: (bytes: Uint8Array) => void;
    const f = fixture(
        vi.fn(
            () =>
                new Promise<Uint8Array>((done) => {
                    resolve = done;
                }),
        ),
    );
    const pending = f.controller.print();
    const rejected = expect(pending).rejects.toThrow('cancelled');
    f.controller.dispose();
    resolve(pdf);
    await rejected;
    expect(f.objectUrl).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
});
it('times out stalled preparation at five seconds and permits retry', async () => {
    vi.useFakeTimers();
    const load = vi.fn((_signal: AbortSignal): Promise<Uint8Array> => new Promise(() => {}));
    const f = fixture(load);
    const pending = f.controller.print();
    const rejected = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(load.mock.calls[0][0].aborted).toBe(true);
    vi.useRealTimers();
    load.mockResolvedValue(pdf);
    const retry = f.controller.print();
    const { print } = await f.loaded();
    await retry;
    expect(print).toHaveBeenCalledTimes(1);
});
