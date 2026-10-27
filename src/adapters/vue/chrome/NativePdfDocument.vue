<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import type { PdfSource as NativePdfSource, PdfWidget } from '@saad5400/midad/pdf/reading';
import {
    mappedReviewLocations,
    reviewLocationValid,
    textReviewLocations,
    type PdfReviewLocation,
    type PdfReviewRequest,
} from '@saad5400/midad/pdf/reading';
import { decodeReviewMap, type PdfReviewData } from '@saad5400/midad/pdf/reading';
import type { PdfPageText } from '@saad5400/midad/pdf/reading';
import { PrintShortcut } from '@saad5400/midad/browser/input';
import {
    PDF_READER_LABELS,
    PdfDocumentController,
    PdfPrintController,
    type PdfDocumentState,
} from '@saad5400/midad/browser/view';
import type { PdfOverlayViewport } from '@saad5400/midad/pdf';
import { POINT_TO_PIXEL } from '@saad5400/midad/viewport';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useSlots, watch } from 'vue';
import { PdfPage as NativePdfPage } from '@saad5400/midad/vue';

const ui = useEditorUi();

const props = withDefaults(
    defineProps<{
        load: (signal: AbortSignal) => Promise<Uint8Array>;
        title: string;
        locale?: 'ar' | 'en';
        height?: string;
        interactiveFields?: readonly string[];
        allowDownload?: boolean;
        allowPrint?: boolean;
        printBytes?: (signal: AbortSignal) => Promise<Uint8Array>;
        printIdentity?: () => unknown;
        beforePrint?: (signal: AbortSignal) => Promise<void>;
        reviewMap?: PdfReviewData;
        reviewEnabled?: boolean;
    }>(),
    { locale: 'ar', height: 'calc(100dvh - 5rem)', allowDownload: true, allowPrint: undefined },
);
const emit = defineEmits<{
    'review-clear': [];
    painted: [page: number];
    ready: [report: { milliseconds: number; pages: number }];
    error: [error: unknown, area?: 'document' | 'page' | 'copy' | 'review' | 'print'];
    field: [page: number, widget: PdfWidget];
    widgets: [page: number, widgets: readonly PdfWidget[]];
}>();
const labels = computed(() => PDF_READER_LABELS[props.locale === 'ar' ? 'ar' : 'en']);
const slots = useSlots();
const readerRoot = ref<HTMLElement>();
const printBusy = ref(false),
    printError = ref(false);
const printable = computed(() => props.allowPrint ?? (!!props.printBytes || !slots.page));
let printer: PdfPrintController | undefined, printShortcut: PrintShortcut | undefined;
async function print(): Promise<void> {
    printError.value = false;
    await printer?.print().catch(() => {});
}
const viewport = ref<HTMLElement>();
const view = shallowRef<PdfDocumentState<NativePdfSource>>();
const reader = new PdfDocumentController<NativePdfSource>({
    load: (signal) => props.load(signal),
    open: (bytes, signal) => ui.openPdf!(bytes, signal),
    viewport: () => viewport.value,
    pagesElement: () => viewport.value?.querySelector('.native-pdf-pages'),
    afterLayout: () => nextTick(),
    changed: (snapshot) => {
        view.value = snapshot;
    },
    ready: (report) => {
        if (document.activeElement === document.body) viewport.value?.focus({ preventScroll: true });
        emit('ready', report);
    },
    error: (error, area) => emit('error', error, area),
});
view.value = reader.snapshot;
const source = computed(() => view.value!.source);
const state = computed(() => view.value!.status);
const failure = computed(() =>
    view.value!.failure === 'timeout'
        ? labels.value.timeout
        : view.value!.failure === 'page'
          ? labels.value.pageError
          : labels.value.error,
);
const mode = computed({
    get: () => view.value!.mode,
    set: (value: string) => {
        void reader.setMode(value);
    },
});
const current = computed(() => view.value!.current);
const zoom = computed(() => view.value!.zoom);
const maxPage = computed(() => view.value!.maxPage);
const allSelected = computed(() => view.value!.allSelected);
const copyFailed = computed(() => view.value!.copyFailed);
let observer: ResizeObserver | undefined,
    disposed = false;
