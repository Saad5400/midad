import { PdfDocumentController, type PdfDocumentSource, type PdfDocumentState } from '@saad5400/midad/browser/view';
import { afterEach, expect, it, vi } from 'vitest';

const bytes = new TextEncoder().encode('%PDF-test');
const controllers: PdfDocumentController<PdfDocumentSource>[] = [];
afterEach(() => {
    controllers.splice(0).forEach((controller) => controller.dispose());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});
function source(
    pages = [
        { number: 1, width: 300, height: 400 },
        { number: 2, width: 800, height: 400 },
    ],
) {
    return {
        pages,
        bytes: () => bytes,
        plainText: vi.fn(async () => 'Document العربية'),
        destroy: vi.fn(async () => {}),
    };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
function fixture(overrides: Partial<ConstructorParameters<typeof PdfDocumentController<PdfDocumentSource>>[0]> = {}) {
    const viewport = document.createElement('div'),
        pagesElement = document.createElement('div');
    document.body.append(viewport);
    viewport.append(pagesElement);
    Object.defineProperty(viewport, 'clientHeight', { value: 600, configurable: true });
    viewport.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
        viewport.scrollTop = top ?? 0;
    });
    const parsed = source();
    let state: PdfDocumentState<PdfDocumentSource>;
    const error = vi.fn(),
        ready = vi.fn(),
        clipboard = vi.fn(async (_text: string) => {});
    const reader = new PdfDocumentController({
        load: vi.fn(async () => bytes),
        open: vi.fn(async () => parsed),
        viewport: () => viewport,
        pagesElement: () => pagesElement,
        changed: (next) => {
            state = next;
        },
        error,
        ready,
        clipboard,
        ...overrides,
    });
    controllers.push(reader);
    async function loaded() {
        const pending = reader.open();
        await vi.waitFor(() => expect(reader.snapshot.source).toBeDefined());
        return { pending };
    }
    return { reader, document: parsed, viewport, pagesElement, error, ready, clipboard, state: () => state!, loaded };
}
it('publishes parsed pages but becomes ready only after its current page is painted', async () => {
    const f = fixture(),
        { pending } = await f.loaded();
    expect(f.state().status).toBe('loading');
    f.reader.painted(2);
    expect(f.state().status).toBe('loading');
    f.reader.painted(1);
    expect(await pending).toBe(true);
    expect(f.state().status).toBe('ready');
    expect(f.ready).toHaveBeenCalledOnce();
    expect(Object.isFrozen(f.state())).toBe(true);
    expect(Object.isFrozen(f.state().pages)).toBe(true);
});
it('finishes a hanging load within five seconds even if the provider ignores cancellation', async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const f = fixture({
        load: (value) => {
            signal = value;
            return new Promise(() => {});
        },
    });
    const pending = f.reader.open();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe(false);
    expect(signal.aborted).toBe(true);
    expect(f.state()).toMatchObject({ status: 'error', failure: 'timeout', source: undefined });
    expect(f.error).toHaveBeenCalledOnce();
});
it('includes the first paint in its readiness deadline and releases a timed-out source', async () => {
    vi.useFakeTimers();
    const f = fixture(),
        pending = f.reader.open();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.reader.snapshot.source).toBe(f.document);
    await vi.advanceTimersByTimeAsync(4999);
    expect(await pending).toBe(false);
    expect(f.document.destroy).toHaveBeenCalledOnce();
    f.reader.painted(1);
    expect(f.state().status).toBe('error');
});
it('releases an obsolete source returned after its replacement and ignores stale page callbacks', async () => {
    const first = deferred<PdfDocumentSource>(),
        old = source(),
        next = source();
    const open = vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValue(next);
    const f = fixture({ open });
    const pending = f.reader.open();
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    const generation = f.reader.snapshot.generation;
    const replacement = f.reader.open();
    expect(await pending).toBe(false);
    await vi.waitFor(() => expect(f.reader.snapshot.source).toBe(next));
    first.resolve(old);
    await vi.waitFor(() => expect(old.destroy).toHaveBeenCalledOnce());
    f.reader.painted(1, generation);
    expect(f.state().status).toBe('loading');
    f.reader.painted(1);
    expect(await replacement).toBe(true);
});
it.each(
    [
        [],
        [{ number: 2, width: 300, height: 400 }],
        [{ number: 1, width: Infinity, height: 400 }],
        [{ number: 1, width: 300, height: 0 }],
    ].map((pages) => ({ pages })),
)('refuses invalid page metadata and releases the source', async ({ pages }) => {
    const document = source(pages),
        f = fixture({ open: async () => document });
    expect(await f.reader.open()).toBe(false);
    expect(f.state()).toMatchObject({ status: 'error', failure: 'document' });
    expect(document.destroy).toHaveBeenCalledOnce();
});
it('clamps navigation, ignores invalid input and reveals geometry in PDF points', async () => {
    const f = fixture(),
        { pending } = await f.loaded();
    f.reader.painted(1);
    await pending;
    await f.reader.setMode('100');
    f.reader.navigate(99);
    expect(f.state().current).toBe(2);
    expect(f.viewport.scrollTop).toBeCloseTo((400 * 4) / 3 + 24);
    f.reader.navigate(NaN);
    expect(f.state().current).toBe(2);
    f.reader.reveal(2, { y: 100, height: 40 });
    expect(f.viewport.scrollTop).toBeCloseTo(f.state().pageTops[1] + (120 * 4) / 3 - 300);
});
it('tracks the page with the largest visible height in a mixed-size document', async () => {
    const f = fixture(),
        { pending } = await f.loaded();
    f.reader.painted(1);
    await pending;
    await f.reader.setMode('100');
    f.viewport.scrollTop = f.state().pageTops[1];
    f.reader.scrolled();
    expect(f.state().current).toBe(2);
});
it('preserves the real viewport position across rapid zoom changes', async () => {
    const layout = deferred<void>(),
        f = fixture({ afterLayout: () => layout.promise });
    const { pending } = await f.loaded();
    f.reader.painted(1);
    await pending;
    const oldZoom = f.state().zoom;
    f.viewport.scrollTop = 100;
    f.reader.setMode('200');
    f.reader.setMode('50');
    layout.resolve();
    await vi.waitFor(() => expect(f.viewport.scrollTop).toBeCloseTo((100 * 0.5) / oldZoom));
    expect(f.state().mode).toBe('50');
});
it('lets explicit navigation override a pending zoom anchor', async () => {
    const layout = deferred<void>(),
        f = fixture({ afterLayout: () => layout.promise });
    const { pending } = await f.loaded();
    f.reader.painted(1);
    await pending;
    f.reader.setMode('200');
    f.reader.navigate(2);
    layout.resolve();
    await vi.waitFor(() => expect(f.viewport.scrollTop).toBeCloseTo(f.state().pageTops[1] - 24));
});
it('recovers readiness after a failed page is explicitly repainted', async () => {
    const f = fixture(),
        { pending } = await f.loaded();
    f.reader.painted(1);
    await pending;
    f.reader.pageError(2, new Error('Raster failure'));
    expect(f.state().status).toBe('error');
    f.reader.retryPage(2);
    f.reader.painted(1);
    expect(f.state().status).toBe('loading');
    f.reader.painted(2);
    expect(f.state().status).toBe('ready');
});
it('copies complete source text and cancels stale extraction after another document opens', async () => {
    const text = deferred<string>(),
        old = source(),
        next = source();
    old.plainText = vi.fn(() => text.promise);
    const f = fixture({ open: vi.fn().mockResolvedValueOnce(old).mockResolvedValue(next) });
    const { pending } = await f.loaded();
    f.reader.painted(1);
    await pending;
    const copying = f.reader.copyText();
    const replacement = f.reader.open();
    await vi.waitFor(() => expect(f.reader.snapshot.source).toBe(next));
    text.resolve('Old source');
    expect(await copying).toBe(false);
    expect(f.clipboard).not.toHaveBeenCalled();
    f.reader.painted(1);
    await replacement;
    expect(await f.reader.copyText()).toBe(true);
    expect(f.clipboard).toHaveBeenCalledWith('Document العربية');
});
it('keeps native editing shortcuts inside host inputs and contenteditable slots', async () => {
    const f = fixture(),
        { pending } = await f.loaded();
    f.reader.painted(1);
    await pending;
    for (const control of [
        document.createElement('textarea'),
        Object.assign(document.createElement('div'), { contentEditable: 'true' }),
    ]) {
        f.pagesElement.append(control);
        control.addEventListener('keydown', (event) => f.reader.key(event));
        const event = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, cancelable: true });
        control.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
    }
    const select = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, cancelable: true });
    f.reader.key(select);
    expect(select.defaultPrevented).toBe(true);
    expect(f.state().allSelected).toBe(true);
});
it('owns and revokes download URLs and closes the source exactly once', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reader'),
        revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const f = fixture(),
        { pending } = await f.loaded();
    f.reader.painted(1);
    await pending;
    expect(f.reader.download('Contract')).toBe(true);
    expect(f.reader.download('Contract')).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    f.reader.dispose();
    f.reader.dispose();
    expect(revoke).toHaveBeenCalledWith('blob:reader');
    expect(f.document.destroy).toHaveBeenCalledOnce();
});

