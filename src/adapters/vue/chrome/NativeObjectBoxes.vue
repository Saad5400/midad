<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import { transformField, type FieldBounds, type FieldHandle } from '@saad5400/midad/field-placement';
import { transformImage } from '@saad5400/midad/images';
import type { NativeLabels } from '@saad5400/midad/labels';
import type { ScenePage } from '@saad5400/midad/layout';
import { objectRegions, type ObjectRegion } from '@saad5400/midad/layout';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const ui = useEditorUi();
const Icon = useUiComponent('Icon');
const NativeFieldChrome = useUiComponent('NativeFieldChrome');

const props = defineProps<{
    page: ScenePage;
    activeId?: string;
    floatingIds: readonly string[];
    labels: NativeLabels;
    scale: number;
    fieldsOnly?: boolean;
    valueEntry?: boolean;
    participants?: readonly { id: string; name: string; color?: string }[];
}>();
const emit = defineEmits<{
    select: [id: string, kind: 'field' | 'image'];
    edit: [id: string, kind: 'field' | 'image'];
    value: [id: string, anchor: HTMLElement];
    position: [id: string, bounds: FieldBounds, kind: 'field' | 'image'];
    shortcut: [event: KeyboardEvent];
}>();
const scale = computed(() => props.scale);
const handles: readonly FieldHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const handleLabels = computed(() => ({
    nw: props.labels.fieldTopLeft,
    n: props.labels.fieldTop,
    ne: props.labels.fieldTopRight,
    e: props.labels.fieldRight,
    se: props.labels.fieldBottomRight,
    s: props.labels.fieldBottom,
    sw: props.labels.fieldBottomLeft,
    w: props.labels.fieldLeft,
    move: props.labels.moveField,
}));
type ObjectBox = ObjectRegion;
const fields = computed(() => objectRegions(props.page, !props.fieldsOnly));
function empty(field: ObjectBox): boolean {
    return field.kind === 'field' && !String(field.attributes.value ?? '').trim();
}
function chrome(field: ObjectBox): Record<string, string> {
    if (!empty(field)) return {};
    return ui.fieldChrome?.(field.attributes, props.activeId === field.nodeId, props.participants) ?? {};
}
const active = computed(() => fields.value.find((field) => field.nodeId === props.activeId));
const drag = ref<{
    pointer: number;
    field: ObjectBox;
    handle: FieldHandle;
    startX: number;
    startY: number;
    bounds: FieldBounds;
}>();
let suppressedClick: string | undefined;
watch([() => props.page, scale], cancel);
function cancel(): void {
    drag.value = undefined;
    window.removeEventListener('keydown', escape, true);
}
function escape(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
}
onBeforeUnmount(cancel);
function down(event: PointerEvent, field: ObjectBox, handle: FieldHandle): void {
    if (!event.isPrimary || event.button !== 0 || !props.floatingIds.includes(field.nodeId)) return;
    emit('select', field.nodeId, field.kind);
    const target = event.currentTarget as HTMLElement;
    target.focus({ preventScroll: true });
    target.setPointerCapture(event.pointerId);
    drag.value = {
        pointer: event.pointerId,
        field,
        handle,
        startX: event.clientX,
        startY: event.clientY,
        bounds: { x: field.x, y: field.y, width: field.width, height: field.height },
    };
    window.addEventListener('keydown', escape, true);
}
function move(event: PointerEvent): void {
    if (!drag.value || drag.value.pointer !== event.pointerId) return;
    drag.value.bounds = (drag.value.field.kind === 'image' ? transformImage : transformField)(
        drag.value.field,
        drag.value.handle,
        (event.clientX - drag.value.startX) / scale.value,
        (event.clientY - drag.value.startY) / scale.value,
        props.page,
        drag.value.field.attributes.keepAspect !== false,
    );
}
function up(event: PointerEvent): void {
    if (!drag.value || drag.value.pointer !== event.pointerId) return;
    move(event);
    const { field, bounds } = drag.value;
    cancel();
    if (
        ['x', 'y', 'width', 'height'].some(
            (key) => field[key as keyof FieldBounds] !== bounds[key as keyof FieldBounds],
        )
    ) {
        suppressedClick = field.nodeId;
        setTimeout(() => {
            if (suppressedClick === field.nodeId) suppressedClick = undefined;
        }, 0);
        emit('position', field.nodeId, bounds, field.kind);
    }
}
function activate(field: ObjectBox, event: MouseEvent): void {
    if (suppressedClick === field.nodeId) {
        suppressedClick = undefined;
        return;
    }
    emit('select', field.nodeId, field.kind);
    if (field.kind === 'field' && props.valueEntry) emit('value', field.nodeId, event.currentTarget as HTMLElement);
}
function key(event: KeyboardEvent, field: ObjectBox, handle: FieldHandle = 'move'): void {
    if (event.key === 'F2' || event.key === 'Enter') {
        event.preventDefault();
        if (
            event.key === 'Enter' &&
            props.valueEntry &&
            field.kind === 'field' &&
            (event.currentTarget as HTMLElement).classList.contains('native-field-box')
        )
            emit('value', field.nodeId, event.currentTarget as HTMLElement);
        else emit('edit', field.nodeId, field.kind);
        return;
    }
    if (!props.floatingIds.includes(field.nodeId) || event.ctrlKey || event.metaKey || event.altKey) {
        emit('shortcut', event);
        return;
    }
    const step = (event.shiftKey ? 10 : 1) * 0.75;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (!dx && !dy) {
        emit('shortcut', event);
        return;
    }
    event.preventDefault();
    emit(
        'position',
        field.nodeId,
        (field.kind === 'image' ? transformImage : transformField)(
            field,
            handle,
            dx,
            dy,
            props.page,
            field.attributes.keepAspect !== false,
        ),
        field.kind,
    );
}
function style(box: FieldBounds): Record<string, string> {
    return {
        left: `${box.x * scale.value}px`,
        top: `${box.y * scale.value}px`,
        width: `${box.width * scale.value}px`,
        height: `${box.height * scale.value}px`,
    };
}
function clipStyle(field: ObjectBox): Record<string, string> {
    const { visible } = field;
    const insets = [
        visible.y - field.y,
        field.x + field.width - visible.x - visible.width,
        field.y + field.height - visible.y - visible.height,
        visible.x - field.x,
    ];
    return insets.some((value: any) => value > 0)
        ? { clipPath: `inset(${insets.map((value: any) => `${value * scale.value}px`).join(' ')})` }
        : {};
}
function handleStyle(box: FieldBounds, handle: FieldHandle): Record<string, string> {
    return {
        left: `${(box.x + box.width * (handle.includes('w') ? 0 : handle.includes('e') ? 1 : 0.5)) * scale.value + (handle.includes('w') ? -10 : handle.includes('e') ? 10 : 0)}px`,
        top: `${(box.y + box.height * (handle.includes('n') ? 0 : handle.includes('s') ? 1 : 0.5)) * scale.value + (handle.includes('n') ? -10 : handle.includes('s') ? 10 : 0)}px`,
        cursor: `${handle}-resize`,
    };
}
</script>

