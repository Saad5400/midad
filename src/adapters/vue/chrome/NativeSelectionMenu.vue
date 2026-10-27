<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import type { BlockContext } from '@saad5400/midad/blocks';
import type { NativeLabels } from '@saad5400/midad/labels';
import { onBeforeUnmount, onMounted, ref } from 'vue';

const ui = useEditorUi();
const Icon = useUiComponent('Icon');

export type ClipboardAction = 'copy' | 'cut' | 'paste' | 'pastePlain' | 'selectAll';
export type BlockAction = 'up' | 'down' | 'delete' | 'unwrap';
defineProps<{
    labels: NativeLabels;
    left: number;
    top: number;
    readonly: boolean;
    selected: boolean;
    busy: boolean;
    block?: BlockContext;
    blockOnly?: boolean;
    horizontal?: boolean;
}>();
const emit = defineEmits<{
    action: [action: ClipboardAction];
    block: [action: BlockAction];
    close: [];
    shortcut: [event: KeyboardEvent];
    size: [height: number];
}>();
const root = ref<HTMLElement>();
let observer: ResizeObserver | undefined;
onMounted(() => {
    const measure = () => emit('size', root.value!.getBoundingClientRect().height);
    observer = new ResizeObserver(measure);
    observer.observe(root.value!);
    measure();
});
onBeforeUnmount(() => observer?.disconnect());

function key(event: KeyboardEvent): void {
    const shortcut = event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
    if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        ['a', 'b', 'c', 'i', 'k', 'u', 'v', 'x', 'y', 'z'].includes(shortcut)
    ) {
        emit('close');
        emit('shortcut', event);
        return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...root.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const direction = getComputedStyle(root.value!).direction === 'rtl' ? -1 : 1;
    const next =
        event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (index +
                    (event.key === 'ArrowUp'
                        ? -1
                        : event.key === 'ArrowDown'
                          ? 1
                          : event.key === 'ArrowLeft'
                            ? -direction
                            : direction) +
                    buttons.length) %
                buttons.length;
    buttons[next]?.focus();
}

defineExpose({ focus: () => root.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus() });
</script>

<template>
    <div
        ref="root"
        class="native-selection-menu"
        :class="{ 'is-horizontal': horizontal }"
        role="toolbar"
        :aria-orientation="horizontal ? 'horizontal' : 'vertical'"
        :aria-label="labels.selectionActions"
        :style="{
            left: `${left}px`,
            top: `${top}px`,
            maxWidth: `calc(100vw - ${left + 8}px)`,
            maxHeight: `calc(100vh - ${top + 8}px)`,
            overflow: 'auto',
        }"
        @pointerdown.prevent
        @keydown="key"
        @keydown.esc.stop.prevent="emit('close')"
    >
        <button v-if="!blockOnly" type="button" :disabled="!selected || busy" @click="emit('action', 'copy')">
            <Icon name="copy" class="text-muted-foreground size-4 shrink-0" />
            {{ labels.copy }}
        </button>
        <button
            v-if="!readonly && !blockOnly"
            type="button"
            :disabled="!selected || busy"
            @click="emit('action', 'cut')"
        >
            <Icon name="scissors-cut" class="text-muted-foreground size-4 shrink-0" />
            {{ labels.cut }}
        </button>
        <button v-if="!readonly && !blockOnly" type="button" :disabled="busy" @click="emit('action', 'paste')">
            <Icon name="clipboard" class="text-muted-foreground size-4 shrink-0" />
            {{ labels.paste }}
        </button>
        <button v-if="!blockOnly" type="button" :disabled="busy" @click="emit('action', 'selectAll')">
            <span class="size-4 shrink-0" aria-hidden="true" />
            {{ labels.selectAll }}
        </button>
        <div
            v-if="block && !readonly"
            class="native-block-actions"
            :class="{ 'is-only': blockOnly }"
            role="group"
            :aria-label="labels.blockActions"
        >
            <button type="button" :disabled="busy || !block.canMoveUp" @click="emit('block', 'up')">
                <Icon name="arrow-up" class="text-muted-foreground size-4 shrink-0" />
                {{ labels.moveBlockUp }}
            </button>
            <button type="button" :disabled="busy || !block.canMoveDown" @click="emit('block', 'down')">
                <Icon name="arrow-down" class="text-muted-foreground size-4 shrink-0" />
                {{ labels.moveBlockDown }}
            </button>
            <button v-if="block.node.kind === 'clause'" type="button" :disabled="busy" @click="emit('block', 'unwrap')">
                <Icon name="lamp-charge" class="text-muted-foreground size-4 shrink-0" />
                {{ labels.unwrapClause }}
            </button>
            <button type="button" class="text-destructive" :disabled="busy" @click="emit('block', 'delete')">
                <Icon name="trash-01" class="size-4 shrink-0" />
                {{ labels.deleteBlock }}
            </button>
        </div>
    </div>
</template>
