<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import type { EditorIcon as IconName } from '../ui.js';
import type { ToolGroup } from './toolbar.js';
import { normalizeLink, type BlockFormat, type FormatCommand } from '@saad5400/midad/formatting';
import type { ListKind } from '@saad5400/midad/lists';
import type { TableCommand } from '@saad5400/midad/tables';
import { computed, nextTick, ref } from 'vue';
import NativeToolbarGroup from './NativeToolbarGroup.vue';
import { keepEditingFocus, type NativeToolbarActions, type NativeToolbarState } from './toolbar.js';

const ui = useEditorUi();
const Popover = useUiComponent('Popover');
const PopoverContent = useUiComponent('PopoverContent');
const PopoverTrigger = useUiComponent('PopoverTrigger');
const Icon = useUiComponent('Icon');
const PagesPanelToggle = useUiComponent('PagesPanelToggle');
const EditorToolStrip = useUiComponent('EditorToolStrip');

const toolbarUi = ui.toolbar ?? { button: () => '', row: () => '', chevron: '', provideRows: () => {} };
const TOOL_CHEVRON_CLASS = toolbarUi.chevron;
const toolButtonClass = toolbarUi.button;
const toolRowClass = toolbarUi.row;
const provideToolRows = toolbarUi.provideRows;
const trans = useUiText();

const props = defineProps<NativeToolbarState>();
const element = ref<HTMLElement>();
const portalTarget = computed(() => element.value?.closest('dialog') ?? undefined);
const emit = defineEmits<{
    format: [command: FormatCommand, focusEditor?: boolean];
    block: [patch: BlockFormat];
    focus: [];
    list: [kind: ListKind];
    table: [command: TableCommand];
    insertTable: [rows: number, columns: number, header: boolean];
    indent: [lift: boolean];
    cells: [];
    merge: [];
    split: [];
    insertField: [];
    editField: [];
    insertImage: [];
    editImage: [];
    undo: [];
    redo: [];
    export: [];
    print: [];
    find: [];
    pageSetup: [];
    bilingual: [];
    clauses: [];
    outline: [];
    zoom: [mode: string];
    zoomStep: [direction: 1 | -1];
}>();
const linkOpen = ref(false);
const openGroup = ref<string>();
const linkValue = ref('');
const linkError = ref(false);
const linkInput = ref<HTMLInputElement>();
const value = (event: Event): string => (event.target as HTMLInputElement).value;
function style(key: string, event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (!target.checkValidity()) {
        target.reportValidity();
        return;
    }
    const next = value(event);
    if ((key === 'fontSize' || key === 'lineHeight') && next && (!Number.isFinite(Number(next)) || Number(next) <= 0))
        return;
    emit(
        'format',
        { kind: 'style', attributes: { [key]: next ? `${next}${key === 'fontSize' ? 'px' : ''}` : null } },
        target.tagName === 'SELECT' || event.type === 'keydown',
    );
}
function heading(next: string): void {
    openGroup.value = undefined;
    emit(
        'block',
        next.startsWith('h')
            ? { kind: 'heading', level: Number(next.slice(1)) }
            : { kind: next as 'paragraph' | 'codeBlock' },
    );
}
async function openLink(): Promise<void> {
    openGroup.value = undefined;
    linkValue.value = props.textStyle.href ?? '';
    linkError.value = false;
    linkOpen.value = true;
    await nextTick();
    linkInput.value?.focus();
}
function applyLink(): void {
    try {
        const href = normalizeLink(linkValue.value);
        emit('format', { kind: 'link', href });
        linkOpen.value = false;
    } catch {
        linkError.value = true;
    }
}
function cancelLink(): void {
    linkOpen.value = false;
    emit('focus');
}
const hideZoomSteps = ref(false),
    hidePageCount = ref(false);
const groups = computed<ToolGroup[]>(() =>
    props.embedded
        ? ['history', 'type', 'marks', 'color', 'align', 'lineheight', 'direction', 'indent', 'lists', 'insert']
        : [
              'history',
              'type',
              'marks',
              'color',
              'align',
              'lineheight',
              'direction',
              'indent',
              'lists',
              'insert',
              ...(props.hideObjects
                  ? []
                  : [
                        ...(props.insert?.bilingual !== false || props.insert?.clauses !== false
                            ? (['bilingual'] as const)
                            : []),
                        ...(props.fixedPages ? [] : (['page'] as const)),
                    ]),
          ],
);
const triggers: Record<string, { icon: IconName; tooltip: string }> = {
    marks: { icon: 'editor-tool-bold', tooltip: 'formatting' },
    direction: { icon: 'editor-tool-text-direction-rtl', tooltip: 'text_direction' },
    indent: { icon: 'editor-tool-indent', tooltip: 'indentation' },
    lists: { icon: 'editor-tool-list-unordered', tooltip: 'lists' },
    insert: { icon: 'plus', tooltip: 'insert' },
    page: { icon: 'margins', tooltip: 'page' },
    paragraph: { icon: 'editor-tool-align-justify', tooltip: 'paragraph' },
    text: { icon: 'editor-tool-bold', tooltip: 'formatting' },
    insertPage: { icon: 'plus', tooltip: 'insert_and_page' },
    more: { icon: 'dots-horz', tooltip: 'more_tools' },
};
const trigger = (key: string) => triggers[key] ?? triggers.more;
const triggerLabel = (key: string): string => {
    const name = `toolbar.${trigger(key).tooltip}`;
    const translated = trans(name);
    return translated === name ? props.labels.formatting : translated;
};
const activeGroup = (members: readonly ToolGroup[]) =>
    members.some(
        (group) =>
            (group === 'marks' &&
                ['bold', 'italic', 'underline', 'strike'].some(
                    (mark) => props.textStyle[mark as keyof typeof props.textStyle],
                )) ||
            (group === 'lists' && props.listKind) ||
            (group === 'insert' && props.inTable),
    );
