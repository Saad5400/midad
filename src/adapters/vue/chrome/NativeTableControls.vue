<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import {
    applyTableControlAction as nativeTableAction,
    tableControlCells as nativeTableCells,
    tableControlContext as nativeTableContext,
    tableControlSelection as nativeTableSelection,
    tableControlTargetAfter as nativeTableTargetAfter,
    type TableControlEdit as NativeTableEdit,
    type TableControlScope as NativeTableScope,
    type TableControlTarget as NativeTableTarget,
} from '@saad5400/midad/browser/commands';
import { SurfaceFocusIntent } from '@saad5400/midad/browser/input';
import { tableControlFrame, tableHandleBoxes, type TableControlRect } from '@saad5400/midad/browser/view';
import type { NativeDocument } from '@saad5400/midad/document';
import {
    canMoveTableAxis,
    tableContext,
    tableRectangle,
    textBlocks,
    type NativeSelection,
    type TableCellSelection,
} from '@saad5400/midad/editing';
import { cellAt, type DocumentScene } from '@saad5400/midad/layout';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue';
import { portalMenuPoint } from './menu-position.js';

const ui = useEditorUi();
const DropdownMenu = useUiComponent('DropdownMenu');
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger');
const Icon = useUiComponent('Icon');
const TableHandleMenu = useUiComponent('TableHandleMenu');

const tableMenuGroups = ui.tableMenuGroups ?? (() => []);
const trans = useUiText();

const props = defineProps<{
    document: NativeDocument;
    scene: DocumentScene;
    host?: HTMLElement;
    activeBlockId?: string | null;
    selection: NativeSelection | null;
    scale: number;
    busy?: boolean;
    apply: (base: NativeDocument, edit: NativeTableEdit, selection: NativeSelection | null) => Promise<boolean>;
}>();
const emit = defineEmits<{
    select: [cells: TableCellSelection];
    focus: [];
    dismiss: [];
    table: [id?: string];
    error: [error: unknown];
}>();
const isRtl = computed(() => ui.isRtl?.value ?? false);
const ownerId = useId();
let openedEpoch = 0;
function owns(target: EventTarget | null): boolean {
    return (
        target instanceof Element &&
        (target.closest('[data-native-table-menu-owner]')?.getAttribute('data-native-table-menu-owner') === ownerId ||
            target.closest('[data-native-table-control-owner]')?.getAttribute('data-native-table-control-owner') ===
                ownerId)
    );
}
const focusIntents = new SurfaceFocusIntent(owns, props.host?.ownerDocument ?? document);
const hovered = shallowRef<NativeTableTarget>();
const frozen = shallowRef<NativeTableTarget>();
const orientation = ref<NativeTableScope>('row');
const opened = ref(false),
    expanded = ref(false),
    executing = ref(false),
    tick = ref(0);
const contextPoint = shallowRef<{ x: number; y: number }>();
let frame: number | undefined,
    focusPending = false;
