<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import { blockGutterPosition, columnGutterSide } from '@saad5400/midad/browser';
import type { NativeLabels } from '@saad5400/midad/labels';
import type { SceneColumn } from '@saad5400/midad/layout';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const ui = useEditorUi();
const Icon = useUiComponent('Icon');

const props = defineProps<{
    blocks: readonly SceneColumn[];
    scale: number;
    direction: 'ltr' | 'rtl';
    labels: NativeLabels;
    disabled: boolean;
    columns?: readonly SceneColumn[];
    contexts?: Readonly<
        Record<string, { direction: 'ltr' | 'rtl'; columns?: readonly string[]; activeColumn?: string }>
    >;
    activeId?: string;
    lockedId?: string;
    focusable?: boolean;
}>();
const emit = defineEmits<{
    menu: [id: string, x: number, y: number];
    insert: [id: string, x: number, y: number, column?: string];
    drag: [id: string, x: number, y: number];
    drop: [id: string, x: number, y: number];
    cancel: [];
}>();
const dragging = ref<string>();
const root = ref<HTMLElement>();
const hoveredId = ref<string>();
const hoverX = ref<number>();
const geometryRevision = ref(0);
let frame = 0;
let pageElement: HTMLElement | undefined;
let observer: ResizeObserver | undefined;
const clip: { element: HTMLElement; x: boolean; y: boolean }[] = [];
function schedule(): void {
    if (!frame)
        frame = requestAnimationFrame(() => {
            frame = 0;
            geometryRevision.value++;
        });
}
function hover(event: PointerEvent): void {
    if (
        event.pointerType !== 'mouse' ||
        gesture ||
        props.lockedId ||
        (event.target as HTMLElement).closest('.native-block-controls')
    )
        return;
    const bounds = pageElement!.getBoundingClientRect();
    const y = (event.clientY - bounds.top) / props.scale;
    const next = props.blocks.find((block) => y >= block.y - 6 && y <= block.y + block.height + 6);
    hoveredId.value = next?.id;
    hoverX.value = (event.clientX - bounds.left) / props.scale;
}
function leave(): void {
    if (!gesture && !props.lockedId) hoveredId.value = undefined;
}
const controls = computed(() => {
    void geometryRevision.value;
    const page = pageElement?.getBoundingClientRect();
    if (!page) return [];
    const view = window.visualViewport;
    const bounds = {
        left: (view?.offsetLeft ?? 0) + 8,
        top: (view?.offsetTop ?? 0) + 8,
        right: (view?.offsetLeft ?? 0) + (view?.width ?? innerWidth) - 8,
        bottom: (view?.offsetTop ?? 0) + (view?.height ?? innerHeight) - 8,
    };
    for (const item of clip) {
        const box = item.element.getBoundingClientRect();
        if (item.x) {
            bounds.left = Math.max(bounds.left, box.left + 4);
            bounds.right = Math.min(bounds.right, box.right - 4);
        }
        if (item.y) {
            bounds.top = Math.max(bounds.top, box.top + 4);
            bounds.bottom = Math.min(bounds.bottom, box.bottom - 4);
        }
    }
    return props.blocks.map((block, index) => {
        const context = props.contexts?.[block.id];
        const columns = (props.columns ?? []).filter((column) => context?.columns?.includes(column.id));
        const columnId =
            hoveredId.value === block.id && hoverX.value !== undefined
                ? [...columns].sort(
                      (a, b) =>
                          Math.max(0, a.x - hoverX.value!, hoverX.value! - a.x - a.width) -
                          Math.max(0, b.x - hoverX.value!, hoverX.value! - b.x - b.width),
                  )[0]?.id
                : context?.activeColumn;
        const side = columnId ? columnGutterSide(columns, columnId, context?.direction ?? props.direction) : undefined;
        const anchor = side?.column ?? block;
        const placed = blockGutterPosition(
            {
                left: page.left + anchor.x * props.scale,
                right: page.left + (anchor.x + anchor.width) * props.scale,
                top: page.top + block.y * props.scale,
                bottom: page.top + (block.y + block.height) * props.scale,
            },
            bounds,
            side?.direction ?? context?.direction ?? props.direction,
        );
        return {
            block,
            index,
            columnId,
            ...placed,
            left: placed.left - page.left,
            top: placed.top - page.top,
            active:
                hoveredId.value === block.id ||
                props.activeId === block.id ||
                props.lockedId === block.id ||
                dragging.value === block.id,
        };
    });
});
function insert(event: MouseEvent, id: string, column?: string): void {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const selectedColumn = event.detail === 0 ? (props.contexts?.[id]?.activeColumn ?? column) : column;
    emit('insert', id, box.left, box.bottom + 4, selectedColumn);
}

