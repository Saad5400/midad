<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import type { EditorIcon as IconName } from '../ui.js';
import type { ToolGroup } from './toolbar.js';
import type { ToggleMark } from '@saad5400/midad/formatting';
import type { Color } from '@saad5400/midad/style';
import { computed, provide, ref } from 'vue';
import NativeToolbarSelect from './NativeToolbarSelect.vue';
import { keepEditingFocus, type NativeToolbarActions, type NativeToolbarState } from './toolbar.js';

const ui = useEditorUi();
const Popover = useUiComponent('Popover');
const PopoverContent = useUiComponent('PopoverContent');
const PopoverTrigger = useUiComponent('PopoverTrigger');
const Icon = useUiComponent('Icon');
const EditorTableInsertGrid = useUiComponent('EditorTableInsertGrid');
const EditorPageMarginsTool = useUiComponent('EditorPageMarginsTool');
const EditorPageSetupTool = useUiComponent('EditorPageSetupTool');
const EditorToolStrip = useUiComponent('EditorToolStrip');

const EDITOR_FONT_OPTIONS = ui.fonts ?? [];
const toolbarUi = ui.toolbar ?? { button: () => '', row: () => '', chevron: '', provideRows: () => {} };
const TOOL_CHEVRON_CLASS = toolbarUi.chevron;
const toolButtonClass = toolbarUi.button;
const toolRowClass = toolbarUi.row;
const provideToolRows = toolbarUi.provideRows;
const trans = useUiText();

const props = defineProps<{
    group: ToolGroup;
    state: NativeToolbarState;
    actions: NativeToolbarActions;
    row?: boolean;
    portalTo?: HTMLElement;
}>();
if (props.row) provideToolRows();
provide('openPageMarginsDialog', () => props.actions.pageSetup());
const labels = computed(() => props.state.labels);
const blocked = computed(() => !props.state.active || !!props.state.hasImage);
const button = (active = false) => (props.row ? toolRowClass(active) : toolButtonClass(active));
const marks: { key: ToggleMark; icon?: IconName }[] = [
    { key: 'bold', icon: 'editor-tool-bold' },
    { key: 'italic', icon: 'editor-tool-italic' },
    { key: 'underline', icon: 'editor-tool-underline' },
    { key: 'strike', icon: 'editor-tool-strike' },
    { key: 'code' },
];
const fonts = computed(() =>
    props.state.textStyle.family && !EDITOR_FONT_OPTIONS.some((font) => font.value === props.state.textStyle.family)
        ? [{ label: props.state.textStyle.family, value: props.state.textStyle.family }, ...EDITOR_FONT_OPTIONS]
        : EDITOR_FONT_OPTIONS,
);
const paragraphStyle = computed(() =>
    props.state.block?.kind === 'heading'
        ? `h${props.state.block.attributes?.level ?? 1}`
        : props.state.block?.kind === 'codeBlock'
          ? 'codeBlock'
          : 'paragraph',
);
const alignment = computed(
    () =>
        props.state.fieldAlign ??
        props.state.block?.attributes?.textAlign ??
        (props.state.direction === 'rtl' ? 'right' : 'left'),
);
const alignIcons = {
    left: 'editor-tool-align-left',
    center: 'editor-tool-align-center',
    right: 'editor-tool-align-right',
    justify: 'editor-tool-align-justify',
} as const;
const hex = (color?: Color | null) =>
    `#${(color ?? [0, 0, 0])
        .slice(0, 3)
        .map((part) =>
            Math.round(part * 255)
                .toString(16)
                .padStart(2, '0'),
        )
        .join('')}`;
const colorOpen = ref(false),
    alignOpen = ref(false);
const tableOpen = ref(false),
    rows = ref(3),
    columns = ref(3),
    header = ref(true);
function tableAction(action: () => void): void {
    tableOpen.value = false;
    action();
}
const lineHeightOpen = ref(false);
const lineHeightDraft = ref<string | number>('');
const lineHeightInput = ref<HTMLInputElement>();
let initialLineHeight = '';
let committedLineHeight = '';
function commitLineHeight(focus = false): void {
    if (!lineHeightInput.value?.checkValidity()) return;
    const value = String(lineHeightDraft.value);
    if (value === committedLineHeight) return;
    committedLineHeight = value;
    props.actions.format({ kind: 'style', attributes: { lineHeight: value || null } }, focus);
}
function toggleLineHeight(open: boolean): void {
    if (open === lineHeightOpen.value) return;
    lineHeightOpen.value = open;
    if (open) {
        initialLineHeight = String(props.state.textStyle.lineHeight ?? '');
        lineHeightDraft.value = initialLineHeight;
        committedLineHeight = initialLineHeight;
    } else if (String(lineHeightDraft.value) !== committedLineHeight) commitLineHeight(true);
}
function insertTable(countRows: number, countColumns: number): void {
    props.actions.insertTable(countRows, countColumns, header.value);
    tableOpen.value = false;
}
</script>

