<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import BilingualEndDialog from './bilingual/BilingualEndDialog.vue';
import BilingualPopoverContent from './bilingual/BilingualPopoverContent.vue';
import BilingualSettingsDialog from './bilingual/BilingualSettingsDialog.vue';
import {
    languageList,
    languageName,
    bilingualT as t,
    type BilingualFill,
    type BilingualSettings,
} from './bilingual/languages.js';
import type { BilingualOptions, BilingualScope, BilingualScopeState } from '@saad5400/midad/bilingual';
import type { BilingualTranslationStatus } from '@saad5400/midad/bilingual-runner';
import type { NativeLabels } from '@saad5400/midad/labels';
import { computed, nextTick, ref, watch } from 'vue';

const ui = useEditorUi();
const Button = useUiComponent('Button');
const Popover = useUiComponent('Popover');
const PopoverAnchor = useUiComponent('PopoverAnchor');
const PopoverContent = useUiComponent('PopoverContent');
const Select = useUiComponent('Select');
const SelectContent = useUiComponent('SelectContent');
const SelectItem2 = useUiComponent('SelectItem2');
const SelectTrigger2 = useUiComponent('SelectTrigger2');

const props = defineProps<{
    initial: BilingualOptions;
    initialStage?: 'settings';
    labels: NativeLabels;
    locale: 'ar' | 'en';
    direction: 'rtl' | 'ltr';
    languages: readonly string[];
    busy: boolean;
    error: string;
    selected: boolean;
    hasSelection: boolean;
    revision: number;
    anchor?: HTMLElement;
    split: boolean;
    canTranslate?: boolean;
    translationStatus?: BilingualTranslationStatus;
    translationMessage?: string;
    state: (scope: BilingualScope['kind']) => BilingualScopeState;
    drop: (options: BilingualOptions, scope: BilingualScope['kind']) => readonly string[];
}>();
const emit = defineEmits<{
    apply: [
        options: BilingualOptions,
        scope: BilingualScope['kind'],
        confirmed: readonly string[],
        operation: 'split' | 'settings' | 'settings-display' | 'end' | 'display',
    ];
    close: [];
    popup: [id: string];
    preview: [scope: BilingualScope['kind'] | null];
    retry: [scope: BilingualScope['kind']];
}>();
const stage = ref<'popover' | 'settings' | 'end'>(props.initialStage ?? 'popover');
const scope = ref<BilingualScope['kind']>(props.hasSelection ? 'selection' : 'document');
watch(
    [scope, stage],
    ([kind, view]) => emit('preview', view === 'popover' && ['clause', 'selection'].includes(kind) ? kind : null),
    { immediate: true },
);
const fill = ref<BilingualFill>(props.canTranslate && props.initial.fill !== 'manual' ? 'auto' : 'manual');
const source = ref(props.initial.source ?? 'auto');
const view = ref('preserve');
const sourceOpen = ref(false);
const viewOpen = ref(false);
const base = computed<BilingualSettings>(() => ({
    layout:
        props.initial.languages.length === 3 ? 'three' : props.initial.widths === 'even' ? 'two' : props.initial.widths,
    languages: [...props.initial.languages],
    widths: props.initial.widths,
    gap: props.initial.gap,
    divider: props.initial.divider,
}));
const draft = ref<BilingualSettings>(base.value);
const summary = computed(() => {
    void props.revision;
    try {
        return { data: props.state(scope.value), failed: false };
    } catch {
        return { data: undefined, failed: true };
    }
});
const choices = computed(() => [
    { value: 'document' as const, label: t('scope_document') },
    { value: 'page' as const, label: t('scope_page') },
    { value: 'clause' as const, label: t('scope_clause'), note: t('scope_clause_note'), disabled: !props.selected },
    { value: 'selection' as const, label: props.labels.scopeSelection, disabled: !props.selected },
]);
const scopeLabel = computed(() => choices.value.find((choice) => choice.value === scope.value)?.label ?? '');
const description = computed(() =>
    props.initial.languages.length === 2
        ? t(`description_${props.direction}`, {
              first: languageName(props.initial.languages[0]),
              second: languageName(props.initial.languages[1]),
          })
        : t('description_many', { languages: languageList([...props.initial.languages]) }),
);
const currentLanguages = computed(() =>
    summary.value.data?.languages.length ? summary.value.data.languages : props.initial.languages,
);
const options = computed<BilingualOptions>(() => ({
    languages: draft.value.layout === 'none' ? [...currentLanguages.value] : [...draft.value.languages],
    widths: draft.value.widths,
    gap: draft.value.gap,
    divider: draft.value.divider,
    show: ['preserve', 'columns'].includes(view.value) ? null : view.value === 'stacked' ? 'all' : view.value,
    source: source.value,
    fill: fill.value,
}));
const dropped = computed(() => {
    void props.revision;
    try {
        return { data: draft.value.layout === 'none' ? [] : props.drop(options.value, scope.value), failed: false };
    } catch {
        return { data: [], failed: true };
    }
});
watch(
    () => draft.value.languages,
    (languages) => {
        if (source.value !== 'auto' && !languages.includes(source.value)) source.value = 'auto';
        if (!['preserve', 'columns', 'stacked'].includes(view.value) && !languages.includes(view.value))
            view.value = 'columns';
    },
);
function close(): void {
    if (!props.busy) emit('close');
}
function setStage(value: 'settings' | 'end'): void {
    if (!props.busy) stage.value = value;
}
function saveSettings(settings: BilingualSettings, confirmed: readonly string[]): void {
    if (props.busy || summary.value.failed || dropped.value.failed) return;
    draft.value = settings;
    if (settings.layout === 'none') {
        emit('apply', { ...options.value, show: settings.languages[0] }, scope.value, [], 'display');
    } else
        emit(
            'apply',
            options.value,
            scope.value,
            confirmed,
            view.value === 'preserve' ? 'settings' : 'settings-display',
        );
}
function end(show: string): void {
    emit('apply', { ...options.value, languages: [...currentLanguages.value], show }, scope.value, [], 'end');
}
const panel = ref<HTMLElement>();
async function focusPanel(event: Event): Promise<void> {
    event.preventDefault();
    await nextTick();
    const popup = panel.value?.closest<HTMLElement>('[data-bilingual-popover]');
    if (popup && stage.value === 'popover') {
        emit('popup', popup.id);
        popup.focus({ preventScroll: true });
    }
}
</script>

