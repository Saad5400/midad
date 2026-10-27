<script setup lang="ts">
import { PagePointerController } from '../../browser/input/page-pointer.js';
import { PageView, type PageViewFrame, type PageViewState } from '../../browser/view/page-view.js';
import type { FieldBounds } from '../../content/fields/placement.js';
import type { NativeTextKernel } from '../../rendering/kernel.js';
import type { NativeLabels } from '../../browser/labels.js';
import type { ScenePage } from '../../layout/index.js';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useEditorChrome } from './integration.js';
const NativeBlockHandles = useEditorChrome('NativeBlockHandles');
const NativeFieldPlaceholders = useEditorChrome('NativeFieldPlaceholders');
const NativeObjectBoxes = useEditorChrome('NativeObjectBoxes');
import NativeTableHandles from './TableHandles.vue';

const props = defineProps<{
    page: ScenePage;
    kernel: NativeTextKernel;
    index: number;
    revision: number;
    transparent?: boolean;
    backgroundReady?: boolean;
    backgroundFailed?: boolean;
    pageLabel?: string;
    selectingCells?: boolean;
    activeTableId?: string;
    tableRowHeights?: Readonly<Record<string, number>>;
    labels?: NativeLabels;
    valueEntry?: boolean;
    participants?: readonly { id: string; name: string; color?: string }[];
    activeFieldId?: string;
    floatingFieldIds: readonly string[];
    activeImageId?: string;
    floatingImageIds: readonly string[];
    readonly?: boolean;
    showFieldPlaceholders?: boolean;
    reviewing?: boolean;
    reviewFields?: boolean;
    scale: number;
    bilingualPreview?: ReadonlySet<string>;
    historyHighlights?: ReadonlyMap<string, 'added' | 'removed' | 'modified' | 'moved'>;
    blockDirection?: 'ltr' | 'rtl';
    busy?: boolean;
    draggingBlockId?: string;
    gutterContexts?: Readonly<
        Record<string, { direction: 'ltr' | 'rtl'; columns?: readonly string[]; activeColumn?: string }>
    >;
    activeBlockId?: string;
    lockedBlockId?: string;
}>();
const emit = defineEmits<{
    painted: [index: number];
    state: [index: number, state: PageViewState];
    failed: [index: number, error: unknown];
    finish: [];
    resize: [tableId: string, boundary: number, delta: number, width: number];
    resizeRow: [tableId: string, rowId: string, height: number | null];
    field: [id: string];
    valueField: [id: string, anchor: HTMLElement];
    editField: [id: string];
    positionField: [id: string, page: number, bounds: FieldBounds];
    fieldShortcut: [event: KeyboardEvent];
    image: [id: string];
    editImage: [id: string];
    positionImage: [id: string, page: number, bounds: FieldBounds];
    blockMenu: [id: string, x: number, y: number];
    blockInsert: [id: string, x: number, y: number, index: number, column?: string];
    blockDrag: [id: string, x: number, y: number];
    blockDrop: [id: string, x: number, y: number];
    blockCancel: [];
    point: [
        index: number,
        x: number,
        y: number,
        extend: boolean,
        clicks: number,
        shift: boolean,
        clientX: number,
        clientY: number,
        pointerType: string,
        held: boolean,
    ];
}>();
const holder = ref<HTMLElement>();
const canvasHost = ref<HTMLElement>();
const visible = ref(false);
const canvasFailed = ref(false);
const paintFailed = computed(() => canvasFailed.value || props.backgroundFailed);
const scale = computed(() => props.scale);
function nodeBoxes(highlights?: ReadonlyMap<string, string>) {
    const boxes: Array<{ x: number; y: number; width: number; height: number; kind: string }> = [];
    if (!highlights?.size) return boxes;
    for (const line of props.page.lines) {
        const kind = highlights.get(line.paragraphId);
        const shaped = line.shaped.lines.find((part) => Math.abs(part.top - line.originalTop) < 0.1);
        if (kind)
            boxes.push({
                x: (line.left ?? 0) + (shaped?.left ?? 0),
                y: line.top,
                width: Math.max(shaped?.width ?? 8, 8),
                height: line.height,
                kind,
            });
    }
    for (const command of props.page.commands) {
        if (command.kind !== 'image' && command.kind !== 'field') continue;
        const kind = command.nodeId ? highlights.get(command.nodeId) : undefined;
        if (kind) boxes.push({ x: command.x, y: command.y, width: command.width, height: command.height, kind });
    }
    for (const cell of props.page.cells ?? []) {
        const kind = highlights.get(cell.tableId) ?? highlights.get(cell.cellId);
        if (kind) boxes.push({ x: cell.x, y: cell.y, width: cell.width, height: cell.height, kind });
    }
    return boxes;
}
const historyBoxes = computed(() => nodeBoxes(props.historyHighlights));
const previewBoxes = computed(() =>
    nodeBoxes(
        props.bilingualPreview?.size ? new Map([...props.bilingualPreview].map((id) => [id, 'preview'])) : undefined,
    ),
);
let view: PageView | undefined;
let currentState: PageViewState | undefined;
function pageState(state: PageViewState): void {
    currentState = state;
    visible.value = state.near;
    canvasFailed.value = state.failed;
    emit('state', props.index, {
        ...state,
        failed: !!paintFailed.value,
        paintedRevision: props.backgroundReady === false || paintFailed.value ? undefined : state.paintedRevision,
    });
}
function frame(): PageViewFrame {
    return {
        page: props.page,
        kernel: props.kernel,
        revision: props.revision,
        scale: scale.value,
        transparent: props.transparent,
        label: `${props.pageLabel ?? 'صفحة'} ${props.index + 1}`,
    };
}
watch(
    [() => props.page, () => props.kernel, () => props.revision, scale, () => props.pageLabel, () => props.transparent],
    () => view?.update(frame()),
);
watch([() => props.backgroundReady, () => props.backgroundFailed], () => currentState && pageState(currentState));
onMounted(() => {
    view = new PageView(canvasHost.value!, frame(), {
        state: pageState,
        painted: () => emit('painted', props.index),
        error: (error) => emit('failed', props.index, error),
    });
});
onBeforeUnmount(() => {
    view?.dispose();
    pointer.pointerCancel();
});

