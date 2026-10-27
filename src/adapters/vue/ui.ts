import { computed, defineComponent, h, inject, provide, type Component, type InjectionKey, type Ref } from 'vue';
import type { PdfSource } from '../../pdf/reading/index.js';

export type EditorIcon = string;

export interface EditorUiBindings {
    components: Readonly<Record<string, Component>>;
    text?: (key: string, replacements?: Record<string, string>) => string;
    fonts?: readonly { label: string; value: string }[];
    isRtl?: Readonly<Ref<boolean>>;
    openPdf?: (bytes: Uint8Array, signal: AbortSignal) => Promise<PdfSource>;
    imageCropper?: () => any;
    tableMenuGroups?: (state: any) => readonly any[];
    menuRowClass?: string;
    fieldChrome?: (
        attributes: Record<string, any>,
        active: boolean,
        participants?: readonly any[],
    ) => Record<string, string>;
    toolbar?: {
        button: (active?: boolean) => string;
        row: (active?: boolean) => string;
        chevron: string;
        provideRows: () => void;
    };
}
export const editorUiKey: InjectionKey<EditorUiBindings> = Symbol('midad-editor-ui');
const empty: EditorUiBindings = { components: {} };
export function provideEditorUi(bindings: EditorUiBindings): void {
    provide(editorUiKey, bindings);
}
export function useEditorUi(): EditorUiBindings {
    return inject(editorUiKey, empty);
}
export function useUiComponent(name: string) {
    const bindings = useEditorUi();
    const fallback = defineComponent({
        inheritAttrs: false,
        setup:
            (_, { attrs, slots }) =>
            () =>
                h(name === 'Button' ? 'button' : 'span', attrs, slots.default?.()),
    });
    return computed(() => bindings.components[name] ?? fallback);
}
export function useUiText() {
    const bindings = useEditorUi();
    return (key: string, replacements?: Record<string, string>) => bindings.text?.(key, replacements) ?? key;
}