let gesture: { id: string; pointer: number; x: number; y: number; button: HTMLButtonElement } | undefined;
let suppressClick = false;
function start(event: PointerEvent, id: string): void {
    if (!event.isPrimary) {
        cancel();
        return;
    }
    if (event.button !== 0) return;
    cancel();
    suppressClick = false;
    const button = event.currentTarget as HTMLButtonElement;
    gesture = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, button };
    button.setPointerCapture(event.pointerId);
    button.focus({ preventScroll: true });
}
function move(event: PointerEvent): void {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    if (!dragging.value && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 6) return;
    dragging.value = gesture.id;
    suppressClick = true;
    emit('drag', gesture.id, event.clientX, event.clientY);
}
function end(event: PointerEvent): void {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const current = gesture,
        moved = !!dragging.value;
    gesture = undefined;
    dragging.value = undefined;
    if (current.button.hasPointerCapture(event.pointerId)) current.button.releasePointerCapture(event.pointerId);
    if (moved) emit('drop', current.id, event.clientX, event.clientY);
}
function click(event: MouseEvent, id: string): void {
    if (suppressClick && event.detail !== 0) {
        suppressClick = false;
        return;
    }
    suppressClick = false;
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    emit('menu', id, bounds.left, bounds.bottom + 4);
}
function cancel(): void {
    const current = gesture;
    gesture = undefined;
    dragging.value = undefined;
    if (current?.button.hasPointerCapture(current.pointer)) current.button.releasePointerCapture(current.pointer);
    if (current) emit('cancel');
}
onMounted(() => {
    window.addEventListener('blur', cancel);
    pageElement = root.value?.closest<HTMLElement>('.native-page') ?? undefined;
    for (let element = pageElement; element; element = element.parentElement ?? undefined) {
        const style = getComputedStyle(element),
            x = /(auto|scroll|hidden|clip)/.test(style.overflowX),
            y = /(auto|scroll|hidden|clip)/.test(style.overflowY);
        if (x || y) clip.push({ element, x, y });
    }
    pageElement?.addEventListener('pointermove', hover, true);
    pageElement?.addEventListener('pointerleave', leave);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    observer = new ResizeObserver(schedule);
    if (pageElement) observer.observe(pageElement);
    schedule();
});
watch([() => props.scale, () => props.disabled], cancel);
onBeforeUnmount(() => {
    window.removeEventListener('blur', cancel);
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    pageElement?.removeEventListener('pointermove', hover, true);
    pageElement?.removeEventListener('pointerleave', leave);
    observer?.disconnect();
    cancelAnimationFrame(frame);
    cancel();
});
</script>

<template>
    <div ref="root" class="native-block-handles">
        <div
            v-for="control in controls"
            :key="control.block.id"
            class="native-block-controls"
            :class="{
                'is-active': control.active,
                'is-vertical': control.vertical,
                'is-dragging': dragging === control.block.id,
            }"
            :style="{
                left: `${control.left}px`,
                top: `${control.top}px`,
                width: `${control.width}px`,
                height: `${control.height}px`,
                visibility: control.visible ? undefined : 'hidden',
            }"
            @pointerenter="hoveredId = control.block.id"
        >
            <button
                type="button"
                class="native-block-add"
                :data-block-id="control.block.id"
                :aria-label="labels.addBlock"
                :disabled="disabled"
                :tabindex="control.active || (focusable && control.index === 0) ? 0 : -1"
                @pointerdown.stop.prevent
                @mousedown.stop.prevent
                @click.stop="insert($event, control.block.id, control.columnId)"
            >
                <Icon name="add" class="size-4" aria-hidden="true" />
            </button>
            <button
                type="button"
                class="native-block-handle"
                :class="{ 'is-dragging': dragging === control.block.id }"
                :aria-label="labels.blockHandle.replace('{block}', String(control.index + 1))"
                :data-block-id="control.block.id"
                :disabled="disabled"
                :tabindex="control.active || (focusable && control.index === 0) ? 0 : -1"
                @pointerdown.stop.prevent="start($event, control.block.id)"
                @mousedown.stop.prevent
                @pointermove.stop.prevent="move"
                @pointerup.stop.prevent="end"
                @pointercancel.stop="cancel"
                @lostpointercapture.stop="gesture && cancel()"
                @click.stop="click($event, control.block.id)"
                @keydown.esc.stop.prevent="cancel"
                @contextmenu.stop.prevent="click($event, control.block.id)"
            >
                <Icon name="drag-dots" class="size-4" aria-hidden="true" />
            </button>
        </div>
    </div>
</template>
