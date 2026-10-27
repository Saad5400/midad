import { nativeLabels } from '@saad5400/midad/browser';
import type { NativeTextKernel } from '@saad5400/midad/rendering';
import { Page as NativePage, editorChromeKey } from '@saad5400/midad/vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

describe('page surface', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    describe('native page surface lifecycle', () => {
        function fixture() {
            let intersect!: (entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void;
            vi.stubGlobal(
                'IntersectionObserver',
                class {
                    constructor(
                        private callback: typeof intersect,
                        options?: IntersectionObserverInit,
                    ) {
                        if (options?.rootMargin) intersect = callback;
                    }
                    observe() {
                        this.callback([{ isIntersecting: true, intersectionRatio: 1 }]);
                    }
                    disconnect() {}
                },
            );
            let bytes = 0,
                created = 0,
                released = 0;
            const painted = vi.fn();
            const kernel = {
                ck: {
                    Paint: class {
                        setColor() {}
                        setAntiAlias() {}
                        delete() {}
                    },
                },
                surface: (canvas: HTMLCanvasElement) => {
                    const size = canvas.width * canvas.height * 4;
                    bytes += size;
                    created++;
                    return {
                        getCanvas: () => ({
                            clear() {},
                            getSaveCount: () => 1,
                            save() {},
                            scale() {},
                            restoreToCount() {},
                        }),
                        flush: painted,
                        delete: vi.fn(),
                        dispose: () => {
                            bytes -= size;
                            released++;
                        },
                    };
                },
            } as unknown as NativeTextKernel;
            const wrapper = mount(NativePage, {
                props: {
                    page: { width: 595, height: 842, commands: [], lines: [] },
                    kernel,
                    index: 0,
                    revision: 1,
                    scale: 1,
                    floatingFieldIds: [],
                    floatingImageIds: [],
                },
            });
            return {
                wrapper,
                painted,
                intersect: (visible: boolean) =>
                    intersect([{ isIntersecting: visible, intersectionRatio: Number(visible) }]),
                memory: () => ({ bytes, created, released }),
            };
        }
        it('reuses the same raster allocation while editing an unchanged page size', async () => {
            const f = fixture();
            try {
                await flushPromises();
                for (let index = 0; index < 40; index++) {
                    await f.wrapper.setProps({
                        page: { width: 595, height: 842, commands: [], lines: [] },
                        revision: index + 2,
                    });
                    await flushPromises();
                    expect(f.memory().created).toBe(1);
                    expect(f.wrapper.find('canvas').attributes('data-painted-revision')).toBe(String(index + 2));
                }
            } finally {
                f.wrapper.unmount();
            }
            expect(f.memory()).toMatchObject({ bytes: 0, created: 1, released: 1 });
        });
        it('releases raster pixel buffers through edits, zooming, virtualization and unmounting', async () => {
            const f = fixture();
            try {
                await flushPromises();
                const initial = f.memory().bytes;
                expect(initial).toBeGreaterThan(0);
                for (let index = 0; index < 40; index++) {
                    await f.wrapper.setProps({ scale: 0.6 + index / 100, revision: index + 2 });
                    await flushPromises();
                    expect(f.memory().bytes).toBeLessThanOrEqual(initial);
                    expect(f.memory().created - f.memory().released).toBe(1);
                    expect(f.wrapper.find('canvas').attributes('data-painted-revision')).toBe(String(index + 2));
                }
                f.intersect(false);
                await flushPromises();
                expect(f.memory().bytes).toBe(0);
                f.intersect(true);
                await flushPromises();
                expect(f.memory().bytes).toBeGreaterThan(0);
                expect(f.painted).toHaveBeenCalledTimes(42);
            } finally {
                f.wrapper.unmount();
            }
            expect(f.memory().bytes).toBe(0);
            expect(f.memory().released).toBe(f.memory().created);
        });
    });
});

