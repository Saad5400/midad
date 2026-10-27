<script setup lang="ts">
import {
    pdfAnnotations as nativePdfAnnotations,
    loadPdfLibrary as nativePdfLibrary,
    type PdfSource as NativePdfSource,
    type PdfLink,
    type PdfPageBox,
    type PdfWidget,
} from '../../pdf/reading/index.js';
import type { PdfReviewPiece } from '../../pdf/reading/index.js';
import { reviewRects, type PdfReviewRect } from '../../pdf/reading/index.js';
import { applyPdfReading } from '../../pdf/reading/index.js';
import { POINT_TO_PIXEL } from '../../browser/view/viewport.js';
import type { RenderTask, TextLayer } from 'pdfjs-dist';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

const props = defineProps<{
    source: NativePdfSource;
    page: PdfPageBox;
    zoom: number;
    viewport?: HTMLElement;
    label: string;
    retry: string;
    failure: string;
    interactiveFields?: readonly string[];
    highlights?: readonly PdfReviewPiece[];
    highlightBoxes?: readonly { x: number; y: number; width: number; height: number }[];
}>();
const emit = defineEmits<{
    painted: [number: number];
    error: [error: unknown];
    widgets: [page: number, widgets: readonly PdfWidget[]];
    field: [widget: PdfWidget];
}>();
const holder = ref<HTMLElement>(),
    canvasHost = ref<HTMLElement>(),
    textHost = ref<HTMLElement>();
const near = ref(false),
    painted = ref(false),
    failed = ref(false);
const paintedScale = ref(1);
const highlightRects = shallowRef<readonly PdfReviewRect[]>([]);
async function highlight(): Promise<void> {
    await nextTick();
    if (disposed || !painted.value || !holder.value || !textHost.value) {
        highlightRects.value = [];
        return;
    }
    highlightRects.value = [
        ...reviewRects(holder.value, textHost.value, props.highlights ?? [], scale.value),
        ...(props.highlightBoxes ?? []).map((box) => ({
            left: box.x * scale.value,
            top: box.y * scale.value,
            width: box.width * scale.value,
            height: box.height * scale.value,
        })),
    ];
}
watch([painted, () => props.highlights, () => props.highlightBoxes, () => props.zoom], () => void highlight());
const widgets = shallowRef<readonly PdfWidget[]>([]),
    links = shallowRef<readonly PdfLink[]>([]);
const scale = computed(() => props.zoom * POINT_TO_PIXEL);
const style = computed(() => ({
    width: `${props.page.width * scale.value}px`,
    height: `${props.page.height * scale.value}px`,
}));
const interactive = computed(() => new Set(props.interactiveFields ?? []));
const bounds = (box: { x: number; y: number; width: number; height: number }) => ({
    left: `${box.x * scale.value}px`,
    top: `${box.y * scale.value}px`,
    width: `${box.width * scale.value}px`,
    height: `${box.height * scale.value}px`,
});
let observer: IntersectionObserver | undefined, task: RenderTask | undefined, text: TextLayer | undefined;
let serial: Promise<void> = Promise.resolve(),
    generation = 0,
    disposed = false;

function queue(): void {
    const version = ++generation;
    painted.value = false;
    task?.cancel();
    text?.cancel();
    serial = serial.catch(() => {}).then(() => render(version));
}

