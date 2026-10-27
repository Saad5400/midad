<script setup lang="ts" generic="Scope extends string">
import { useEditorUi, useUiComponent, useUiText } from '../../ui.js';
import { bilingualT as t, type BilingualFill } from './languages.js';

const ui = useEditorUi();
const Button = useUiComponent('Button');
const Label = useUiComponent('Label');
const RadioGroup = useUiComponent('RadioGroup');
const RadioGroupItem = useUiComponent('RadioGroupItem');
const Tabs = useUiComponent('Tabs');
const TabsList = useUiComponent('TabsList');
const TabsTrigger = useUiComponent('TabsTrigger');
const Icon = useUiComponent('Icon');

const props = defineProps<{
    description: string;
    scopes: readonly { value: Scope; label: string; note?: string; disabled?: boolean }[];
    canTranslate: boolean;
    isSplit: boolean;
    canEnd: boolean;
    busy?: boolean;
    error?: string;
}>();
const fill = defineModel<BilingualFill>('fill', { required: true });
const scope = defineModel<Scope>('scope', { required: true });
const emit = defineEmits<{ settings: []; apply: []; end: [] }>();
</script>

<template>
    <div class="flex flex-col gap-3" :aria-busy="props.busy">
        <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between gap-2.5">
                <span class="dark:text-foreground text-sm font-semibold text-gray-800">{{ t('title') }}</span>
                <button
                    v-tooltip:bottom="t('settings')"
                    type="button"
                    :aria-label="t('settings')"
                    class="dark:border-border dark:bg-muted dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground grid size-[30px] shrink-0 place-items-center rounded-lg border border-gray-100 bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                    :disabled="props.busy"
                    @click="emit('settings')"
                >
                    <Icon name="settings-4" class="size-4" />
                </button>
            </div>
            <p class="text-2xs dark:text-muted-foreground leading-[1.8] text-gray-400">
                {{ props.description }}
            </p>
        </div>

        <Tabs v-model="fill" variant="panel">
            <TabsList class="dark:border-border h-auto border border-gray-100">
                <TabsTrigger
                    v-tooltip:bottom="props.canTranslate ? '' : t('fill_auto_unavailable')"
                    value="auto"
                    :disabled="props.busy || !props.canTranslate"
                >
                    {{ t('fill_auto') }}
                </TabsTrigger>
                <TabsTrigger value="manual" :disabled="props.busy">
                    {{ t('fill_manual') }}
                </TabsTrigger>
            </TabsList>
        </Tabs>

        <RadioGroup v-model="scope" class="gap-0" :disabled="props.busy" :aria-label="t('scope_label')">
            <Label
                v-for="option in props.scopes"
                :key="option.value"
                class="flex cursor-pointer items-center gap-2.5 px-0.5 py-2 font-normal"
            >
                <RadioGroupItem :value="option.value" :disabled="option.disabled" />
                <span class="dark:text-foreground text-xs text-gray-800">{{ option.label }}</span>
                <span v-if="option.note" class="text-2xs dark:text-muted-foreground text-gray-400">
                    {{ option.note }}
                </span>
            </Label>
        </RadioGroup>

        <div class="mt-1 flex items-center justify-between gap-2">
            <Button class="h-9 rounded-[9px] px-[18px] text-xs" :disabled="props.busy" @click="emit('apply')">
                {{ t('apply') }}
            </Button>
            <Button
                v-if="props.isSplit"
                variant="outline"
                class="h-9 rounded-[9px] px-4 text-xs font-normal"
                :disabled="props.busy || !props.canEnd"
                @click="emit('end')"
            >
                {{ t('end') }}
            </Button>
        </div>
        <slot />
        <p v-if="props.error" role="alert" class="text-destructive text-xs">
            {{ props.error }}
        </p>
    </div>
</template>
