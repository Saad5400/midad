<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import { PageCanvasController } from '@saad5400/midad/browser/view';
import type { NativeTextKernel } from '@saad5400/midad/kernel';
import type { ScenePage } from '@saad5400/midad/layout';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const ui = useEditorUi();
const NativeFieldPlaceholders = useUiComponent('NativeFieldPlaceholders');

const props = defineProps<{ kernel: NativeTextKernel; page: ScenePage; revision: number; scale: number }>();
const emit = defineEmits<{ painted: []; error: [error: unknown] }>();
const canvas = ref<HTMLCanvasElement>();
const painter = new PageCanvasController();
let generation = 0,
    disposed = false;
async function draw(): Promise<void> {
    const version = ++generation;
    await nextTick();
    if (disposed || version !== generation || !canvas.value) return;
    try {
        painter.paint({
            canvas: canvas.value,
            kernel: props.kernel,
            page: props.page,
            revision: props.revision,
            scale: props.scale,
            transparent: true,
        });
        canvas.value.dataset.paintedRevision = String(props.revision);
        emit('painted');
    } catch (error) {
        emit('error', error);
    }
}
watch([() => props.page, () => props.scale, () => props.revision, () => props.kernel], () => void draw());
onMounted(() => void draw());
onBeforeUnmount(() => {
    disposed = true;
    generation++;
    painter.dispose();
});
</script>
<template>
    <div class="pointer-events-none absolute inset-0" data-native-pdf-overlays>
        <canvas ref="canvas" aria-hidden="true" class="absolute inset-0 h-full w-full" />
        <NativeFieldPlaceholders :page="page" :scale="scale" />
    </div>
</template>