async function render(version: number): Promise<void> {
    if (disposed || version !== generation) return;
    if (!near.value) {
        task = undefined;
        text = undefined;
        for (const canvas of canvasHost.value?.querySelectorAll('canvas') ?? []) canvas.width = canvas.height = 0;
        canvasHost.value?.replaceChildren();
        textHost.value?.replaceChildren();
        widgets.value = [];
        links.value = [];
        painted.value = false;
        void props.source
            .page(props.page.number)
            .then((page) => page.cleanup())
            .catch(() => {});
        return;
    }
    failed.value = false;
    let canvas: HTMLCanvasElement | undefined;
    try {
        const [page, library] = await Promise.all([props.source.page(props.page.number), nativePdfLibrary()]);
        if (disposed || version !== generation) return;
        const viewport = page.getViewport({ scale: scale.value });
        const density = Math.min(
            devicePixelRatio || 1,
            2,
            Math.sqrt(12_000_000 / (viewport.width * viewport.height)),
            8192 / Math.max(viewport.width, viewport.height),
        );
        canvas = document.createElement('canvas');
        canvas.dir = 'ltr';
        canvas.width = Math.ceil(viewport.width * density);
        canvas.height = Math.ceil(viewport.height * density);
        canvas.setAttribute('aria-hidden', 'true');
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('A PDF canvas could not be created');
        context.direction = 'ltr';
        const container = document.createElement('div');
        container.className = 'textLayer';
        const textScale = viewport.scale * page.userUnit;
        container.style.setProperty('--total-scale-factor', String(textScale));
        const content = await props.source.textPage(props.page.number);
        if (disposed || version !== generation) return;
        text = new library.TextLayer({ container, viewport, textContentSource: content.content });
        const { pageWidth, pageHeight } = viewport.rawDims as { pageWidth: number; pageHeight: number };
        container.style.width = `${pageWidth * textScale}px`;
        container.style.height = `${pageHeight * textScale}px`;
        task = page.render({
            canvas,
            canvasContext: context,
            viewport,
            transform: [density, 0, 0, density, 0, 0],
            annotationMode: library.AnnotationMode.ENABLE,
        });
        const [annotations] = await Promise.all([nativePdfAnnotations(page), task.promise, text.render()]);
        if (disposed || version !== generation) return;
        props.source.assertRenderable();
        let textIndex = 0;
        content.content.items.forEach((item, index) => {
            if ('str' in item) {
                const div = text!.textDivs[textIndex++];
                if (div) div.dataset.nativePdfItem = String(index);
            }
        });
        applyPdfReading(container, content, viewport);
        for (const old of canvasHost.value?.querySelectorAll('canvas') ?? []) old.width = old.height = 0;
        canvasHost.value!.replaceChildren(canvas);
        textHost.value!.replaceChildren(container);
        canvas = undefined;
        widgets.value = annotations.widgets;
        links.value = annotations.links;
        paintedScale.value = viewport.scale;
        painted.value = true;
        emit('widgets', props.page.number, annotations.widgets);
        emit('painted', props.page.number);
    } catch (error) {
        if (disposed || version !== generation) return;
        failed.value = true;
        emit('error', error);
    } finally {
        if (canvas) canvas.width = canvas.height = 0;
    }
}

watch([near, () => props.zoom, () => props.source], queue);
onMounted(() => {
    observer = new IntersectionObserver(
        ([entry]) => {
            near.value = entry.isIntersecting;
        },
        { root: props.viewport, rootMargin: '700px' },
    );
    observer.observe(holder.value!);
});
onBeforeUnmount(() => {
    disposed = true;
    generation++;
    observer?.disconnect();
    task?.cancel();
    text?.cancel();
    for (const canvas of canvasHost.value?.querySelectorAll('canvas') ?? []) canvas.width = canvas.height = 0;
});
</script>

<template>
    <section
        ref="holder"
        class="native-pdf-page"
        :data-pdf-page="page.number"
        :data-painted="painted"
        :data-pdf-error="failed"
        :data-render-scale="painted ? paintedScale : undefined"
        :aria-label="`${label} ${page.number}`"
        :style="style"
        dir="ltr"
    >
        <div
            v-if="!painted && !failed"
            class="native-pdf-page-skeleton"
            aria-hidden="true"
        />
        <div
            ref="canvasHost"
            class="native-pdf-raster"
        />
        <div
            ref="textHost"
            class="native-pdf-text"
            :style="{ transform: `scale(${scale / paintedScale})` }"
        />
        <div
            v-if="painted"
            class="native-pdf-overlay"
        >
            <div
                v-for="(rectangle, index) in highlightRects"
                :key="index"
                class="native-pdf-review-hit"
                aria-hidden="true"
                :style="{
                    left: `${rectangle.left}px`,
                    top: `${rectangle.top}px`,
                    width: `${rectangle.width}px`,
                    height: `${rectangle.height}px`,
                }"
            />
            <slot
                :page="page"
                :scale="scale"
                :visible="near && painted && !failed"
            />
        </div>
        <a
            v-for="(link, index) in links"
            :key="index"
            :href="link.href"
            :style="bounds(link)"
            class="native-pdf-link"
            target="_blank"
            rel="noopener noreferrer"
            :aria-label="link.href"
        />
        <button
            v-for="widget in widgets.filter((widget) => interactive.has(widget.name) && !widget.readOnly)"
            :key="widget.id"
            :data-pdf-field="widget.name"
            :aria-label="widget.name"
            :style="bounds(widget)"
            class="native-pdf-widget"
            type="button"
            @click="emit('field', widget)"
        />
        <div
            v-if="failed"
            class="native-pdf-page-error"
            role="alert"
        >
            <p>{{ failure }}</p>
            <button
                type="button"
                @click="queue"
            >
                {{ retry }}
            </button>
        </div>
    </section>
</template>
