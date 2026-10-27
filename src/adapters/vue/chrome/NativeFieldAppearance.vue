<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import type { FieldAppearance } from '@saad5400/midad/field-appearance';
import type { NativeTextKernel } from '@saad5400/midad/kernel';
import { paintPage } from '@saad5400/midad/paint';
import type { Surface } from 'canvaskit-wasm';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const ui = useEditorUi();

const props = defineProps<{ appearance: FieldAppearance; kernel: NativeTextKernel; scale: number }>();
const emit = defineEmits<{ error: [error: unknown] }>();
const canvas = ref<HTMLCanvasElement>(),
    painted = ref(false);
const style = computed(() => ({
    left: `${props.appearance.field.x * props.scale}px`,
    top: `${props.appearance.field.y * props.scale}px`,
    width: `${props.appearance.field.width * props.scale}px`,
    height: `${props.appearance.field.height * props.scale}px`,
}));
let surface: Surface | undefined,
    generation = 0,
    disposed = false;
async function draw(): Promise<void> {
    try {
        const version = ++generation;
        painted.value = false;
        await nextTick();
        if (disposed || version !== generation || !canvas.value) return;
        const { page } = props.appearance;
        const density = Math.min(
            devicePixelRatio || 1,
            2,
            Math.sqrt(12_000_000 / (page.width * page.height * props.scale ** 2)),
        );
        const scale = props.scale * density;
        const width = Math.ceil(page.width * scale),
            height = Math.ceil(page.height * scale);
        if (!surface || canvas.value.width !== width || canvas.value.height !== height) {
            surface?.dispose();
            canvas.value.width = width;
            canvas.value.height = height;
            surface = props.kernel.surface(canvas.value);
        }
        paintPage(props.kernel, surface, page, scale, true);
        painted.value = true;
    } catch (error) {
        if (!disposed) emit('error', error);
    }
}
watch([() => props.appearance, () => props.scale], () => void draw());
onMounted(() => void draw());
onBeforeUnmount(() => {
    disposed = true;
    generation++;
    surface?.dispose();
});
</script>

<template>
    <canvas
        ref="canvas"
        :data-field-appearance="appearance.field.id"
        :data-painted="painted"
        :style="style"
        class="native-field-appearance"
        aria-hidden="true"
    />
</template>