function measure(): void {
    if (viewport.value)
        void reader.setViewport(
            Math.max(1, viewport.value.clientWidth - 48),
            Math.max(1, viewport.value.clientHeight - 48),
        );
}
function open(): void {
    clearReview();
    resetPrinter();
    void reader.open().then(() => {
        if (!disposed) measure();
    });
}
function painted(page: number): void {
    reader.painted(page);
    emit('painted', page);
}
function pageError(page: number, error: unknown): void {
    reader.pageError(page, error);
}
function navigate(number: number): void {
    reader.navigate(number);
}
function reveal(number: number, rectangle: { y: number; height: number }): void {
    reader.reveal(number, rectangle);
}
function scrolled(): void {
    reader.scrolled();
}
function download(): void {
    reader.download(props.title);
}
function key(event: KeyboardEvent): void {
    reader.key(event);
}
function copyText(): void {
    void reader.copyText();
}
function copied(event: ClipboardEvent): void {
    reader.copied(event);
}
const reviewUsed = ref(!!props.reviewEnabled);
watch(
    () => props.reviewEnabled,
    (enabled) => {
        if (enabled) reviewUsed.value = true;
    },
);
const reviewLocations = shallowRef<readonly PdfReviewLocation[]>([]);
const reviewIndex = ref(0),
    reviewMessage = ref(''),
    reviewBusy = ref(false);