const portal = computed(() => props.host?.closest<HTMLDialogElement>('dialog') ?? document.body);
const fallback = computed<NativeTableTarget | undefined>(() => {
    const context = props.activeBlockId && tableContext(props.document, props.activeBlockId);
    return context
        ? {
              tableId: context.grid.table.id,
              cellId: context.cell.node.id,
              rowId: context.grid.rows[context.cell.row].node.id,
          }
        : undefined;
});
const target = computed(() => frozen.value ?? hovered.value ?? fallback.value);
const model = computed(() => {
    if (!target.value) return undefined;
    try {
        return nativeTableContext(props.document, target.value);
    } catch {
        return undefined;
    }
});
const busy = computed(() => !!props.busy || executing.value);
function schedule(): void {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
        frame = undefined;
        tick.value++;
    });
}
function hover(event: PointerEvent): void {
    if (
        opened.value ||
        event.buttons ||
        !(event.target instanceof Element) ||
        event.target.closest('[data-table-handles]')
    )
        return;
    const page = event.target.closest<HTMLElement>('.native-page');
    if (!page || !props.host?.contains(page)) {
        hovered.value = undefined;
        return;
    }
    const index = Number(page.dataset.page) - 1,
        scenePage = props.scene.pages[index];
    if (!scenePage) return;
    const bounds = page.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) * scenePage.width) / bounds.width;
    const y = ((event.clientY - bounds.top) * scenePage.height) / bounds.height;
    const cell = cellAt(props.scene, index, x, y);
    if (!cell) {
        hovered.value = undefined;
        return;
    }
    const row = scenePage.tableRows?.find(
        (row) => row.tableId === cell.tableId && y >= row.y && y <= row.y + row.height,
    );
    const next = { tableId: cell.tableId, cellId: cell.cellId, rowId: row?.rowId, pageIndex: index };
    if (JSON.stringify(next) !== JSON.stringify(hovered.value)) hovered.value = next;
}
const geometry = computed(() => {
    void tick.value;
    void props.scale;
    if (!target.value || !model.value || !props.host) return undefined;
    const pages =
        target.value.pageIndex === undefined ? props.scene.pages.map((_, index) => index) : [target.value.pageIndex];
    const chrome = Math.max(
        0,
        ...Array.from(
            props.host.querySelectorAll<HTMLElement>('.native-format-toolbar, .native-controls, .native-find-panel'),
        ).map((element) => element.getBoundingClientRect().bottom),
    );
    const viewport = { left: 0, top: chrome, right: innerWidth, bottom: innerHeight };
    for (const index of pages) {
        const page = props.scene.pages[index];
        const element = props.host.querySelector<HTMLElement>(`.native-page[data-page="${index + 1}"]`);
        if (!page || !element) continue;
        const current = tableControlFrame({
            document: props.document,
            page,
            target: target.value,
            bounds: element.getBoundingClientRect(),
            viewport,
            selection: props.selection,
        });
        if (current) return current;
    }
    return undefined;
});
const boxes = computed(() =>
    geometry.value
        ? tableHandleBoxes({
              ...geometry.value,
              expanded: expanded.value || (opened.value && orientation.value === 'cell'),
          })
        : undefined,
);
function style(box?: TableControlRect): Record<string, string> | undefined {
    if (!box) return;
    const parent = portal.value;
    const bounds = parent.getBoundingClientRect();
    const sx = parent instanceof HTMLDialogElement && parent.offsetWidth ? bounds.width / parent.offsetWidth : 1;
    const sy = parent instanceof HTMLDialogElement && parent.offsetHeight ? bounds.height / parent.offsetHeight : 1;
    return {
        ...portalMenuPoint(parent, box.left, box.top),
        width: `${box.width / sx}px`,
        height: `${box.height / sy}px`,
    };
}
const groups = computed(() => {
    if (!model.value || !target.value) return [];
    const cells = nativeTableCells(props.document, target.value, orientation.value, props.selection);
    const selected = tableRectangle(props.document, cells);
    if (!selected) return [];
    const block = textBlocks(model.value.cell.node)[0];
    const text = block?.children?.find((node) => node.kind === 'text');
    const textColor = text?.marks?.find((mark) => mark.kind === 'textStyle')?.attributes?.color;
    const axis = orientation.value === 'column' ? 'column' : 'row';
    const index = axis === 'row' ? model.value.rowIndex : model.value.colIndex;
    return tableMenuGroups({
        orientation: orientation.value,
        rowIndex: model.value.rowIndex,
        colIndex: model.value.colIndex,
        rowCount: model.value.grid.rows.length,
        colCount: model.value.grid.columns,
        rtl: geometry.value?.rtl ?? false,
        locked: model.value.grid.table.attributes?.locked === true,
        cellCount: selected.cells.length,
        hasMergedCell: selected.cells.some((cell) => cell.rowspan > 1 || cell.colspan > 1),
        textAlign: typeof block?.attributes?.textAlign === 'string' ? block.attributes.textAlign : undefined,
        verticalAlign: String(model.value.cell.node.attributes?.verticalAlign ?? ''),
        textColor: typeof textColor === 'string' ? textColor : null,
        backgroundColor: model.value.cell.node.attributes?.backgroundColor as string | null,
        borderColor: model.value.grid.table.attributes?.borderColor as string | null,
        canMoveBefore: canMoveTableAxis(model.value.grid, axis, index, -1),
        canMoveAfter: canMoveTableAxis(model.value.grid, axis, index, 1),
        onTextColor: (value: any) => void run('color-text', value),
        onBackgroundColor: (value: any) => void run('color-background', value),
        onBorderColor: (value: any) => void run('table-border-color', value),
    });
});
function open(scope: NativeTableScope, value: boolean): void {
    if (!value) {
        if (orientation.value !== scope) return;
        opened.value = false;
        frozen.value = undefined;
        contextPoint.value = undefined;
        if (!executing.value) emit('dismiss');
        return;
    }
    if (busy.value || !target.value) return;
    orientation.value = scope;
    openedEpoch = focusIntents.capture();
    frozen.value = { ...target.value };
    opened.value = true;
    if (scope === 'row' || scope === 'column')
        emit('select', nativeTableCells(props.document, target.value, scope, props.selection));
}
function closeFocus(event: Event): void {
    event.preventDefault();
    if (opened.value || !focusIntents.current(openedEpoch)) return;
    if (executing.value) focusPending = true;
    else emit('focus');
}
async function run(id: string, value?: string | null, scope?: NativeTableScope, atEnd = false): Promise<void> {
    if (busy.value || !target.value) return;
    const wasOpen = opened.value;
    const intent = focusIntents.capture();
    const keep = ['color-text', 'color-background', 'table-border-color'].includes(id);
    const base = props.document,
        current = { ...target.value },
        mode = scope ?? orientation.value;
    executing.value = true;
    try {
        const result = nativeTableAction(base, current, mode, id, props.selection, value, atEnd);
        if (result && result.document !== base) {
            const selected = keep
                ? mode === 'table'
                    ? props.selection
                    : nativeTableSelection(
                          result.document,
                          nativeTableCells(result.document, current, mode, props.selection),
                      )
                : null;
            if (await props.apply(base, result, selected)) {
                const next = nativeTableTargetAfter(result.document, result);
                if (next) hovered.value = next;
            }
        }
    } catch (error) {
        emit('error', error);
    } finally {
        executing.value = false;
        if (!opened.value) emit('dismiss');
        if (!opened.value && focusIntents.current(intent) && (focusPending || !wasOpen || !keep)) {
            emit('focus');
        }
        focusPending = false;
    }
}
function contextMenu(event: MouseEvent): void {
    if (
        !geometry.value?.selection ||
        opened.value ||
        !(event.target instanceof Element) ||
        !props.host?.contains(event.target) ||
        !event.target.closest('.native-page')
    )
        return;
    event.preventDefault();
    event.stopPropagation();
    contextPoint.value = { x: event.clientX, y: event.clientY };
    open('cell', true);
}
watch(
    () => model.value?.grid.table.id,
    (id) => {
        emit('table', id);
        if (!id) {
            opened.value = false;
            frozen.value = undefined;
            hovered.value = undefined;
            contextPoint.value = undefined;
        }
    },
    { immediate: true },
);
watch([() => props.scene, () => props.scale], schedule, { flush: 'post' });
let resizeObserver: ResizeObserver | undefined;
watch(
    () => props.host,
    (host, previous) => {
        previous?.removeEventListener('contextmenu', contextMenu, true);
        host?.addEventListener('contextmenu', contextMenu, true);
        resizeObserver?.disconnect();
        if (host && typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(schedule);
            resizeObserver.observe(host);
        }
        schedule();
    },
    { immediate: true, flush: 'post' },
);
onMounted(() => {
    window.addEventListener('pointermove', hover, true);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
});
onBeforeUnmount(() => {
    window.removeEventListener('pointermove', hover, true);
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    props.host?.removeEventListener('contextmenu', contextMenu, true);
    resizeObserver?.disconnect();
    focusIntents.dispose();
    if (frame !== undefined) cancelAnimationFrame(frame);
});
const t = (key: string) => trans(`table.handles.${key}`);
const pill =
    'fixed z-40 flex items-center justify-center rounded-md bg-gray-200/80 hover:bg-gray-300 dark:bg-accent dark:hover:bg-gray-600 transition-colors';