<template>
    <div class="native-field-boxes">
        <button
            v-for="(field, index) in fields"
            :key="`${field.kind}-${field.nodeId}-${index}`"
            type="button"
            class="native-field-box"
            :class="{ 'is-active': activeId === field.nodeId, 'is-floating': floatingIds.includes(field.nodeId) }"
            :aria-label="
                field.kind === 'field'
                    ? `${labels.editField}: ${field.attributes.name ?? field.attributes.type}`
                    : `${labels.editImage}: ${field.attributes.alt ?? ''}`
            "
            :aria-pressed="activeId === field.nodeId"
            :title="String(field.attributes.name ?? '')"
            :data-field-id="field.kind === 'field' ? field.nodeId : undefined"
            :data-type="field.kind === 'field' ? 'variable' : undefined"
            :data-id="field.kind === 'field' ? field.nodeId : undefined"
            :data-surface="field.kind === 'field' ? field.attributes.surface : undefined"
            :data-image-id="field.kind === 'image' ? field.nodeId : undefined"
            :style="{ ...style(field), ...chrome(field), ...clipStyle(field) }"
            @pointerdown.prevent.stop="down($event, field, 'move')"
            @pointermove.prevent.stop="move"
            @pointerup.prevent.stop="up"
            @pointercancel="cancel"
            @lostpointercapture="cancel"
            @mousedown.prevent.stop
            @click.stop="activate(field, $event)"
            @dblclick.stop="emit('edit', field.nodeId, field.kind)"
            @keydown.stop="key($event, field)"
        >
            <NativeFieldChrome v-if="empty(field)" :attributes="field.attributes" :scale="scale" />
        </button>
        <template v-if="active && floatingIds.includes(active.nodeId)">
            <button
                type="button"
                class="native-field-move"
                :aria-label="active.kind === 'field' ? labels.moveField : labels.moveImage"
                :style="{ left: `${active.x * scale}px`, top: `${Math.max(0, active.y * scale - 28)}px` }"
                @pointerdown.prevent.stop="down($event, active, 'move')"
                @pointermove.prevent.stop="move"
                @pointerup.prevent.stop="up"
                @pointercancel="cancel"
                @lostpointercapture="cancel"
                @mousedown.prevent.stop
                @click.stop
                @keydown.stop="key($event, active)"
            >
                <Icon name="drag-dots" class="size-4" />
            </button>
            <button
                v-for="handle in handles"
                :key="handle"
                type="button"
                class="native-field-resize"
                :aria-label="`${active.kind === 'field' ? labels.resizeField : labels.resizeImage}: ${handleLabels[handle]}`"
                :data-field-handle="handle"
                :style="handleStyle(active, handle)"
                @pointerdown.prevent.stop="down($event, active, handle)"
                @pointermove.prevent.stop="move"
                @pointerup.prevent.stop="up"
                @pointercancel="cancel"
                @lostpointercapture="cancel"
                @mousedown.prevent.stop
                @click.stop
                @keydown.stop="key($event, active, handle)"
            />
        </template>
        <div v-if="drag" class="native-field-preview" :style="style(drag.bounds)" />
    </div>
</template>
