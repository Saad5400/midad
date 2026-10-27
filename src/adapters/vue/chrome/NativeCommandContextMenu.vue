<script setup lang="ts" generic="T extends CommandMenuItem<IconName>">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import type { EditorIcon as IconName } from '../ui.js';
import type { BlockContext } from '@saad5400/midad/blocks';
import { keyboardShortcut, type CommandMenuGroup, type CommandMenuItem } from '@saad5400/midad/browser';
import type { NativeLabels } from '@saad5400/midad/labels';
import { computed, ref } from 'vue';
import type { BlockAction, ClipboardAction } from './NativeSelectionMenu.vue';
import { portalMenuPoint } from './menu-position.js';

const ui = useEditorUi();
const DropdownMenu = useUiComponent('DropdownMenu');
const DropdownMenuItem = useUiComponent('DropdownMenuItem');
const DropdownMenuSeparator = useUiComponent('DropdownMenuSeparator');
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger');
const EditorCommandTree = useUiComponent('EditorCommandTree');
const EditorMenuIcon = useUiComponent('EditorMenuIcon');
const trans = useUiText();
const menuRowClass = ui.menuRowClass;

const props = defineProps<{
    id: string;
    groups: readonly CommandMenuGroup<T>[];
    left: number;
    top: number;
    direction: 'rtl' | 'ltr';
    labels: NativeLabels;
    selected: boolean;
    busy: boolean;
    block?: BlockContext;
    blockOnly?: boolean;
    insertOnly?: boolean;
    href?: string | null;
    host?: HTMLElement;
}>();
const emit = defineEmits<{
    select: [item: T];
    action: [action: ClipboardAction];
    block: [action: BlockAction];
    link: [action: 'open' | 'copy' | 'remove'];
    close: [restore?: boolean];
    shortcut: [event: KeyboardEvent];
}>();
const portal = computed(() => props.host?.closest<HTMLDialogElement>('dialog') ?? document.body);
const anchor = computed(() => portalMenuPoint(portal.value, props.left, props.top));
const clipboard: { id: ClipboardAction; icon: IconName; label: () => string; keys: string; selected?: boolean }[] = [
    { id: 'cut', icon: 'scissors-cut', label: () => props.labels.cut, keys: 'X', selected: true },
    { id: 'copy', icon: 'copy', label: () => props.labels.copy, keys: 'C', selected: true },
    { id: 'paste', icon: 'clipboard', label: () => props.labels.paste, keys: 'V' },
    {
        id: 'pastePlain',
        icon: 'clipboard-close',
        label: () => trans('context.paste_plain'),
        keys: 'Shift+V',
    },
    { id: 'selectAll', icon: 'check', label: () => props.labels.selectAll, keys: 'A' },
];
const outside = ref(false);
const apple = /mac|iphone|ipad/i.test(navigator.userAgent);
const shortcut = (key: string) => (apple ? `⌘${key.replace('Shift+', '⇧')}` : `Ctrl+${key}`);
const blockActions = computed<{ id: BlockAction; label: string; icon: IconName; disabled?: boolean }[]>(() =>
    props.block
        ? [
              ...(props.block.node.kind === 'clause'
                  ? [{ id: 'unwrap' as const, label: props.labels.unwrapClause, icon: 'lamp-charge' as const }]
                  : []),
              { id: 'up', label: props.labels.moveBlockUp, icon: 'arrow-up', disabled: !props.block.canMoveUp },
              { id: 'down', label: props.labels.moveBlockDown, icon: 'arrow-down', disabled: !props.block.canMoveDown },
              { id: 'delete', label: props.labels.deleteBlock, icon: 'trash-01' },
          ]
        : [],
);
function key(event: KeyboardEvent): void {
    if (event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (!['a', 'b', 'c', 'i', 'k', 'u', 'v', 'x', 'y', 'z'].includes(keyboardShortcut(event))) return;
    emit('close');
    emit('shortcut', event);
}
function focus(): void {
    document.getElementById(props.id)?.querySelector<HTMLElement>('[role=menuitem]:not([data-disabled])')?.focus();
}
defineExpose({ focus });
</script>
<template>
    <Teleport :to="portal">
        <DropdownMenu
            :open="true"
            :modal="false"
            :dir="direction"
            @update:open="(open: boolean) => !open && emit('close', !outside)"
        >
            <DropdownMenuTrigger as-child>
                <div
                    aria-hidden="true"
                    class="pointer-events-none"
                    :style="{ ...anchor, width: '0px', height: '0px' }"
                />
            </DropdownMenuTrigger>
            <EditorCommandTree
                :id="id"
                :portal-to="portal"
                :groups="blockOnly ? [] : groups"
                :open="true"
                class="native-selection-menu native-command-context"
                :aria-label="labels.selectionActions"
                @select="emit('select', $event)"
                @keydown="key"
                @interact-outside="outside = true"
                @close-auto-focus.prevent="emit('close', !outside)"
            >
                <template #before>
                    <template v-if="!blockOnly && !insertOnly">
                        <DropdownMenuItem
                            v-for="item in clipboard"
                            :key="item.id"
                            :class="menuRowClass"
                            :disabled="busy || (item.selected && !selected)"
                            :aria-keyshortcuts="`${apple ? 'Meta' : 'Control'}+${item.keys}`"
                            @pointerdown.prevent.stop
                            @select="emit('action', item.id)"
                        >
                            <EditorMenuIcon :icon="item.icon" />
                            <span class="flex-1 text-start leading-[17px]">{{ item.label() }}</span>
                            <span
                                aria-hidden="true"
                                class="dark:text-muted-foreground text-[10px] tracking-wide text-gray-400"
                                >{{ shortcut(item.keys) }}</span
                            >
                        </DropdownMenuItem>
                        <template v-if="href">
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                v-for="action in [
                                    ['open', 'open-new', 'open_link'],
                                    ['copy', 'link', 'copy_link'],
                                    ['remove', 'close-circle', 'remove_link'],
                                ] as const"
                                :key="action[0]"
                                :class="menuRowClass"
                                @pointerdown.prevent.stop
                                @select="emit('link', action[0])"
                            >
                                <EditorMenuIcon :icon="action[1]" /><span class="flex-1 text-start">{{
                                    trans(`context.${action[2]}`)
                                }}</span>
                            </DropdownMenuItem>
                        </template>
                        <DropdownMenuSeparator />
                    </template>
                    <DropdownMenuItem
                        v-for="item in blockActions"
                        :key="item.id"
                        :class="menuRowClass"
                        :disabled="busy || item.disabled"
                        @pointerdown.prevent.stop
                        @select="emit('block', item.id)"
                    >
                        <EditorMenuIcon :icon="item.icon" /><span class="flex-1 text-start">{{ item.label }}</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator v-if="blockActions.length && !blockOnly" />
                </template>
            </EditorCommandTree>
        </DropdownMenu>
    </Teleport>
</template>