describe('page recovery', () => {
    const paint = vi.fn();
    let view: VueWrapper | undefined;
    beforeEach(() => {
        paint.mockReset();
        vi.stubGlobal(
            'IntersectionObserver',
            class {
                constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
                observe() {
                    this.callback([{ isIntersecting: true }]);
                }
                disconnect() {}
            },
        );
    });
    afterEach(() => {
        view?.unmount();
        view = undefined;
        vi.unstubAllGlobals();
    });
    function open(surface: ReturnType<typeof vi.fn>): VueWrapper {
        return mount(NativePage, {
            props: {
                page: { width: 200, height: 200, lines: [], commands: [] },
                kernel: {
                    surface: () => ({
                        ...surface(),
                        getCanvas: () => ({
                            clear() {},
                            getSaveCount: () => 1,
                            save() {},
                            scale() {},
                            restoreToCount() {},
                        }),
                        flush: paint,
                    }),
                    ck: {
                        Paint: class {
                            setColor() {}
                            setAntiAlias() {}
                            delete() {}
                        },
                    },
                } as unknown as NativeTextKernel,
                index: 0,
                revision: 0,
                scale: 1,
                labels: nativeLabels.en,
                floatingFieldIds: [],
                floatingImageIds: [],
            },
            global: {
                provide: {
                    [editorChromeKey as symbol]: ref({
                        NativeObjectBoxes: defineComponent({
                            setup: () => () => h('div', { 'data-field-overlay': '' }),
                        }),
                    }),
                },
            },
        });
    }
    describe('native page painting failures', () => {
        it('removes hit targets when the PDF background fails and restores them only after recovery', async () => {
            view = open(vi.fn().mockReturnValue({ dispose: vi.fn() }));
            await flushPromises();
            await view.setProps({ backgroundFailed: true, backgroundReady: false });
            expect(view.attributes('inert')).toBeDefined();
            expect(view.find('[data-field-overlay]').exists()).toBe(false);
            expect(view.emitted('state')!.at(-1)![1]).toMatchObject({ failed: true, paintedRevision: undefined });
            await view.setProps({ backgroundFailed: false, backgroundReady: true });
            expect(view.attributes('inert')).toBeUndefined();
            expect(view.find('[data-field-overlay]').exists()).toBe(true);
            expect(view.emitted('state')!.at(-1)![1]).toMatchObject({ failed: false, paintedRevision: 0 });
        });
        it('withholds page readiness until its PDF background is painted and invalidates readiness when it changes', async () => {
            view = open(vi.fn().mockReturnValue({ dispose: vi.fn() }));
            await view.setProps({ backgroundReady: false, transparent: true });
            await flushPromises();
            const latest = () => view!.emitted('state')!.at(-1)![1] as { paintedRevision?: number };
            expect(paint).toHaveBeenCalled();
            expect(latest().paintedRevision).toBeUndefined();
            await view.setProps({ backgroundReady: true });
            expect(latest().paintedRevision).toBe(0);
            await view.setProps({ backgroundReady: false });
            expect(latest().paintedRevision).toBeUndefined();
        });
        it('reports surface creation failures, removes invisible hit targets and recovers on resize', async () => {
            const failure = new Error('Surface unavailable');
            const surface = vi.fn().mockImplementation(() => {
                throw failure;
            });
            view = open(surface);
            await flushPromises();
            expect(view.emitted('failed')).toEqual([[0, failure]]);
            expect(view.emitted('painted')).toBeUndefined();
            expect(view.find('canvas').attributes('data-painted-revision')).toBeUndefined();
            expect(view.find('[data-field-overlay]').exists()).toBe(false);
            expect(view.attributes('inert')).toBeDefined();
            surface.mockReturnValue({ dispose: vi.fn() });
            window.dispatchEvent(new Event('resize'));
            await flushPromises();
            expect(view.emitted('painted')).toEqual([[0]]);
            expect(view.find('canvas').attributes('data-painted-revision')).toBe('0');
            expect(view.find('[data-field-overlay]').exists()).toBe(true);
            expect(view.attributes('inert')).toBeUndefined();
        });
        it('invalidates a previously painted revision when painting fails and does not leak cleanup errors', async () => {
            const dispose = vi.fn();
            view = open(vi.fn().mockReturnValue({ dispose }));
            await flushPromises();
            const failure = new Error('Paint failed');
            paint.mockImplementationOnce(() => {
                throw failure;
            });
            dispose.mockImplementationOnce(() => {
                throw new Error('Disposed surface');
            });
            await view.setProps({ page: { width: 200, height: 200, lines: [], commands: [] }, revision: 1 });
            await flushPromises();
            expect(view.emitted('failed')).toEqual([[0, failure]]);
            expect(view.find('canvas').attributes('data-painted-revision')).toBeUndefined();
            expect(view.find('canvas').attributes('style')).toContain('opacity: 0');
            expect(view.find('[data-field-overlay]').exists()).toBe(false);
            window.dispatchEvent(new Event('resize'));
            await flushPromises();
            expect(view.find('canvas').attributes('data-painted-revision')).toBe('1');
            expect(view.emitted('painted')).toHaveLength(2);
        });
    });
});