<template>
    <div :class="row ? 'flex min-w-52 flex-col' : 'flex shrink-0 items-center gap-3'" :data-tool-group="group">
        <template v-if="group === 'history'">
            <button
                type="button"
                :class="button()"
                :disabled="!state.canUndo"
                :aria-label="labels.undo"
                :title="labels.undo"
                @pointerdown.prevent
                @click="actions.undo"
            >
                <Icon name="editor-tool-undo" class="size-4" /><span v-if="row">{{ labels.undo }}</span>
            </button>
            <button
                type="button"
                :class="button()"
                :disabled="!state.canRedo"
                :aria-label="labels.redo"
                :title="labels.redo"
                @pointerdown.prevent
                @click="actions.redo"
            >
                <Icon name="editor-tool-redo" class="size-4" /><span v-if="row">{{ labels.redo }}</span>
            </button>
            <button
                v-if="!state.hideExport && !state.embedded"
                type="button"
                :class="button()"
                :disabled="!state.ready || state.exporting"
                :aria-label="labels.exportPdf"
                :title="labels.exportPdf"
                @click="actions.export"
            >
                <Icon name="import" class="size-4" /><span v-if="row">{{ labels.exportPdf }}</span>
            </button>
        </template>
        <template v-else-if="group === 'type'">
            <NativeToolbarSelect
                :portal-to="portalTo"
                :label="labels.paragraphStyle"
                :model-value="paragraphStyle"
                :disabled="blocked || state.hasField || state.block?.kind === 'clauseTitle'"
                :options="[
                    { value: 'paragraph', label: labels.paragraph },
                    ...Array.from({ length: 6 }, (_, i) => ({
                        value: `h${i + 1}`,
                        label: `${labels.heading} ${i + 1}`,
                    })),
                    { value: 'codeBlock', label: labels.codeBlock },
                ]"
                @change="actions.heading"
            />
            <NativeToolbarSelect
                :portal-to="portalTo"
                :label="labels.fontFamily"
                :model-value="state.textStyle.family ?? ''"
                :placeholder="labels.mixed"
                :disabled="blocked"
                :options="fonts"
                preview-font
                @change="(fontFamily) => actions.format({ kind: 'style', attributes: { fontFamily } })"
            />
            <input
                type="number"
                min="1"
                max="400"
                step="0.5"
                :aria-label="labels.fontSize"
                :title="labels.fontSize"
                :value="state.textStyle.size === undefined ? '' : Math.round((state.textStyle.size / 0.75) * 100) / 100"
                :placeholder="labels.mixed"
                :disabled="blocked"
                class="native-tool-number w-12 text-center"
                @change="actions.style('fontSize', $event)"
                @keydown.enter.prevent="actions.style('fontSize', $event)"
            />
        </template>
        <template v-else-if="group === 'marks'">
            <button
                v-for="mark in marks"
                :key="mark.key"
                type="button"
                :class="button(!!(mark.key === 'code' ? state.code : state.textStyle[mark.key]))"
                :disabled="blocked || (state.hasField && mark.key === 'code')"
                :aria-label="labels[mark.key]"
                :title="labels[mark.key]"
                :aria-pressed="(mark.key === 'code' ? state.code : state.textStyle[mark.key]) ?? 'mixed'"
                @pointerdown.prevent
                @click="actions.format({ kind: 'toggle', mark: mark.key })"
            >
                <Icon v-if="mark.icon" :name="mark.icon" class="size-4" /><span
                    v-else
                    aria-hidden="true"
                    class="w-4 font-mono text-xs"
                    >&lt;/&gt;</span
                ><span v-if="row">{{ labels[mark.key] }}</span>
            </button>
        </template>
        <Popover v-else-if="group === 'color'" v-model:open="colorOpen">
            <PopoverTrigger as-child
                ><button
                    type="button"
                    :class="button()"
                    :disabled="blocked"
                    :aria-label="labels.textColor"
                    :title="labels.textColor"
                >
                    <Icon name="editor-tool-color" class="size-4" /><Icon
                        name="chevron-down"
                        :class="TOOL_CHEVRON_CLASS"
                    /></button
            ></PopoverTrigger>
            <PopoverContent
                :portal-to="portalTo"
                @escape-key-down.prevent="colorOpen = false"
                align="start"
                class="grid w-60 gap-3 p-4"
                @close-auto-focus="keepEditingFocus"
            >
                <label class="flex items-center justify-between gap-3 text-xs"
                    >{{ labels.textColor
                    }}<input
                        type="color"
                        :aria-label="labels.textColor"
                        :value="hex(state.textStyle.color)"
                        @change="actions.style('color', $event)"
                /></label>
                <label class="flex items-center justify-between gap-3 text-xs"
                    >{{ labels.backgroundColor
                    }}<input
                        type="color"
                        :aria-label="labels.backgroundColor"
                        :value="hex(state.textStyle.background)"
                        @change="actions.style('backgroundColor', $event)"
                /></label>
                <button
                    type="button"
                    :class="toolRowClass()"
                    @click="actions.format({ kind: 'style', attributes: { backgroundColor: null } })"
                >
                    {{ labels.removeBackground }}
                </button>
                <button type="button" :class="toolRowClass()" @click="actions.format({ kind: 'clear' })">
                    {{ labels.clearFormatting }}
                </button>
            </PopoverContent>
        </Popover>
        <Popover v-else-if="group === 'align'" v-model:open="alignOpen">
            <PopoverTrigger as-child
                ><button
                    type="button"
                    :class="button()"
                    :disabled="blocked"
                    :aria-label="labels.align"
                    :title="labels.align"
                >
                    <Icon
                        :name="alignIcons[alignment as keyof typeof alignIcons] ?? alignIcons.right"
                        class="size-4"
                    /><span v-if="row">{{ labels.align }}</span
                    ><Icon name="chevron-down" :class="TOOL_CHEVRON_CLASS" /></button
            ></PopoverTrigger>
            <PopoverContent
                :portal-to="portalTo"
                @escape-key-down.prevent="alignOpen = false"
                align="start"
                class="w-52 p-0"
                @close-auto-focus="keepEditingFocus"
            >
                <button
                    v-for="align in ['right', 'center', 'left', 'justify'] as const"
                    :key="align"
                    type="button"
                    :class="toolRowClass(alignment === align)"
                    :aria-pressed="alignment === align"
                    @click="actions.block({ textAlign: align })"
                >
                    <Icon :name="alignIcons[align]" class="size-4" />{{ labels[align] }}
                </button>
            </PopoverContent>
        </Popover>
        <Popover v-else-if="group === 'lineheight'" :open="lineHeightOpen" @update:open="toggleLineHeight">
            <PopoverTrigger as-child
                ><button
                    type="button"
                    :class="button()"
                    :disabled="blocked"
                    :aria-label="labels.lineHeight"
                    :title="labels.lineHeight"
                >
                    <Icon name="editor-tool-line-height" class="size-4" /><span v-if="row">{{ labels.lineHeight }}</span
                    ><Icon name="chevron-down" :class="TOOL_CHEVRON_CLASS" /></button
            ></PopoverTrigger>
            <PopoverContent
                :portal-to="portalTo"
                @escape-key-down.prevent="toggleLineHeight(false)"
                align="start"
                class="w-52 p-0"
                @close-auto-focus="keepEditingFocus"
            >
                <button
                    v-for="height in [1, 1.15, 1.5, 2, 2.5, 3]"
                    :key="height"
                    type="button"
                    :class="toolRowClass(state.textStyle.lineHeight === height)"
                    @click="
                        lineHeightDraft = String(height);
                        commitLineHeight(true);
                    "
                >
                    {{ height }}
                </button>
                <label class="flex items-center gap-2 p-3 text-xs"
                    >{{ labels.lineHeight
                    }}<input
                        type="number"
                        min="0.5"
                        max="20"
                        step="0.05"
                        :aria-label="labels.lineHeight"
                        ref="lineHeightInput"
                        v-model="lineHeightDraft"
                        :placeholder="labels.automatic"
                        class="native-tool-number w-20 min-w-0"
                        @change="commitLineHeight()"
                        @keydown.enter.prevent="commitLineHeight(true)"
                /></label>
            </PopoverContent>
        </Popover>
        <template v-else-if="group === 'direction'">
            <button
                v-for="direction in ['rtl', 'ltr'] as const"
                :key="direction"
                type="button"
                :class="button(state.direction === direction)"
                :disabled="blocked"
                :aria-label="labels[direction]"
                :title="labels[direction]"
                :aria-pressed="state.direction === direction"
                @pointerdown.prevent
                @click="actions.block({ dir: direction })"
            >
                <Icon
                    :name="direction === 'rtl' ? 'editor-tool-text-direction-rtl' : 'editor-tool-text-direction-ltr'"
                    class="size-4"
                /><span v-if="row">{{ labels[direction] }}</span>
            </button>
        </template>
        <template v-else-if="group === 'indent'">
            <button
                v-for="lift in [false, true]"
                :key="String(lift)"
                type="button"
                :class="button()"
                :disabled="
                    blocked ||
                    state.hasField ||
                    (lift
                        ? !state.listKind && Number(state.block?.attributes?.indent ?? 0) <= 0
                        : Number(state.block?.attributes?.indent ?? 0) >= 20)
                "
                :aria-label="lift ? labels.decreaseIndent : labels.increaseIndent"
                :title="lift ? labels.decreaseIndent : labels.increaseIndent"
                @pointerdown.prevent
                @click="actions.indent(lift)"
            >
                <Icon
                    :name="lift ? 'editor-tool-outdent' : 'editor-tool-indent'"
                    class="size-4"
                    :class="state.direction === 'rtl' && '-scale-x-100'"
                /><span v-if="row">{{ lift ? labels.decreaseIndent : labels.increaseIndent }}</span>
            </button>
        </template>
        <template v-else-if="group === 'lists'">
            <button
                v-for="kind in ['bulletList', 'orderedList'] as const"
                :key="kind"
                type="button"
                :class="button(state.listKind === kind)"
                :disabled="blocked || state.hasField"
                :aria-label="labels[kind]"
                :title="labels[kind]"
                :aria-pressed="state.listKind === kind"
                @pointerdown.prevent
                @click="actions.list(kind)"
            >
                <Icon
                    :name="kind === 'bulletList' ? 'editor-tool-list-unordered' : 'editor-tool-list-ordered'"
                    class="size-4"
                /><span v-if="row">{{ labels[kind] }}</span>
            </button>
        </template>
        <template v-else-if="group === 'insert'">
            <button
                v-if="state.canUploadImage && !state.hideObjects && (state.insert?.images !== false || state.hasImage)"
                type="button"
                :class="button()"
                :disabled="!state.active && !state.canInsertObjects"
                :aria-label="state.hasImage ? labels.editImage : labels.insertImage"
                :title="state.hasImage ? labels.editImage : labels.insertImage"
                @pointerdown.prevent
                @click="state.hasImage ? actions.editImage() : actions.insertImage()"
            >
                <Icon name="editor-tool-image" class="size-4" /><span v-if="row">{{ labels.insertImage }}</span>
            </button>
            <Popover
                v-if="!state.hideObjects && (state.insert?.tables !== false || state.inTable)"
                v-model:open="tableOpen"
            >
                <PopoverTrigger as-child
                    ><button
                        type="button"
                        :class="button(!!state.inTable)"
                        :disabled="blocked || !['paragraph', 'heading'].includes(state.block?.kind ?? '')"
                        :aria-label="labels.insertTable"
                        :title="labels.insertTable"
                    >
                        <Icon name="table" class="size-4" /><span v-if="row">{{ labels.insertTable }}</span
                        ><Icon name="chevron-down" :class="TOOL_CHEVRON_CLASS" /></button
                ></PopoverTrigger>
                <PopoverContent
                    :portal-to="portalTo"
                    @escape-key-down.prevent="tableOpen = false"
                    align="start"
                    data-native-table-menu
                    class="max-h-(--reka-popover-content-available-height) w-auto overflow-y-auto p-3"
                    @close-auto-focus="keepEditingFocus"
                >
                    <EditorTableInsertGrid v-if="state.insert?.tables !== false" @select="insertTable" />
                    <form
                        v-if="state.insert?.tables !== false"
                        class="grid gap-2 border-t pt-3 text-xs"
                        @submit.prevent="insertTable(rows, columns)"
                    >
                        <label class="flex items-center justify-between gap-2"
                            >{{ labels.tableRows
                            }}<input
                                v-model.number="rows"
                                type="number"
                                min="1"
                                max="100"
                                required
                                :aria-label="labels.tableRows"
                                class="native-tool-number w-16"
                        /></label>
                        <label class="flex items-center justify-between gap-2"
                            >{{ labels.tableColumns
                            }}<input
                                v-model.number="columns"
                                type="number"
                                min="1"
                                max="100"
                                required
                                :aria-label="labels.tableColumns"
                                class="native-tool-number w-16"
                        /></label>
                        <label class="flex items-center gap-2"
                            ><input v-model="header" type="checkbox" />{{ labels.tableHeader }}</label
                        >
                        <button type="submit" :class="toolRowClass()">
                            {{ labels.insertTable }}
                        </button>
                    </form>
                    <div v-if="state.inTable" class="border-t pt-2">
                        <button
                            type="button"
                            :class="toolRowClass(!!state.selectingCells)"
                            @click="tableAction(actions.cells)"
                        >
                            {{ labels.selectCells }}
                        </button>
                        <button
                            type="button"
                            :class="toolRowClass()"
                            :disabled="!state.canMerge || state.tableLocked"
                            @click="tableAction(actions.merge)"
                        >
                            {{ labels.mergeCells }}
                        </button>
                        <button
                            type="button"
                            :class="toolRowClass()"
                            :disabled="!state.canSplit || state.tableLocked"
                            @click="tableAction(actions.split)"
                        >
                            {{ labels.splitCell }}
                        </button>
                        <button
                            v-for="command in [
                                'rowBefore',
                                'rowAfter',
                                'columnBefore',
                                'columnAfter',
                                'headerRow',
                                'deleteRow',
                                'deleteColumn',
                                'deleteTable',
                            ] as const"
                            :key="command"
                            type="button"
                            :class="toolRowClass()"
                            :disabled="state.tableLocked"
                            @click="tableAction(() => actions.table(command))"
                        >
                            {{ labels[command] }}
                        </button>
                    </div>
                </PopoverContent>
            </Popover>
            <button
                v-if="!state.hideObjects && (state.insert?.fields !== false || state.hasField)"
                type="button"
                :class="button(!!state.hasField)"
                :disabled="!state.active && !state.canInsertObjects"
                :aria-label="state.hasField ? labels.editField : labels.insertField"
                :title="state.hasField ? labels.editField : labels.insertField"
                @pointerdown.prevent
                @click="state.hasField ? actions.editField() : actions.insertField()"
            >
                <Icon name="plus" class="size-4" /><span v-if="row">{{
                    state.hasField ? labels.editField : labels.insertField
                }}</span>
            </button>
            <button
                type="button"
                :class="button()"
                :disabled="blocked || state.hasField"
                :aria-label="labels.link"
                :title="labels.link"
                @pointerdown.prevent
                @click="actions.link"
            >
                <Icon name="link" class="size-4" /><span v-if="row">{{ labels.link }}</span>
            </button>
        </template>
        <template v-else-if="group === 'bilingual'">
            <button
                v-if="state.insert?.bilingual !== false"
                data-bilingual-trigger
                type="button"
                :class="button(!!state.bilingualSplit)"
                :disabled="!state.ready || state.bilingualBusy"
                :aria-label="labels.bilingual"
                :title="state.bilingualMessage || labels.bilingual"
                :aria-expanded="!!state.bilingualOpen"
                :aria-controls="state.bilingualPopupId"
                aria-haspopup="dialog"
                @click="actions.bilingual"
            >
                <span
                    v-if="state.bilingualWorking"
                    aria-hidden="true"
                    class="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
                <Icon v-else name="bilingual-split" class="size-4" /><span
                    v-if="state.bilingualFailed"
                    aria-hidden="true"
                    class="bg-destructive absolute end-0 top-0 size-1.5 rounded-full"
                /><span v-if="row">{{ labels.bilingual }}</span
                ><span v-if="state.bilingualMessage" role="status" class="sr-only">{{ state.bilingualMessage }}</span>
            </button>
            <button
                v-if="state.insert?.clauses !== false"
                type="button"
                :class="button()"
                :disabled="!state.ready || state.clausesBusy"
                :aria-label="labels.clauses"
                :title="labels.clauses"
                @click="actions.clauses"
            >
                <Icon name="justify-right" class="size-4" /><span v-if="row">{{ labels.clauses }}</span>
            </button>
        </template>
        <template v-else-if="group === 'page'">
            <EditorPageSetupTool
                :disabled="!state.ready || state.pageSetupBusy"
                :portal-to="portalTo"
                @applied="actions.closeGroup?.()"
            />
            <EditorPageMarginsTool
                data-page-margins
                :label="trans('pageMargins')"
                :disabled="!state.ready || state.pageSetupBusy"
            />
        </template>
    </div>
</template>
