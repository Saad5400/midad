<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../../ui.js';
import { computed, ref, watch } from 'vue';
import {
    CUSTOM,
    isCustomLang,
    langDir,
    languageList,
    languageName,
    nativeName,
    nextCustomLang,
    bilingualT as t,
    type BilingualLayoutId,
    type BilingualSettings,
    type ColumnGap,
    type Lang,
} from './languages.js';

const ui = useEditorUi();
const Button = useUiComponent('Button');
const Dialog = useUiComponent('Dialog');
const DialogContent = useUiComponent('DialogContent');
const DialogFooter = useUiComponent('DialogFooter');
const DialogHeader = useUiComponent('DialogHeader');
const DialogTitle = useUiComponent('DialogTitle');
const DropdownMenu = useUiComponent('DropdownMenu');
const DropdownMenuContent = useUiComponent('DropdownMenuContent');
const DropdownMenuItem = useUiComponent('DropdownMenuItem');
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger');
const Switch = useUiComponent('Switch');
const Tabs = useUiComponent('Tabs');
const TabsList = useUiComponent('TabsList');
const TabsTrigger = useUiComponent('TabsTrigger');
const Icon = useUiComponent('Icon');

const props = defineProps<{
    settings: BilingualSettings;
    offered: readonly Lang[];
    dir: 'rtl' | 'ltr';
    written: readonly Lang[];
    busy?: boolean;
    error?: string;
    applyDisabled?: boolean;
    managedSave?: boolean;
    dropped?: readonly Lang[];
    scopeLabel?: string;
    singleLanguages?: readonly Lang[];
    noSplitDisabled?: boolean;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{
    save: [settings: BilingualSettings, confirmed: readonly Lang[]];
    draftChange: [settings: BilingualSettings];
    closeAutoFocus: [event: Event];
}>();

const layout = ref<BilingualLayoutId>('two');
const gap = ref<ColumnGap>('sm');
const divider = ref(true);
const draft = ref<Lang[]>([]);

watch(
    open,
    (value: any) => {
        if (!value) {
            return;
        }
        const { languages } = props.settings;
        layout.value = props.settings.layout === 'none' ? 'two' : props.settings.layout;
        gap.value = props.settings.gap;
        divider.value = props.settings.divider;
        draft.value = [...languages.slice(0, 3)];
        while (draft.value.length < 3) {
            draft.value.push(nextCustomLang(draft.value));
        }
    },
    { immediate: true },
);

const openColumn = ref<number | null>(null);
const narrowRight = computed(() => (props.dir === 'rtl' ? 'narrow-start' : 'narrow-end'));

const layouts = computed(() =>
    (['none', 'two', 'three', 'narrow-start', 'narrow-end'] as BilingualLayoutId[]).map((id) => ({
        id,
        label:
            id === 'narrow-start' || id === 'narrow-end'
                ? t(id === narrowRight.value ? 'layout_narrow_right' : 'layout_narrow_left')
                : t(`layout_${id}`),
        path:
            id === 'two'
                ? 'M10 3v14'
                : id === 'three'
                  ? 'M7.67 3v14M12.33 3v14'
                  : id === 'none'
                    ? ''
                    : id === narrowRight.value
                      ? 'M12.5 3v14'
                      : 'M7.5 3v14',
    })),
);

const count = computed(() => (layout.value === 'none' ? 1 : layout.value === 'three' ? 3 : 2));

// A language picked in one column can't repeat in another; only custom columns may.
const columns = computed<Lang[]>(() => {
    const seen: Lang[] = [];
    draft.value.slice(0, count.value).forEach((lang) => {
        seen.push(seen.includes(lang) ? nextCustomLang([...seen, ...draft.value]) : lang);
    });

    return seen;
});

const weights = computed(() =>
    layout.value === 'narrow-start' ? [1, 2] : layout.value === 'narrow-end' ? [2, 1] : columns.value.map(() => 1),
);

const optionsFor = (index: number) => {
    const others = columns.value.filter((_, at) => at !== index);

    const offered =
        layout.value === 'none' && props.singleLanguages
            ? [...props.singleLanguages]
            : [CUSTOM, ...[...props.settings.languages, ...props.offered].filter((lang) => !isCustomLang(lang))];
    const unique = offered.filter(
        (lang, index) => offered.findIndex((other) => other.toLowerCase() === lang.toLowerCase()) === index,
    );
    return unique
        .filter((lang) => !others.some((other) => other.toLowerCase() === lang.toLowerCase()))
        .map((lang) => ({
            value: lang,
            name: languageName(lang),
            native: nativeName(lang),
            selected: lang === CUSTOM ? isCustomLang(columns.value[index]) : columns.value[index] === lang,
        }));
};

const pick = (index: number, lang: Lang) => {
    const next = [...columns.value, ...draft.value.slice(count.value)];
    if (lang !== CUSTOM) {
        next[index] = lang;
    } else if (!isCustomLang(next[index])) {
        next[index] = nextCustomLang(next.filter((_, at) => at !== index));
    }
    draft.value = next;
};

// Columns being dropped whose text would go with them.
const dropped = computed(
    () =>
        props.dropped ??
        (layout.value === 'none'
            ? []
            : props.settings.languages.filter((lang) => props.written.includes(lang) && !columns.value.includes(lang))),
);

const LINES = ['100%', '80%', '100%', '62%', '100%', '62%', '100%', '62%', '100%', '80%', '100%', '62%'];

const candidate = computed<BilingualSettings>(() => ({
    layout: layout.value,
    languages: [...columns.value],
    divider: divider.value,
    widths: layout.value === 'narrow-start' || layout.value === 'narrow-end' ? layout.value : 'even',
    gap: gap.value,
}));
watch(candidate, (value: any) => emit('draftChange', value), { immediate: true });
const save = () => {
    if (props.busy || props.applyDisabled) return;
    if (!props.managedSave) open.value = false;
    emit('save', candidate.value, [...dropped.value]);
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
            class="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-[480px]"
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
                    {{ t('settings') }}
                </DialogTitle>
            </DialogHeader>

            <fieldset :disabled="props.busy" class="flex min-w-0 flex-col gap-[18px] px-5 pt-5">
                <div class="flex items-center justify-between gap-3">
                    <span class="dark:text-foreground text-xs text-gray-800">{{ t('layout_label') }}</span>
                    <Tabs v-model="layout" variant="panel">
                        <TabsList class="h-auto w-auto gap-0.5">
                            <TabsTrigger
                                v-for="option in layouts"
                                :key="option.id"
                                v-tooltip:bottom="option.label"
                                :value="option.id"
                                :disabled="props.busy || (option.id === 'none' && props.noSplitDisabled)"
                                :aria-label="option.label"
                                class="h-[30px] w-[38px] px-0 py-0"
                            >
                                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                                    <rect
                                        x="3"
                                        y="3"
                                        width="14"
                                        height="14"
                                        rx="3"
                                        stroke="currentColor"
                                        stroke-width="1.4"
                                    />
                                    <path
                                        v-if="option.path"
                                        :d="option.path"
                                        stroke="currentColor"
                                        stroke-width="1.4"
                                    />
                                </svg>
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>

                <template v-if="layout !== 'none'">
                    <div class="flex items-center justify-between gap-3">
                        <span class="dark:text-foreground text-xs text-gray-800">{{ t('gap_label') }}</span>
                        <Tabs v-model="gap" variant="panel">
                            <TabsList class="h-auto w-auto gap-0.5">
                                <TabsTrigger
                                    v-for="option in ['sm', 'lg']"
                                    :key="option"
                                    :value="option"
                                    :disabled="props.busy"
                                    class="h-[30px] px-4 py-0"
                                >
                                    {{ t(`gap_${option}`) }}
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </div>
                    <label class="flex cursor-pointer items-center justify-between gap-3">
                        <span class="dark:text-foreground text-xs text-gray-800">{{ t('divider_label') }}</span>
                        <Switch v-model="divider" :disabled="props.busy" :aria-label="t('divider_label')" />
                    </label>
                </template>

                <slot name="options" :languages="columns" />
                <div
                    class="dark:border-border grid min-h-[230px] overflow-clip rounded-[10px] border border-gray-100"
                    :style="{ gridTemplateColumns: weights.map((w) => `minmax(0, ${w}fr)`).join(' ') }"
                    :dir="dir"
                >
                    <div
                        v-for="(lang, index) in columns"
                        :key="index"
                        class="dark:border-border flex min-w-0 flex-col gap-2.5 pb-5"
                        :class="[
                            divider && index < columns.length - 1 ? 'border-e border-gray-100' : '',
                            layout !== 'none' && gap === 'lg' ? 'px-[34px]' : 'px-[22px]',
                        ]"
                    >
                        <DropdownMenu :open="openColumn === index" @update:open="openColumn = $event ? index : null">
                            <DropdownMenuTrigger as-child>
                                <button
                                    type="button"
                                    :aria-label="t('column_language', { number: String(index + 1) })"
                                    :disabled="props.busy"
                                    class="dark:border-border dark:bg-muted dark:text-foreground dark:hover:bg-accent dark:data-[state=open]:bg-accent mb-2 flex h-10 items-center justify-center gap-1.5 border-b border-gray-100 bg-gray-50 text-xs font-medium whitespace-nowrap text-gray-800 hover:bg-gray-100 data-[state=open]:bg-gray-100 [&[data-state=open]>svg]:rotate-180"
                                    :class="layout !== 'none' && gap === 'lg' ? '-mx-[34px]' : '-mx-[22px]'"
                                >
                                    <span class="truncate">{{ languageName(lang) }}</span>
                                    <Icon
                                        name="chevron-down"
                                        class="dark:text-muted-foreground size-2.5 shrink-0 text-gray-500 transition-transform"
                                    />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                @escape-key-down.prevent="openColumn = null"
                                align="center"
                                class="max-h-60 w-[max(var(--reka-dropdown-menu-trigger-width),168px)] max-w-[220px] rounded-[10px] p-1.5"
                            >
                                <DropdownMenuItem
                                    v-for="option in optionsFor(index)"
                                    :key="option.value"
                                    class="flex items-center gap-2.5 rounded-md px-2.5 py-2"
                                    :class="option.selected ? 'bg-brand-25 dark:bg-primary/10' : ''"
                                    @select="pick(index, option.value)"
                                >
                                    <span class="flex flex-1 flex-col gap-px">
                                        <span
                                            class="dark:text-foreground text-xs text-gray-800"
                                            :class="option.selected ? 'font-medium' : ''"
                                        >
                                            {{ option.name }}
                                        </span>
                                        <span class="text-2xs dark:text-muted-foreground text-gray-400">
                                            {{ option.native }}
                                        </span>
                                    </span>
                                    <Icon
                                        v-if="option.selected"
                                        name="check"
                                        class="text-brand-600 dark:text-primary size-[15px] shrink-0"
                                    />
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <div :dir="langDir(lang, dir)" class="flex flex-col items-start gap-[9px]" aria-hidden="true">
                            <span
                                v-for="(width, line) in LINES"
                                :key="line"
                                class="dark:bg-foreground/15 block h-[3px] rounded-[3px] bg-gray-200"
                                :style="{ width }"
                            />
                        </div>
                    </div>
                </div>
            </fieldset>

            <p
                v-if="dropped.length > 0"
                class="mx-5 mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs leading-[1.8] text-red-700 dark:bg-red-500/10 dark:text-red-300"
            >
                {{
                    props.scopeLabel
                        ? t('drop_warning_scope', { languages: languageList([...dropped]), scope: props.scopeLabel })
                        : t('drop_warning', { languages: languageList([...dropped]) })
                }}
            </p>

            <p v-if="props.error" role="alert" class="text-destructive px-5 pt-4 text-xs">
                {{ props.error }}
            </p>
            <DialogFooter class="bg-card sticky bottom-0 z-20 mx-5 mt-5 justify-between px-0 pt-4 pb-5">
                <Button variant="outline" class="min-w-[88px]" :disabled="props.busy" @click="open = false">
                    {{ t('cancel') }}
                </Button>
                <Button
                    class="min-w-[88px]"
                    :variant="dropped.length > 0 ? 'destructive' : 'default'"
                    :disabled="props.busy || props.applyDisabled"
                    @click="save"
                >
                    {{ dropped.length > 0 ? t('save_and_delete') : t('save') }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
