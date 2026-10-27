<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import type { MediaResolver } from '@saad5400/midad/assets';
import { importDocument } from '@saad5400/midad/document';
import { NativeTextKernel } from '@saad5400/midad/kernel';
import { assertPdfSurface, layoutPdfOverlays, type DocumentScene } from '@saad5400/midad/layout';
import { documentPresentation } from '@saad5400/midad/presentation';
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import NativePdfDocument from './NativePdfDocument.vue';
import NativeSceneOverlay from './NativeSceneOverlay.vue';

const ui = useEditorUi();

const props = defineProps<{
    content: unknown;
    id: string;
    title: string;
    locale: 'ar' | 'en';
    load: (signal: AbortSignal) => Promise<Uint8Array>;
    resolveMedia: MediaResolver;
}>();
const emit = defineEmits<{ ready: []; error: [error: unknown] }>();
const reader = ref<InstanceType<typeof NativePdfDocument>>();
const kernel = shallowRef<NativeTextKernel>(),
    scene = shallowRef<DocumentScene>();
const document = importDocument(props.content, props.id);
const presentation = documentPresentation(document);
const hasCover = presentation.cover.enabled;
const hasObjects =
    !!(presentation.header.enabled && presentation.header.src) ||
    ['blockVariables', 'floatingImages'].some(
        (key) => Array.isArray(document.root.attributes?.[key]) && (document.root.attributes![key] as unknown[]).length,
    );
let disposed = false,
    generation = 0,
    ready = false;
const verifiedLoad = computed(() => {
    const load = props.load;
    return async (signal: AbortSignal): Promise<Uint8Array> => {
        const bytes = await load(signal);
        signal.throwIfAborted();
        const expected = document.root.attributes?.nativePdfSource;
        if (typeof expected === 'string') {
            const digest = Array.from(
                new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
                (value: any) => value.toString(16).padStart(2, '0'),
            ).join('');
            if (expected !== digest) throw new Error('The imported PDF source changed. Reload the document.');
        }
        return bytes;
    };
});
const composedLoad = computed(() => {
    const load = verifiedLoad.value;
    return async (signal: AbortSignal): Promise<Uint8Array> => {
        const version = generation;
        const current = () => {
            signal.throwIfAborted();
            if (disposed || version !== generation) throw new Error('The PDF preview changed');
        };
        const original = await load(signal);
        current();
        const { createPdfOverlaySnapshot, pdfSourcePages } = await import('@saad5400/midad/pdf');
        const pages = await pdfSourcePages(original);
        current();
        assertPdfSurface(document, { kind: 'pdf', pages });
        const renderer = await NativeTextKernel.create(props.resolveMedia);
        try {
            current();
            await renderer.prepare(document);
            current();
            const scene = layoutPdfOverlays(document, renderer, pages);
            const bytes = await createPdfOverlaySnapshot(original, scene, renderer, () => document, pages);
            current();
            return bytes;
        } finally {
            renderer.destroy();
        }
    };
});
function reset(): void {
    generation++;
    ready = false;
    scene.value = undefined;
    kernel.value?.destroy();
    kernel.value = undefined;
}
async function printBytes(signal: AbortSignal): Promise<Uint8Array> {
    signal.throwIfAborted();
    const prepared = scene.value,
        painter = kernel.value,
        version = generation;
    if (!reader.value || !prepared || !painter) throw new Error('The PDF overlays are not ready');
    const source = await reader.value.printSource(signal);
    signal.throwIfAborted();
    if (disposed || version !== generation || scene.value !== prepared) throw new Error('The PDF preview changed');
    const { createPdfOverlaySnapshot } = await import('@saad5400/midad/pdf');
    signal.throwIfAborted();
    if (disposed || version !== generation || scene.value !== prepared) throw new Error('The PDF preview changed');
    const bytes = await createPdfOverlaySnapshot(source.bytes, prepared, painter, () => document, source.viewports);
    signal.throwIfAborted();
    if (disposed || version !== generation || scene.value !== prepared) throw new Error('The PDF preview changed');
    return bytes;
}
function failed(error: unknown, area = 'document'): void {
    if (area === 'document' || area === 'page') emit('error', error);
}
function painted(): void {
    if (!ready && !disposed) {
        ready = true;
        emit('ready');
    }
}
async function loaded(): Promise<void> {
    reset();
    const pages = reader.value?.pages() ?? [];
    const expected = document.root.children?.filter((node) => node.kind === 'pdfPage') ?? [];
    if (
        !pages.length ||
        expected.length !== pages.length ||
        expected.some((node, index) => Number(node.attributes?.number) !== pages[index].number)
    ) {
        emit('error', new Error('The PDF source does not match the template pages'));
        return;
    }
    if (!hasObjects) {
        painted();
        return;
    }
    const version = ++generation;
    let next: NativeTextKernel | undefined;
    try {
        next = await NativeTextKernel.create(props.resolveMedia);
        await next.prepare(document);
        if (disposed || version !== generation) {
            next.destroy();
            return;
        }
        const prepared = layoutPdfOverlays(document, next, pages);
        kernel.value?.destroy();
        kernel.value = next;
        scene.value = prepared;
    } catch (error) {
        next?.destroy();
        if (!disposed && version === generation) emit('error', error);
    }
}
onBeforeUnmount(() => {
    disposed = true;
    reset();
});
watch(() => props.load, reset, { flush: 'sync' });
</script>
<template>
    <NativePdfDocument
        ref="reader"
        :load="hasCover ? composedLoad : verifiedLoad"
        :title="title"
        :locale="locale"
        height="100%"
        :allow-download="false"
        :allow-print="hasCover || !hasObjects || !!scene"
        :print-bytes="!hasCover && hasObjects ? printBytes : undefined"
        :print-identity="!hasCover && hasObjects ? () => scene : undefined"
        @ready="hasCover ? painted() : loaded()"
        @error="failed"
    >
        <template v-if="!hasCover" #page="{ page, scale, visible }">
            <NativeSceneOverlay
                v-if="visible && kernel && scene"
                :kernel="kernel"
                :page="scene.pages[page.number - 1]"
                :revision="scene.revision"
                :scale="scale"
                @painted="page.number === 1 && painted()"
                @error="(error) => emit('error', error)"
            />
        </template>
    </NativePdfDocument>
</template>
