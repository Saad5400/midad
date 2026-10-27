<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import type { NativeLabels } from '@saad5400/midad/labels';
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue';

const ui = useEditorUi();
const Icon = useUiComponent('Icon');

const props = defineProps<{
    labels: NativeLabels;
    index: number;
    total: number;
    top: number;
    focusToken: number;
    busy: boolean;
}>();
const query = defineModel<string>('query', { required: true });
const caseSensitive = defineModel<boolean>('caseSensitive', { required: true });
const wholeWord = defineModel<boolean>('wholeWord', { required: true });
const emit = defineEmits<{ move: [direction: -1 | 1]; close: [] }>();
const input = ref<HTMLInputElement>();
const id = useId();
const count = computed(() =>
    props.busy
        ? props.labels.updating
        : props.total
          ? props.labels.searchCount.replace(':current', String(props.index + 1)).replace(':total', String(props.total))
          : query.value
            ? props.labels.noMatches
            : '',
);
async function focus(): Promise<void> {
    await nextTick();
    input.value?.focus();
    input.value?.select();
}
onMounted(focus);
watch(() => props.focusToken, focus);
</script>

<template>
    <section
        class="native-find-panel"
        role="search"
        :aria-label="labels.find"
        :aria-busy="busy"
        :style="{ top: `${top}px` }"
        @keydown.esc.stop.prevent="emit('close')"
    >
        <div class="native-find-row">
            <label class="sr-only" :for="id">{{ labels.searchQuery }}</label>
            <input
                :id="id"
                ref="input"
                v-model="query"
                type="search"
                maxlength="1000"
                dir="auto"
                autocomplete="off"
                :placeholder="labels.searchQuery"
                @keydown.enter.stop.prevent="emit('move', $event.shiftKey ? -1 : 1)"
            />
            <output role="status" aria-live="polite" aria-atomic="true">{{ count }}</output>
            <button
                type="button"
                :aria-label="labels.previousMatch"
                :disabled="busy || !total"
                @click="emit('move', -1)"
            >
                <Icon name="chevron-up" class="size-4" />
            </button>
            <button type="button" :aria-label="labels.nextMatch" :disabled="busy || !total" @click="emit('move', 1)">
                <Icon name="chevron-down" class="size-4" />
            </button>
            <button type="button" :aria-label="labels.closeFind" @click="emit('close')">
                <Icon name="x-close" class="size-4" />
            </button>
        </div>
        <div class="native-find-options">
            <label><input v-model="caseSensitive" type="checkbox" />{{ labels.matchCase }}</label>
            <label><input v-model="wholeWord" type="checkbox" />{{ labels.wholeWord }}</label>
        </div>
    </section>
</template>