const pointer = new PagePointerController({
    element: () => holder.value,
    scale: () => scale.value,
    selectingCells: () => !!props.selectingCells,
    onPoint: (point) =>
        emit(
            'point',
            props.index,
            point.x,
            point.y,
            point.extend,
            point.clicks,
            point.shift,
            point.clientX,
            point.clientY,
            point.pointerType,
            point.held,
        ),
    onFinish: () => emit('finish'),
});
</script>

<template>
    <article
        ref="holder"
        class="native-page"
        :inert="paintFailed"
        :class="{ 'is-selecting-cells': selectingCells }"
        :data-page="index + 1"
        :data-view-scale="scale"
        :style="{ width: `${page.width * scale}px`, height: `${page.height * scale}px` }"
        @contextmenu="pointer.contextMenu($event)"
        @pointerdown="pointer.pointerDown($event)"
        @mousedown="pointer.mouseDown($event)"
        @pointermove="pointer.pointerMove($event)"
        @pointerup="pointer.pointerUp($event)"
        @pointercancel="pointer.pointerCancel()"
        @lostpointercapture="pointer.pointerCancel()"
    >
        <slot name="background" />
        <div
            ref="canvasHost"
            class="native-page-canvas"
            style="position: absolute; inset: 0"
        />
        <div
            v-if="visible && !paintFailed && previewBoxes.length"
            class="native-bilingual-preview"
            aria-hidden="true"
        >
            <span
                v-for="(box, index) in previewBoxes"
                :key="index"
                :style="{
                    left: `${box.x * scale}px`,
                    top: `${box.y * scale}px`,
                    width: `${box.width * scale}px`,
                    height: `${box.height * scale}px`,
                }"
            />
        </div>
        <div
            v-if="visible && !paintFailed && historyBoxes.length"
            class="native-history-highlights"
            aria-hidden="true"
        >
            <span
                v-for="(box, index) in historyBoxes"
                :key="index"
                :data-history-change="box.kind"
                :style="{
                    left: `${box.x * scale}px`,
                    top: `${box.y * scale}px`,
                    width: `${box.width * scale}px`,
                    height: `${box.height * scale}px`,
                }"
            />
        </div>
        <NativeTableHandles
            v-if="visible && !paintFailed && activeTableId && labels && !readonly && !reviewing"
            :cells="page.cells ?? []"
            :rows="page.tableRows ?? []"
            :row-heights="tableRowHeights ?? {}"
            :table-id="activeTableId"
            :labels="labels"
            :scale="scale"
            @resize="(tableId, boundary, delta, width) => emit('resize', tableId, boundary, delta, width)"
            @resize-row="(tableId, rowId, height) => emit('resizeRow', tableId, rowId, height)"
        />
        <NativeBlockHandles
            v-if="
                (visible || page.blocks?.some((block) => block.id === draggingBlockId)) &&
                labels &&
                !paintFailed &&
                !readonly &&
                !reviewing &&
                page.blocks?.length
            "
            :blocks="page.blocks"
            :columns="page.columns"
            :contexts="gutterContexts"
            :active-id="activeBlockId"
            :locked-id="lockedBlockId"
            :focusable="index === 0"
            :scale="scale"
            :direction="blockDirection ?? 'rtl'"
            :labels="labels"
            :disabled="!!busy"
            @menu="(id: string, x: number, y: number) => emit('blockMenu', id, x, y)"
            @insert="
                (id: string, x: number, y: number, column?: string) => emit('blockInsert', id, x, y, index, column)
            "
            @drag="(id: string, x: number, y: number) => emit('blockDrag', id, x, y)"
            @drop="(id: string, x: number, y: number) => emit('blockDrop', id, x, y)"
            @cancel="emit('blockCancel')"
        />
        <NativeFieldPlaceholders
            v-if="visible && !paintFailed && readonly && showFieldPlaceholders"
            :page="page"
            :scale="scale"
        />
        <NativeObjectBoxes
            v-if="visible && !paintFailed && labels && !readonly && (!reviewing || reviewFields)"
            :page="page"
            :active-id="activeFieldId ?? activeImageId"
            :labels="labels"
            :scale="scale"
            :floating-ids="reviewing ? [] : [...floatingFieldIds, ...floatingImageIds]"
            :fields-only="reviewing"
            :value-entry="valueEntry"
            :participants="participants"
            @value="(id: string, anchor: HTMLElement) => emit('valueField', id, anchor)"
            @select="
                (id: string, kind: 'field' | 'image') => (kind === 'field' ? emit('field', id) : emit('image', id))
            "
            @edit="
                (id: string, kind: 'field' | 'image') =>
                    kind === 'field' ? emit('editField', id) : emit('editImage', id)
            "
            @position="
                (id: string, bounds: FieldBounds, kind: 'field' | 'image') =>
                    kind === 'field'
                        ? emit('positionField', id, index, bounds)
                        : emit('positionImage', id, index, bounds)
            "
            @shortcut="(event: KeyboardEvent) => emit('fieldShortcut', event)"
        />
    </article>
</template>
