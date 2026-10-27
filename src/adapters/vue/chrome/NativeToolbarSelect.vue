<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import { computed, ref } from 'vue';
import { keepEditingFocus } from './toolbar.js';

const ui = useEditorUi();
const Select = useUiComponent('Select');
const SelectContent = useUiComponent('SelectContent');
const SelectGroup = useUiComponent('SelectGroup');
const SelectItem2 = useUiComponent('SelectItem2');
const SelectTrigger2 = useUiComponent('SelectTrigger2');

const props = defineProps<{
    label: string;
    modelValue: string;
    options: readonly { value: string; label: string }[];
    disabled?: boolean;
    placeholder?: string;
    previewFont?: boolean;
    portalTo?: HTMLElement;
}>();
const emit = defineEmits<{ change: [value: string] }>();
const selected = computed(
    () => props.options.find((item) => item.value === props.modelValue)?.label ?? props.placeholder,
);
const applied = ref(false);
const open = ref(false);
function apply(value: unknown): void {
    if (typeof value !== 'string' || props.disabled) return;
    applied.value = true;
    emit('change', value);
}
function restoreFocus(event: Event): void {
    keepEditingFocus(event);
    if (applied.value) event.preventDefault();
}
</script>

<template>
    <Select
        v-model:open="open"
        :model-value="modelValue"
        :disabled="disabled"
        @update:model-value="apply"
        @update:open="(open: boolean) => open && (applied = false)"
    >
        <SelectTrigger2
            :aria-label="label"
            :title="label"
            class="dark:border-border h-8 min-w-26 rounded-md border border-gray-100 ps-4 pe-2"
        >
            <span class="inline-block min-w-18 text-start">{{ selected }}</span>
        </SelectTrigger2>
        <SelectContent :portal-to="portalTo" @escape-key-down.prevent="open = false" @close-auto-focus="restoreFocus">
            <SelectGroup>
                <SelectItem2 v-for="item in options" :key="item.value" :value="item.value">
                    <span class="text-xs" :style="previewFont ? { fontFamily: item.value } : undefined">{{
                        item.label
                    }}</span>
                </SelectItem2>
            </SelectGroup>
        </SelectContent>
    </Select>
</template>