it('bounds a stalled clipboard provider as well as text extraction', async () => {
    vi.useFakeTimers();
    const f = fixture({ clipboard: () => new Promise(() => {}) }),
        pending = f.reader.open();
    await vi.advanceTimersByTimeAsync(1);
    f.reader.painted(1);
    await pending;
    const copying = f.reader.copyText();
    await vi.advanceTimersByTimeAsync(4500);
    expect(await copying).toBe(false);
    expect(f.state().copyFailed).toBe(true);
});
it('keeps another failed page in error after one page recovers', async () => {
    const f = fixture(),
        { pending } = await f.loaded();
    f.reader.painted(1);
    await pending;
    f.reader.pageError(1, new Error('Page 1'));
    f.reader.pageError(2, new Error('Page 2'));
    f.reader.retryPage(1);
    f.reader.painted(1);
    expect(f.state().status).toBe('error');
    f.reader.retryPage(2);
    f.reader.painted(2);
    expect(f.state().status).toBe('ready');
});
it('preserves a centered passage reveal while a zoom change is waiting for layout', async () => {
    const layout = deferred<void>(),
        f = fixture({ afterLayout: () => layout.promise });
    const { pending } = await f.loaded();
    f.reader.painted(1);
    await pending;
    const zooming = f.reader.setMode('200');
    f.reader.reveal(2, { y: 100, height: 40 });
    layout.resolve();
    await zooming;
    expect(f.viewport.scrollTop).toBeCloseTo(f.state().pageTops[1] + (120 * 2 * 4) / 3 - 300);
});

it('does not copy text that finishes extracting after the copy deadline', async () => {
    vi.useFakeTimers();
    const text = deferred<string>(),
        parsed = source();
    parsed.plainText = vi.fn(() => text.promise);
    const f = fixture({ open: async () => parsed }),
        pending = f.reader.open();
    await vi.advanceTimersByTimeAsync(1);
    f.reader.painted(1);
    await pending;
    const copy = f.reader.copyText();
    await vi.advanceTimersByTimeAsync(4500);
    expect(await copy).toBe(false);
    text.resolve('Too late');
    await Promise.resolve();
    await Promise.resolve();
    expect(f.clipboard).not.toHaveBeenCalled();
});

it('keeps the current page when zooming from an end-of-document scroll clamp', async () => {
    const f = fixture(),
        { pending } = await f.loaded();
    f.reader.painted(1);
    await pending;
    await f.reader.setMode('25');
    f.reader.navigate(2);
    f.viewport.scrollTop = 0;
    await f.reader.setMode('auto');
    expect(f.viewport.scrollTop).toBeCloseTo(f.state().pageTops[1] - 24);
    f.reader.scrolled();
    expect(f.state().current).toBe(2);
});
