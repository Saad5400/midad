<script setup lang="ts" generic="T extends CommandMenuItem<IconName>">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import type { EditorIcon as IconName } from '../ui.js';
import type { CommandMenuGroup, CommandMenuItem } from '@saad5400/midad/browser';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const ui = useEditorUi();
const EditorCommandPalette = useUiComponent('EditorCommandPalette');

const props = defineProps<{
    id: string;
    groups: readonly CommandMenuGroup<T>[];
    query: string;
    direction: 'rtl' | 'ltr';
    label: string;
    noResults: string;
    anchor: { left: number; top: number; height: number };
    host?: HTMLElement;
}>();
const emit = defineEmits<{ select: [item: T]; dismiss: [] }>();
const root = ref<HTMLElement>();
const palette = ref<{ onKeyDown: (props: { event: KeyboardEvent }) => boolean; activeId?: string }>();
const portal = computed(() => props.host?.closest('dialog') ?? document.body);
const position = ref<Record<string, string>>({ visibility: 'hidden' });
let observer: ResizeObserver | undefined;
let frame = 0;
function place(): void {
    frame = 0;
    const element = root.value,
        parent = portal.value;
    if (!element) return;
    const view = window.visualViewport;
    let left = (view?.offsetLeft ?? 0) + 8,
        top = (view?.offsetTop ?? 0) + 8;
    let right = left + (view?.width ?? innerWidth) - 16,
        bottom = top + (view?.height ?? innerHeight) - 16;
    const modal = parent instanceof HTMLDialogElement;
    const bounds = parent.getBoundingClientRect();
    if (modal) {
        left = Math.max(left, bounds.left + 8);
        top = Math.max(top, bounds.top + 8);
        right = Math.min(right, bounds.right - 8);
        bottom = Math.min(bottom, bounds.bottom - 8);
    }
    const width = Math.min(280, Math.max(0, right - left));
    const below = bottom - props.anchor.top - props.anchor.height - 4;
    const above = props.anchor.top - top - 4;
    const upwards = below < Math.min(element.scrollHeight, 240) && above > below;
    const height = Math.max(40, Math.min(420, upwards ? above : below, bottom - top));
    const x = Math.max(
        left,
        Math.min(right - width, props.direction === 'rtl' ? props.anchor.left - width : props.anchor.left),
    );
    const y = upwards
        ? Math.max(top, props.anchor.top - Math.min(element.scrollHeight, height) - 4)
        : Math.max(
              top,
              Math.min(bottom - Math.min(element.scrollHeight, height), props.anchor.top + props.anchor.height + 4),
          );
    const sx = modal && parent.offsetWidth ? bounds.width / parent.offsetWidth : 1;
    const sy = modal && parent.offsetHeight ? bounds.height / parent.offsetHeight : 1;
    position.value = {
        position: modal ? 'absolute' : 'fixed',
        left: `${modal ? (x - bounds.left) / sx - parent.clientLeft + parent.scrollLeft : x}px`,
        top: `${modal ? (y - bounds.top) / sy - parent.clientTop + parent.scrollTop : y}px`,
        width: `${width / sx}px`,
        maxHeight: `${height / sy}px`,
        visibility: 'visible',
    };
}
function schedule(): void {
    if (!frame) frame = requestAnimationFrame(place);
}
watch([() => props.anchor, () => props.query, () => props.groups], () => void nextTick(schedule));
function outside(event: PointerEvent): void {
    if (!(event.target instanceof Node) || root.value?.contains(event.target)) return;
    emit('dismiss');
}
onMounted(() => {
    observer = new ResizeObserver(schedule);
    if (root.value) observer.observe(root.value);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    document.addEventListener('pointerdown', outside, true);
    schedule();
});
onBeforeUnmount(() => {
    observer?.disconnect();
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule, true);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
    document.removeEventListener('pointerdown', outside, true);
});
defineExpose({
    onKeyDown: (event: { event: KeyboardEvent }) => palette.value?.onKeyDown(event) ?? false,
    activeId: computed(() => palette.value?.activeId),
});
</script>
<template>
    <Teleport :to="portal">
        <div ref="root" class="native-command-popup z-[110]" :style="position">
            <EditorCommandPalette
                ref="palette"
                :id="id"
                :groups="groups"
                :query="query"
                :direction="direction"
                :label="label"
                :no-results="noResults"
                :style="{ maxHeight: position.maxHeight, minWidth: '0', width: '100%' }"
                @select="emit('select', $event)"
                @dismiss="emit('dismiss')"
            />
        </div>
    </Teleport>
</template>