const locked = computed(() => model.value?.grid.table.attributes?.locked === true);
</script>

<template>
    <Teleport :to="portal">
        <template v-if="boxes && model">
            <div
                v-if="geometry?.selection"
                :style="{
                    ...style(geometry.selection),
                    border: '2px solid var(--table-selection, #3b82f6)',
                    borderRadius: '2px',
                }"
                class="pointer-events-none fixed z-40"
            />
            <DropdownMenu
                v-for="scope in ['table', 'row', 'column', 'cell'] as const"
                :key="scope"
                :modal="false"
                :dir="isRtl ? 'rtl' : 'ltr'"
                :open="opened && orientation === scope && !contextPoint"
                @update:open="(value: any) => open(scope, value)"
            >
                <DropdownMenuTrigger v-if="(scope === 'table' || !locked || scope === 'cell') && boxes[scope]" as-child>
                    <button
                        :style="[
                            style(boxes[scope]),
                            scope === 'cell' || (opened && orientation === scope)
                                ? { backgroundColor: 'var(--table-selection, #3b82f6)', color: '#fff' }
                                : null,
                        ]"
                        :class="[pill, scope === 'cell' ? 'rounded-full' : 'cursor-pointer']"
                        :aria-label="t(`${scope}_options`)"
                        :data-table-control="scope"
                        :data-native-table-control-owner="ownerId"
                        :disabled="busy"
                        data-table-handles
                        @pointerenter="scope === 'cell' && (expanded = true)"
                        @pointerleave="scope === 'cell' && (expanded = false)"
                    >
                        <Icon
                            v-if="scope !== 'cell' || expanded || opened"
                            :name="scope === 'table' || scope === 'cell' ? 'table-cell-grip' : 'table-handle'"
                            :class="['size-4', scope === 'column' ? 'rotate-90' : '']"
                        />
                    </button>
                </DropdownMenuTrigger>
                <TableHandleMenu
                    :groups="opened && orientation === scope && !contextPoint ? groups : []"
                    :portal-to="portal"
                    :owner-id="ownerId"
                    @select="run"
                    @close-auto-focus="closeFocus"
                />
            </DropdownMenu>
            <DropdownMenu
                :modal="false"
                :dir="isRtl ? 'rtl' : 'ltr'"
                :open="opened && !!contextPoint"
                @update:open="(value: any) => open('cell', value)"
            >
                <DropdownMenuTrigger as-child
                    ><span
                        class="pointer-events-none"
                        :style="
                            contextPoint ? portalMenuPoint(portal, contextPoint.x, contextPoint.y) : { display: 'none' }
                        "
                /></DropdownMenuTrigger>
                <TableHandleMenu
                    v-if="contextPoint"
                    :groups="opened && contextPoint ? groups : []"
                    :portal-to="portal"
                    :owner-id="ownerId"
                    @select="run"
                    @close-auto-focus="closeFocus"
                />
            </DropdownMenu>
            <button
                v-if="boxes.addRow && !locked"
                type="button"
                :style="style(boxes.addRow)"
                :class="pill"
                :aria-label="trans('table.tooltips.add_row')"
                :disabled="busy"
                data-table-handles
                @pointerdown.prevent
                data-table-control="add-row"
                :data-native-table-control-owner="ownerId"
                @click.stop.prevent="run('insert-after', undefined, 'row', true)"
            >
                <Icon name="table-extend-plus" class="size-4 text-gray-500 dark:text-gray-400" />
            </button>
            <button
                v-if="boxes.addColumn && !locked"
                type="button"
                :style="style(boxes.addColumn)"
                :class="pill"
                :aria-label="trans('table.tooltips.add_column')"
                :disabled="busy"
                data-table-handles
                @pointerdown.prevent
                data-table-control="add-column"
                :data-native-table-control-owner="ownerId"
                @click.stop.prevent="run('insert-after', undefined, 'column', true)"
            >
                <Icon name="table-extend-plus" class="size-4 text-gray-500 dark:text-gray-400" />
            </button>
        </template>
    </Teleport>
</template>
