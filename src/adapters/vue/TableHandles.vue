<script setup lang="ts">
import { TableResizeView, type TableResizeFrame } from '../../browser/view/index.js';
import type { NativeLabels } from '../../browser/labels.js';
import type { SceneCell, SceneTableRow } from '../../layout/index.js';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
    cells: readonly SceneCell[];
    rows: readonly SceneTableRow[];
    rowHeights: Readonly<Record<string, number>>;
    tableId: string;
    labels: NativeLabels;
    scale: number;
}>();
const emit = defineEmits<{
    resize: [tableId: string, boundary: number, delta: number, width: number];
    resizeRow: [tableId: string, rowId: string, height: number | null];
}>();
const host = ref<HTMLElement>();
let view: TableResizeView | undefined;
const frame = (): TableResizeFrame => ({ ...props });
onMounted(() => {
    view = new TableResizeView(host.value!, frame(), {
        resize: (...args) => emit('resize', ...args),
        resizeRow: (...args) => emit('resizeRow', ...args),
    });
});
watch(
    () => [props.cells, props.rows, props.rowHeights, props.tableId, props.labels, props.scale],
    () => view?.update(frame()),
);
onBeforeUnmount(() => view?.dispose());
</script>

<template>
    <div ref="host" />
</template>
