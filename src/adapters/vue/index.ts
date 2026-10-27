export { default as DocumentEditor } from './DocumentEditor.vue';
export * from './integration.js';
export { default as Page } from './Page.vue';
export { default as PdfPage } from './PdfPage.vue';
export type { DocumentEditorProps } from './props.js';
export { default as TableHandles } from './TableHandles.vue';
export type DocumentEditorApi = Omit<
    InstanceType<(typeof import('./DocumentEditor.vue'))['default']>,
    keyof import('vue').ComponentPublicInstance
>;