const currentReview = computed(() => reviewLocations.value[reviewIndex.value]);
let reviewGeneration = 0;
function clearReview(): void {
    reviewGeneration++;
    reviewLocations.value = [];
    reviewIndex.value = 0;
    reviewMessage.value = '';
    reviewBusy.value = false;
}
async function revealReview(request: PdfReviewRequest): Promise<DOMRect | null> {
    clearReview();
    reviewUsed.value = true;
    const document = source.value,
        version = reviewGeneration;
    if (!document || state.value !== 'ready') return null;
    if (!request.blockIds?.length && !request.quote) {
        reviewMessage.value = labels.value.reviewGeneral;
        return null;
    }
    reviewBusy.value = true;
    reviewMessage.value = labels.value.reviewLoading;
    const deadline = performance.now() + 4500;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const valid = () =>
        !disposed && source.value === document && version === reviewGeneration && performance.now() < deadline;
    const read = async (numbers: readonly number[]): Promise<Map<number, PdfPageText>> => {
        const result = new Map<number, PdfPageText>();
        let next = 0;
        await Promise.all(
            Array.from({ length: Math.min(4, numbers.length) }, async () => {
                while (next < numbers.length && valid()) {
                    const number = numbers[next++];
                    result.set(number, await document.textPage(number));
                }
            }),
        );
        return result;
    };
    try {
        let locations = await Promise.race([
            (async () => {
                let map;
                try {
                    map = props.reviewMap ? await decodeReviewMap(props.reviewMap) : undefined;
                } catch (error) {
                    if (!request.quote) throw error;
                }
                const compatible =
                    map?.pages?.length === document.pages.length &&
                    map.pages.every(
                        (page, index) =>
                            Math.abs(page.width - document.pages[index].width) < 0.002 &&
                            Math.abs(page.height - document.pages[index].height) < 0.002,
                    );
                const mapped = compatible ? mappedReviewLocations(map!, request) : [];
                if (mapped.length) {
                    const data = await read([
                        ...new Set(
                            mapped.flatMap((location) => [
                                ...location.pieces.map((piece) => piece.page),
                                ...(location.boxes ?? []).map((box) => box.page),
                            ]),
                        ),
                    ]);
                    const pages = await Promise.all([...data.keys()].map((number) => document.page(number)));
                    const unrotated = pages.every(
                        (page) => page.rotate === 0 && page.userUnit === 1 && page.view[0] === 0 && page.view[1] === 0,
                    );
                    if (valid() && unrotated && mapped.every((location) => reviewLocationValid(location, data)))
                        return mapped;
                }
                if (!valid() || !request.quote) return [];
                const pages = await read(document.pages.map((page) => page.number));
                return valid()
                    ? textReviewLocations(
                          document.pages.map((page) => pages.get(page.number)!),
                          request,
                      )
                    : [];
            })(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('PDF review lookup timed out')), 4500);
            }),
        ]);
        if (!valid()) return null;
        locations = locations.filter((location) => document.pages[location.page - 1]);
        reviewLocations.value = locations;
        reviewMessage.value = !locations.length
            ? labels.value.reviewMissing
            : locations.length > 1
              ? labels.value.reviewMultiple
              : !locations[0].exact && request.quote && !request.wholeBlock
                ? labels.value.reviewChanged
                : '';
        if (!locations.length) return null;
        const rectangle = await showReviewLocation(0, deadline, version);
        if (!rectangle && version === reviewGeneration) reviewMessage.value = labels.value.reviewMissing;
        return rectangle;
    } catch (error) {
        if (!disposed && source.value === document && version === reviewGeneration) {
            reviewGeneration++;
            reviewBusy.value = false;
            reviewMessage.value = labels.value.reviewFailure;
            emit('error', error, 'review');
        }
        return null;
    } finally {
        clearTimeout(timer);
        if (version === reviewGeneration) reviewBusy.value = false;
    }
}
async function showReviewLocation(
    index: number,
    deadline = performance.now() + 4500,
    version = reviewGeneration,
): Promise<DOMRect | null> {
    const location = reviewLocations.value[index];
    if (!location || !source.value) return null;
    reviewIndex.value = index;
    let box = location.box;
    if (!box) {
        const piece = location.pieces.find((piece) => piece.page === location.page)!;
        const data = await source.value.textPage(location.page);
        const page = await source.value.page(location.page);
        const viewport = page.getViewport({ scale: 1 });
        const span = piece.row === undefined ? data.content.items[piece.span] : data.rows[piece.row]?.[piece.span];
        if (span) {
            const bounds =
                'box' in span
                    ? span.box
                    : 'transform' in span
                      ? [
                            span.transform[4],
                            span.transform[5],
                            span.transform[4] + span.width,
                            span.transform[5] + span.height,
                        ]
                      : undefined;
            if (bounds) {
                const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(bounds);
                box = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
            }
        }
    }
    if (version !== reviewGeneration || disposed) return null;
    if (box) reveal(location.page, box);
    else navigate(location.page);
    await nextTick();
    while (version === reviewGeneration && !disposed && performance.now() < deadline) {
        const hit = viewport.value?.querySelector(`[data-pdf-page="${location.page}"] .native-pdf-review-hit`);
        if (hit) return hit.getBoundingClientRect();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return null;
}
async function moveReview(index: number): Promise<void> {
    const version = ++reviewGeneration;
    reviewBusy.value = false;
    try {
        await showReviewLocation(index, performance.now() + 4500, version);
    } catch (error) {
        if (version !== reviewGeneration || disposed) return;
        reviewMessage.value = labels.value.reviewFailure;
        emit('error', error, 'review');
    }
}
watch(current, async () => {
    await nextTick();
    const page = viewport.value?.querySelector(`[data-pdf-page="${current.value}"]`);
    if (page?.getAttribute('data-painted') === 'true') painted(current.value);
    else if (page?.getAttribute('data-pdf-error') === 'true' && state.value === 'loading')
        pageError(current.value, new Error('The PDF page could not be displayed'));
});
watch(
    () => props.load,
    () => void open(),
);
function resetPrinter(): void {
    printer?.dispose();
    printError.value = false;
    if (!readerRoot.value) return;
    printer = new PdfPrintController(readerRoot.value!, {
        before: async (signal) => {
            await props.beforePrint?.(signal);
        },
        bytes: async (signal) => {
            if (props.printBytes) return props.printBytes(signal);
            if (!source.value || (slots.page && props.allowPrint !== true))
                throw new Error('A complete print PDF is required');
            return source.value.bytes();
        },
        identity: () => (props.printIdentity ? props.printIdentity() : source.value),
        reuse: () => !props.printBytes,
        ready: () => printable.value && state.value === 'ready',
        busy: (busy) => {
            printBusy.value = busy;
        },
        error: (error) => {
            printError.value = true;
            emit('error', error, 'print');
        },
    });
}
async function printSource(signal: AbortSignal): Promise<{ bytes: Uint8Array; viewports: PdfOverlayViewport[] }> {
    signal.throwIfAborted();
    const document = source.value;
    if (!document || state.value !== 'ready') throw new Error('The PDF is not ready');
    const viewports = new Array<PdfOverlayViewport>(document.pages.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(4, document.pages.length) }, async () => {
            while (next < document.pages.length) {
                signal.throwIfAborted();
                const index = next++;
                const viewport = (await document.page(index + 1)).getViewport({ scale: 1 });
                viewports[index] = {
                    width: viewport.width,
                    height: viewport.height,
                    transform: [...viewport.transform],
                };
            }
        }),
    );
    signal.throwIfAborted();
    if (disposed || source.value !== document || state.value !== 'ready') throw new Error('The PDF changed');
    document.assertRenderable();
    return { bytes: document.bytes(), viewports };
}
onMounted(() => {
    printShortcut = new PrintShortcut(readerRoot.value!, () => {
        void print();
    });
    observer = new ResizeObserver(measure);
    observer.observe(viewport.value!);
    void open();
});
onBeforeUnmount(() => {
    printShortcut?.dispose();
    printer?.dispose();
    disposed = true;
    reviewGeneration++;
    observer?.disconnect();
    reader.dispose();
});
defineExpose({
    print,
    printSource,
    bytes: () => source.value?.bytes(),
    pages: () => source.value?.pages ?? [],
    navigate,
    reveal,
    revealReview,
    clearReview,
});
</script>

