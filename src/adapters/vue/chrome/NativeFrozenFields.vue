<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import type { FieldAppearance } from '@saad5400/midad/field-appearance';
import type { FrozenFieldSession } from '@saad5400/midad/frozen-fields';
import type { NativeTextKernel } from '@saad5400/midad/kernel';
import NativeFieldAppearance from './NativeFieldAppearance.vue';

const ui = useEditorUi();

defineProps<{
    session: FrozenFieldSession;
    appearances: readonly FieldAppearance[];
    kernel?: NativeTextKernel;
    page: number;
    scale: number;
    activeId?: string;
    disabled?: boolean;
    color?: string;
    revision: number;
}>();
const emit = defineEmits<{ select: [id: string]; open: [id: string]; error: [error: unknown] }>();
</script>

<template>
    <div class="native-frozen-fields" :data-field-revision="revision">
        <template v-if="kernel">
            <NativeFieldAppearance
                v-for="appearance in appearances.filter((appearance) => appearance.field.page === page)"
                :key="appearance.field.id"
                :appearance="appearance"
                :kernel="kernel"
                :scale="scale"
                @error="emit('error', $event)"
            />
        </template>
        <button
            v-for="entry in session.fields.filter((entry) => entry.box.page === page && session.editable(entry.box.id))"
            :key="entry.box.id"
            type="button"
            :data-native-frozen-field="entry.box.id"
            data-type="variable"
            :data-id="entry.box.id"
            :aria-label="String(entry.field.attributes.name ?? entry.box.id)"
            :aria-pressed="activeId === entry.box.id"
            :disabled="disabled"
            class="native-frozen-field-target"
            :style="{
                left: `${entry.box.x * scale}px`,
                top: `${entry.box.y * scale}px`,
                width: `${entry.box.width * scale}px`,
                height: `${entry.box.height * scale}px`,
                borderColor: color || '#3b82f6',
            }"
            @click="
                emit('select', entry.box.id);
                emit('open', entry.box.id);
            "
            @dblclick="emit('open', entry.box.id)"
            @keydown.enter.prevent="emit('open', entry.box.id)"
        >
            <span v-if="!session.value(entry.box.id)" class="native-frozen-field-label">{{
                entry.field.attributes.name
            }}</span>
        </button>
    </div>
</template>
