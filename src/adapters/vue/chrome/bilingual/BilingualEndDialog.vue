<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../../ui.js';
import { computed, ref, watch } from 'vue';
import type { Lang, RowShow } from './languages.js';
import { languageList, languageName, bilingualT as t } from './languages.js';

const ui = useEditorUi();
const Button = useUiComponent('Button');
const Dialog = useUiComponent('Dialog');
const DialogContent = useUiComponent('DialogContent');
const DialogFooter = useUiComponent('DialogFooter');
const DialogHeader = useUiComponent('DialogHeader');
const DialogTitle = useUiComponent('DialogTitle');
const Label = useUiComponent('Label');
const RadioGroup = useUiComponent('RadioGroup');
const RadioGroupItem = useUiComponent('RadioGroupItem');

const props = defineProps<{
    languages: readonly Lang[];
    busy?: boolean;
    error?: string;
    managedConfirm?: boolean;
    available?: readonly Lang[];
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ confirm: [show: Exclude<RowShow, null>]; closeAutoFocus: [event: Event] }>();

const choice = ref<string>('all');

watch(open, (value: any) => {
    if (value) {
        choice.value = 'all';
    }
});

const options = computed(() => [
    ...(props.available ?? props.languages).map((lang) => ({
        value: lang,
        label: languageName(lang),
        note: t('end_only_note', { others: languageList(props.languages.filter((other) => other !== lang)) }),
    })),
    {
        value: 'all',
        label: props.languages.length === 2 ? t('end_all_two') : t('end_all_many'),
        note:
            props.languages.length === 2
                ? t('end_all_note_two', { language: languageName(props.languages[1]) })
                : t('end_all_note_many'),
    },
]);

const valid = computed(() => choice.value === 'all' || (props.available ?? props.languages).includes(choice.value));
const confirm = () => {
    if (props.busy || !valid.value) return;
    if (!props.managedConfirm) open.value = false;
    emit('confirm', choice.value);
};
</script>

<template>
    <Dialog
        :open="open"
        @update:open="
            (value: any) => {
                if (!props.busy) open = value;
            }
        "
    >
        <DialogContent
            class="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-[440px]"
            :aria-busy="props.busy"
            :aria-describedby="undefined"
            @close-auto-focus="
                (event: Event) => {
                    event.preventDefault();
                    emit('closeAutoFocus', event);
                }
            "
        >
            <DialogHeader :close-disabled="props.busy" class="sticky top-0 z-20 px-5 py-4">
                <DialogTitle class="dark:text-foreground text-start text-sm font-semibold text-gray-800">
                    {{ t('end_title') }}
                </DialogTitle>
            </DialogHeader>

            <div class="flex flex-col gap-3.5 px-5 py-[18px]">
                <p class="dark:text-muted-foreground text-xs leading-[1.9] text-gray-600">
                    {{ t('end_hint') }}
                </p>
                <RadioGroup v-model="choice" class="gap-1" :disabled="props.busy" :aria-label="t('end_title')">
                    <Label
                        v-for="option in options"
                        :key="option.value"
                        class="flex cursor-pointer items-start gap-2.5 px-0.5 py-2 font-normal"
                    >
                        <RadioGroupItem :value="option.value" class="mt-0.5" />
                        <span class="flex flex-col gap-1">
                            <span class="dark:text-foreground text-xs font-medium text-gray-800">
                                {{ option.label }}
                            </span>
                            <span class="text-2xs dark:text-muted-foreground leading-[1.7] text-gray-400">
                                {{ option.note }}
                            </span>
                        </span>
                    </Label>
                </RadioGroup>
            </div>

            <p v-if="props.error" role="alert" class="text-destructive px-5 pb-3 text-xs">
                {{ props.error }}
            </p>
            <DialogFooter class="bg-card sticky bottom-0 z-20 mx-5 justify-between px-0 pt-4 pb-5">
                <Button variant="outline" class="min-w-[88px]" :disabled="props.busy" @click="open = false">
                    {{ t('close') }}
                </Button>
                <Button :disabled="props.busy || !valid" @click="confirm">
                    {{ t('end') }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