const actions: NativeToolbarActions = {
    closeGroup: () => {
        openGroup.value = undefined;
    },
    format: (command, focus) => {
        openGroup.value = undefined;
        emit('format', command, focus);
    },
    block: (patch) => {
        openGroup.value = undefined;
        emit('block', patch);
    },
    style,
    heading,
    list: (kind) => {
        openGroup.value = undefined;
        emit('list', kind);
    },
    indent: (lift) => {
        openGroup.value = undefined;
        emit('indent', lift);
    },
    table: (command) => {
        openGroup.value = undefined;
        emit('table', command);
    },
    insertTable: (rows, columns, header) => emit('insertTable', rows, columns, header),
    cells: () => {
        openGroup.value = undefined;
        emit('cells');
    },
    merge: () => {
        openGroup.value = undefined;
        emit('merge');
    },
    split: () => {
        openGroup.value = undefined;
        emit('split');
    },
    insertField: () => {
        openGroup.value = undefined;
        emit('insertField');
    },
    editField: () => {
        openGroup.value = undefined;
        emit('editField');
    },
    insertImage: () => {
        openGroup.value = undefined;
        emit('insertImage');
    },
    editImage: () => {
        openGroup.value = undefined;
        emit('editImage');
    },
    link: () => void openLink(),
    undo: () => emit('undo'),
    redo: () => emit('redo'),
    export: () => emit('export'),
    pageSetup: () => {
        openGroup.value = undefined;
        emit('pageSetup');
    },
    bilingual: () => {
        openGroup.value = undefined;
        emit('bilingual');
    },
    clauses: () => {
        openGroup.value = undefined;
        emit('clauses');
    },
};
async function focusTool(selector: string, group: string): Promise<void> {
    await nextTick();
    const modal = document.activeElement?.closest('[role=dialog]');
    if (modal?.getAttribute('aria-modal') === 'true' && !modal.hasAttribute('data-page-margins-dialog')) return;
    const direct = element.value?.querySelector<HTMLButtonElement>(selector);
    const button = direct?.getClientRects().length
        ? direct
        : element.value?.querySelector<HTMLButtonElement>(`[data-tool-groups~="${group}"]`);
    button?.focus({ preventScroll: true });
}
const focusPageControls = () => focusTool('[data-page-margins]', 'page');
const focusOutlineControls = () => focusTool('[data-outline-trigger]', 'page');
const focusBilingualControls = () => focusTool('[data-bilingual-trigger]', 'bilingual');
defineExpose({ openLink, focusPageControls, focusBilingualControls, focusOutlineControls });
</script>