<template>
    <div
        ref="readerRoot"
        class="native-pdf-document"
        :style="{ height }"
        :dir="locale === 'ar' ? 'rtl' : 'ltr'"
        :data-pdf-state="state"
        :class="{ 'is-pdf-all-selected': allSelected }"
        @keydown="key"
        @copy="copied"
        @pointerdown.capture="reader.clearSelection()"
    >
        <div class="native-pdf-controls">
            <button
                type="button"
                :disabled="!source || current <= 1"
                :aria-label="labels.previous"
                @click="navigate(current - 1)"
            >
                ‹
            </button>
            <label
                >{{ labels.page
                }}<input
                    :value="current"
                    type="number"
                    min="1"
                    :max="source?.pages.length ?? 1"
                    :aria-label="labels.page"
                    :disabled="!source"
                    @change="navigate(Number(($event.target as HTMLInputElement).value))"
                    @keydown.enter="navigate(Number(($event.target as HTMLInputElement).value))"
            /></label>
            <span>{{ labels.of }} {{ source?.pages.length ?? '—' }}</span>
            <button
                type="button"
                :disabled="!source || current >= source.pages.length"
                :aria-label="labels.next"
                @click="navigate(current + 1)"
            >
                ›
            </button>
            <label
                >{{ labels.zoom
                }}<select v-model="mode" :aria-label="labels.zoom">
                    <option value="auto">{{ labels.auto }}</option>
                    <option value="width">{{ labels.width }}</option>
                    <option value="page">{{ labels.fit }}</option>
                    <option
                        v-for="value in [25, 50, 75, 100, 125, 150, 200, 300, 400]"
                        :key="value"
                        :value="String(value)"
                    >
                        {{ value }}%
                    </option>
                </select></label
            >
            <button v-if="allowDownload" type="button" :disabled="state !== 'ready'" @click="download">
                {{ labels.download }}
            </button>
            <button v-if="printable" type="button" :disabled="state !== 'ready' || printBusy" @click="print">
                {{ printBusy ? labels.printing : labels.print }}
            </button>
            <span v-if="printError" role="alert"
                >{{ printable ? labels.printError : labels.printUnavailable }}
                <button v-if="printable" type="button" @click="print">
                    {{ labels.retry }}
                </button>
            </span>
            <span v-if="copyFailed" role="alert"
                >{{ labels.copyError }}
                <button type="button" @click="copyText">
                    {{ labels.retry }}
                </button></span
            >
            <span class="native-pdf-announcement" role="status">{{ allSelected ? labels.selected : '' }}</span>
        </div>
        <div
            v-if="reviewUsed || reviewBusy || reviewMessage || reviewLocations.length"
            class="native-pdf-review-controls"
            aria-live="polite"
        >
            <span role="status">{{
                reviewMessage || (reviewLocations.length ? labels.reviewLocated : labels.reviewIdle)
            }}</span>
            <template v-if="reviewLocations.length > 1">
                <button
                    type="button"
                    :aria-label="labels.reviewPrevious"
                    :disabled="reviewIndex === 0"
                    @click="moveReview(reviewIndex - 1)"
                >
                    ‹
                </button>
                <span>{{ reviewIndex + 1 }} / {{ reviewLocations.length }}</span>
                <button
                    type="button"
                    :aria-label="labels.reviewNext"
                    :disabled="reviewIndex + 1 >= reviewLocations.length"
                    @click="moveReview(reviewIndex + 1)"
                >
                    ›
                </button>
            </template>
            <button
                type="button"
                :aria-label="labels.reviewClear"
                :disabled="!reviewBusy && !reviewMessage && !reviewLocations.length"
                @click="
                    clearReview();
                    emit('review-clear');
                "
            >
                ×
            </button>
        </div>
        <div
            ref="viewport"
            class="native-pdf-viewport"
            tabindex="0"
            role="region"
            :aria-label="title"
            @scroll.passive="scrolled"
        >
            <div v-if="state === 'loading' && !source" class="native-pdf-loading" role="status">
                {{ labels.loading }}
                <div />
            </div>
            <div v-if="state === 'error'" class="native-pdf-error" role="alert">
                <p>{{ failure }}</p>
                <button type="button" @click="open">
                    {{ labels.retry }}
                </button>
            </div>
            <div
                v-if="source && state !== 'error'"
                class="native-pdf-pages"
                :style="{ minWidth: `${maxPage.width * zoom * POINT_TO_PIXEL + 48}px` }"
            >
                <NativePdfPage
                    v-for="page in source.pages"
                    :key="page.number"
                    :source="source"
                    :page="page"
                    :zoom="zoom"
                    :viewport="viewport"
                    :label="labels.page"
                    :retry="labels.retry"
                    :failure="labels.pageError"
                    :interactive-fields="interactiveFields"
                    :highlights="currentReview?.pieces.filter((piece) => piece.page === page.number)"
                    :highlight-boxes="currentReview?.boxes?.filter((box) => box.page === page.number)"
                    @painted="painted"
                    @error="(error) => pageError(page.number, error)"
                    @widgets="(number, widgets) => emit('widgets', number, widgets)"
                    @field="(widget) => emit('field', page.number, widget)"
                >
                    <template #default="context"><slot name="page" v-bind="context" /></template>
                </NativePdfPage>
            </div>
        </div>
    </div>
</template>