<template>
    <div>
        <Popover
            :open="stage === 'popover'"
            @update:open="
                (open: boolean) => {
                    if (!open && stage === 'popover') close();
                }
            "
        >
            <PopoverAnchor :reference="anchor" />
            <PopoverContent
                align="end"
                :side-offset="8"
                :collision-padding="8"
                tabindex="-1"
                data-bilingual-popover
                :aria-label="t('title')"
                @open-auto-focus="focusPanel"
                @focus-outside.prevent
                @escape-key-down="
                    (event: Event) => {
                        if (busy) event.preventDefault();
                    }
                "
                @pointer-down-outside="
                    (event: Event) => {
                        if (busy) event.preventDefault();
                    }
                "
                @close-auto-focus.prevent
                class="dark:border-border flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-3 rounded-xl border-gray-100 p-[18px] shadow-[0_16px_40px_rgba(16,24,40,0.12)]"
            >
                <div ref="panel">
                    <BilingualPopoverContent
                        v-model:fill="fill"
                        v-model:scope="scope"
                        :description="description"
                        :scopes="choices"
                        :can-translate="!!canTranslate"
                        :is-split="split"
                        :can-end="!!summary.data?.canEnd"
                        :busy="busy"
                        :error="error || (summary.failed ? labels.invalidBilingual : '')"
                        @settings="setStage('settings')"
                        @end="setStage('end')"
                        @apply="emit('apply', { ...initial, fill, source, show: null }, scope, [], 'split')"
                    >
                        <p
                            v-if="translationMessage"
                            :role="translationStatus?.failed ? 'alert' : 'status'"
                            class="text-muted-foreground text-xs"
                        >
                            {{ translationMessage }}
                        </p>
                        <Button
                            v-if="
                                translationStatus &&
                                !translationStatus.pending &&
                                (translationStatus.failed || translationStatus.tooLong)
                            "
                            variant="outline"
                            size="sm"
                            @click="emit('retry', scope)"
                            >{{ labels.retry }}</Button
                        >
                    </BilingualPopoverContent>
                </div>
            </PopoverContent>
        </Popover>
        <BilingualSettingsDialog
            v-if="stage === 'settings'"
            :open="true"
            :settings="base"
            :offered="languages"
            :written="summary.data?.written ?? []"
            :single-languages="summary.data?.hasRows ? summary.data.availableAll : initial.languages"
            :no-split-disabled="!!summary.data?.hasRows && !summary.data.availableAll.length"
            :dir="direction"
            :scope-label="scopeLabel"
            :dropped="dropped.data"
            :busy="busy"
            :error="error || (summary.failed || dropped.failed ? labels.invalidBilingual : '')"
            :apply-disabled="summary.failed || dropped.failed"
            managed-save
            @draft-change="draft = $event"
            @save="saveSettings"
            @update:open="
                (open: boolean) => {
                    if (!open) close();
                }
            "
        >
            <template #options="slot">
                <div class="grid gap-3 text-xs">
                    <p class="text-muted-foreground">{{ labels.bilingualScope }}: {{ scopeLabel }}</p>
                    <label class="grid gap-2"
                        >{{ labels.sourceLanguage }}
                        <Select v-model="source" v-model:open="sourceOpen" :disabled="busy"
                            ><SelectTrigger2 :aria-label="labels.sourceLanguage" variant="bordered"
                                ><span>{{
                                    source === 'auto' ? labels.sourceAuto : languageName(source)
                                }}</span></SelectTrigger2
                            ><SelectContent @escape-key-down.prevent="sourceOpen = false"
                                ><SelectItem2 value="auto">{{ labels.sourceAuto }}</SelectItem2
                                ><SelectItem2 v-for="language in slot.languages" :key="language" :value="language">{{
                                    languageName(language)
                                }}</SelectItem2></SelectContent
                            ></Select
                        >
                    </label>
                    <label class="grid gap-2"
                        >{{ labels.columnView }}
                        <Select v-model="view" v-model:open="viewOpen" :disabled="busy"
                            ><SelectTrigger2 :aria-label="labels.columnView" variant="bordered"
                                ><span>{{
                                    view === 'preserve'
                                        ? t('preserve_display')
                                        : view === 'columns'
                                          ? labels.viewParallel
                                          : view === 'stacked'
                                            ? labels.viewStacked
                                            : languageName(view)
                                }}</span></SelectTrigger2
                            ><SelectContent @escape-key-down.prevent="viewOpen = false"
                                ><SelectItem2 value="preserve">{{ t('preserve_display') }}</SelectItem2
                                ><SelectItem2 value="columns">{{ labels.viewParallel }}</SelectItem2
                                ><SelectItem2 value="stacked">{{ labels.viewStacked }}</SelectItem2
                                ><SelectItem2 v-for="language in slot.languages" :key="language" :value="language">{{
                                    languageName(language)
                                }}</SelectItem2></SelectContent
                            ></Select
                        >
                    </label>
                </div>
            </template>
        </BilingualSettingsDialog>
        <BilingualEndDialog
            v-if="stage === 'end'"
            :open="true"
            :languages="summary.data?.endLanguages ?? []"
            :available="summary.data?.available ?? []"
            :busy="busy"
            :error="error"
            managed-confirm
            @confirm="end"
            @update:open="
                (open: boolean) => {
                    if (!open) close();
                }
            "
        />
    </div>
</template>
