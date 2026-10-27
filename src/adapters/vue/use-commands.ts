import { computed, ref, shallowRef } from 'vue';
import {
    DocumentCommandController,
    LiveTemplateController,
    type CommandMenuItem,
    type DocumentCommandState,
    type DocumentMenuItem,
    type PendingDocumentCommand,
} from '../../browser/index.js';
import type { CommandBookmark, CommandTrigger } from '../../editing/index.js';
import type { NativeSelection } from '../../editing/selection.js';

export type NativeCommandContext = CommandBookmark;
type PendingKind = 'image' | 'bilingual' | 'library';
export type NativeCommandMenuItem =
    | DocumentMenuItem<string>
    | (CommandMenuItem<string> & { readonly id: 'clause-library' });

export function useNativeCommands(options: DocumentCommandState) {
    const controller = new DocumentCommandController<PendingKind>(options);
    const trigger = shallowRef<CommandTrigger>();
    const pending = shallowRef<PendingDocumentCommand<PendingKind>>();
    const palette = ref<{ onKeyDown: (props: { event: KeyboardEvent }) => boolean; activeId?: string }>();
    const live = new LiveTemplateController();
    const templateRevision = ref(0);
    function sync(): void {
        trigger.value = controller.trigger;
        pending.value = controller.pending;
    }
    const templateRanges = computed(() => {
        void templateRevision.value;
        return live.entries.map((range) => ({ ...range, active: range.id === live.activeId }));
    });
    return {
        trigger,
        pending,
        palette,
        live,
        templateRanges,
        templateRevision,
        refresh(): void {
            controller.refresh();
            sync();
        },
        hide(): void {
            controller.hide();
            sync();
        },
        dismiss(): void {
            controller.dismiss();
            sync();
        },
        context: (slash = false) => controller.context(slash),
        valid: (context: NativeCommandContext) => controller.valid(context),
        beginPending(kind: PendingKind, context: NativeCommandContext): void {
            controller.beginPending(kind, context);
            sync();
        },
        endPending(kind: PendingKind): void {
            controller.endPending(kind);
            sync();
        },
        reset(): void {
            controller.reset();
            sync();
            live.cancel();
            templateRevision.value++;
        },
        templateChanged(selection: NativeSelection | null): void {
            const old = live.activeId;
            live.changed(selection);
            if (old !== live.activeId) templateRevision.value++;
        },
        key(event: KeyboardEvent): boolean {
            const handled = controller.key(event, () => palette.value?.onKeyDown?.({ event }) ?? false);
            sync();
            return handled;
        },
    };
}