<template>
    <div
        ref="element"
        class="native-format-toolbar native-workbench-tools"
        role="toolbar"
        :aria-label="labels.formatting"
    >
        <EditorToolStrip
            :visible-groups="groups"
            v-model:hide-zoom-steps="hideZoomSteps"
            v-model:hide-page-count="hidePageCount"
        >
            <template #default="{ unit }">
                <Popover
                    v-if="unit.collapsed"
                    :open="openGroup === unit.key"
                    @update:open="(open: boolean) => (openGroup = open ? unit.key : undefined)"
                >
                    <PopoverTrigger as-child
                        ><button
                            type="button"
                            :class="toolButtonClass(!!activeGroup(unit.groups))"
                            :aria-label="triggerLabel(unit.key)"
                            :title="triggerLabel(unit.key)"
                            :data-tool-groups="unit.groups.join(' ')"
                        >
                            <Icon
                                :name="
                                    unit.key === 'direction' && direction === 'ltr'
                                        ? 'editor-tool-text-direction-ltr'
                                        : trigger(unit.key).icon
                                "
                                class="size-4"
                            /><Icon name="chevron-down" :class="TOOL_CHEVRON_CLASS" /></button
                    ></PopoverTrigger>
                    <PopoverContent
                        :portal-to="portalTarget"
                        @escape-key-down.prevent="openGroup = undefined"
                        align="start"
                        class="max-h-(--reka-popover-content-available-height) w-auto min-w-52 overflow-y-auto p-0"
                        @open-auto-focus.prevent
                        @close-auto-focus="keepEditingFocus"
                        @focus-outside.prevent
                    >
                        <NativeToolbarGroup
                            :portal-to="portalTarget"
                            v-for="group in unit.groups"
                            :key="group"
                            :group="group"
                            :state="props"
                            :actions="actions"
                            row
                        />
                    </PopoverContent>
                </Popover>
                <NativeToolbarGroup
                    :portal-to="portalTarget"
                    v-else
                    :group="unit.groups[0]"
                    :state="props"
                    :actions="actions"
                />
            </template>
        </EditorToolStrip>
        <div v-if="!embedded" class="flex shrink-0 items-center gap-1 text-xs">
            <button
                type="button"
                :class="toolButtonClass(!!findOpen)"
                :aria-label="labels.find"
                :title="`${labels.find} (Ctrl/⌘+F)`"
                aria-keyshortcuts="Control+f Meta+f"
                :aria-expanded="!!findOpen"
                :disabled="!findReady"
                @pointerdown.prevent
                @click="emit('find')"
            >
                <Icon name="search" class="size-4" />
            </button>
            <button
                type="button"
                :class="toolButtonClass()"
                :aria-label="labels.printPdf"
                :title="labels.printPdf"
                :disabled="!ready || printing || exporting"
                @pointerdown.prevent
                @click="emit('print')"
            >
                <Icon name="print" class="size-4" />
            </button>
            <PagesPanelToggle
                data-outline-trigger
                :open="!!outlineOpen"
                :trigger="{ mode: 'text', count: outlineCount ?? 0 }"
                :hide-count="hidePageCount"
                :disabled="!outlineReady"
                @toggle="emit('outline')"
            />
            <button
                v-if="!hideZoomSteps"
                type="button"
                :class="toolButtonClass()"
                :aria-label="labels.zoomOut"
                :disabled="!ready || zoomOutDisabled"
                @click="emit('zoomStep', -1)"
            >
                <Icon name="minus" class="size-4" />
            </button>
            <select
                :value="zoomMode ?? 'auto'"
                :aria-label="labels.zoom"
                :disabled="!ready"
                class="native-tool-select max-w-28"
                @change="emit('zoom', value($event))"
            >
                <option value="auto">{{ labels.zoomAuto }} ({{ Math.round((automaticZoom ?? 1) * 100) }}%)</option>
                <option value="width">{{ labels.zoomWidth }}</option>
                <option value="page">{{ labels.zoomPage }}</option>
                <option
                    v-for="percent in [25, 50, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 350, 400]"
                    :key="percent"
                    :value="String(percent)"
                >
                    {{ percent }}%
                </option>
                <option
                    v-if="
                        zoomMode &&
                        ![
                            'auto',
                            'width',
                            'page',
                            '25',
                            '50',
                            '75',
                            '90',
                            '100',
                            '110',
                            '125',
                            '150',
                            '175',
                            '200',
                            '250',
                            '300',
                            '350',
                            '400',
                        ].includes(zoomMode)
                    "
                    :value="zoomMode"
                >
                    {{ zoomMode }}%
                </option>
            </select>
            <button
                v-if="!hideZoomSteps"
                type="button"
                :class="toolButtonClass()"
                :aria-label="labels.zoomIn"
                :disabled="!ready || zoomInDisabled"
                @click="emit('zoomStep', 1)"
            >
                <Icon name="plus" class="size-4" />
            </button>
        </div>
        <button
            v-if="embedded"
            type="button"
            :class="toolButtonClass(!!findOpen)"
            :aria-label="labels.find"
            :title="`${labels.find} (Ctrl/⌘+F)`"
            aria-keyshortcuts="Control+f Meta+f"
            :aria-expanded="!!findOpen"
            :disabled="!findReady"
            @pointerdown.prevent
            @click="emit('find')"
        >
            <Icon name="search" class="size-4" />
        </button>
        <form v-if="linkOpen" class="native-link-form" @submit.prevent="applyLink" @keydown.esc.prevent="cancelLink">
            <label
                >{{ labels.linkAddress
                }}<input
                    ref="linkInput"
                    v-model="linkValue"
                    type="text"
                    dir="ltr"
                    :aria-label="labels.linkAddress"
                    @input="linkError = false"
            /></label>
            <button type="submit">{{ labels.applyLink }}</button>
            <button
                type="button"
                @click="
                    emit('format', { kind: 'link', href: null });
                    linkOpen = false;
                "
            >
                {{ labels.removeLink }}
            </button>
            <button type="button" @click="cancelLink">
                {{ labels.cancel }}
            </button>
            <p v-if="linkError" role="alert">
                {{ labels.invalidLink }}
            </p>
        </form>
    </div>
</template>
