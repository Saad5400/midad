import type { PageLayout } from '../../content/page-layout.js';
import { computed, toRaw, defineComponent, inject, type Component, type InjectionKey, type Ref } from 'vue';
import type { CommandMenuGroup, CommandMenuItem, DocumentMenuId, DocumentMenuItem } from '../../browser/index.js';
import type { InsertCapabilities } from '../../content/capabilities.js';
import type { DocumentCommand } from '../../content/commands.js';
import {
    getDefaultVariableSettings,
    NATIVE_FIELD_TYPES,
    type FieldDraft,
    type NativeField,
    type VariableType,
} from '../../content/fields/index.js';
import type { NativeDocument, NativeNode } from '../../document/index.js';
import type { ListKind, NativeSelection, ProposalPolicy, SelectionStyle } from '../../editing/index.js';
import type { PdfSource } from '../../pdf/reading/index.js';

export type EditorChrome = Readonly<Record<string, Component>>;
export const editorChromeKey: InjectionKey<Readonly<Ref<EditorChrome>>> = Symbol('midad-editor-chrome');
export const EmptyChrome = defineComponent({ inheritAttrs: false, setup: () => () => null });
export function useEditorChrome(name: string) {
    const components = inject(editorChromeKey, undefined);
    return computed(() => toRaw(components?.value[name] ?? EmptyChrome));
}
export type EditorCommandItem =
    | DocumentMenuItem<string>
    | (CommandMenuItem<string> & { readonly id: 'clause-library' });
export type ClipboardAction = 'copy' | 'cut' | 'paste' | 'pastePlain' | 'selectAll';
export type BlockAction = 'up' | 'down' | 'delete' | 'unwrap';
export interface EditorFieldData extends FieldDraft {
    id: string;
    settings: Record<string, any>;
    participant_id?: string;
}
export interface FieldPaletteEntry {
    origin: 'palette';
    type: VariableType;
    name: string;
    value: string;
    display?: string;
    participant_id: string;
}
export interface EditorReviewHighlight {
    id: string;
    kind: string;
    selection: NativeSelection;
    active?: boolean;
}
export type EditorReviewPolicy = ProposalPolicy & {
    base: NativeDocument;
    validate: (document: NativeDocument) => void;
};
export interface PageOrientationController {
    current: Readonly<Ref<'portrait' | 'landscape'>>;
    page?: { current: () => number; orientation: (page: number) => 'portrait' | 'landscape' };
    apply: (
        orientation: 'portrait' | 'landscape',
        scope?: 'document' | 'page',
        page?: number,
    ) => void | boolean | Promise<void | boolean>;
    busy?: Readonly<Ref<boolean>>;
    disabled?: Readonly<Ref<boolean>>;
    error?: Readonly<Ref<string>>;
}
export interface EditorMenuState {
    label: (key: string) => string;
    direction: 'rtl' | 'ltr';
    textOnly: boolean;
    insert?: InsertCapabilities;
    canUploadImage: boolean;
    block?: NativeNode;
    list?: ListKind;
    style: SelectionStyle;
    field?: boolean;
    exclude?: readonly string[];
}
export interface EditorCommandState {
    direction: 'rtl' | 'ltr';
    style: SelectionStyle;
    selectionName?: string;
    label: (key: string) => string;
    clauseTitle: string;
    clauseBody: string;
}
export interface EditorIntegration {
    translate?: (key: string) => string;
    bilingualTranslate?: (key: string) => string;
    commandMenu?: (state: EditorMenuState) => readonly CommandMenuGroup<EditorCommandItem>[];
    command?: (id: DocumentMenuId, state: EditorCommandState) => DocumentCommand | undefined;
    openPdf?: (bytes: Uint8Array, signal: AbortSignal) => Promise<PdfSource>;
    fieldMime?: string;
    parseField?: (value: unknown) => FieldPaletteEntry | null;
    fieldDraft?: (
        entry: FieldPaletteEntry,
        style: SelectionStyle,
        direction: 'rtl' | 'ltr',
        align?: string,
    ) => FieldDraft;
    fieldForUi?: (field: NativeField) => EditorFieldData;
    allowCoverField?: (type: VariableType) => boolean;
}
export function parseFieldPalette(value: unknown): FieldPaletteEntry | null {
    if (!value || typeof value !== 'object') return null;
    const field = value as FieldPaletteEntry;
    return field.origin === 'palette' && NATIVE_FIELD_TYPES.includes(field.type) && typeof field.name === 'string'
        ? field
        : null;
}
export function fieldData(field: NativeField): EditorFieldData {
    const attrs = JSON.parse(JSON.stringify(field.attributes));
    return { ...attrs, id: field.id, name: String(attrs.name ?? ''), type: attrs.type, settings: attrs.settings ?? {} };
}
export function fieldDraft(entry: FieldPaletteEntry): FieldDraft {
    return {
        type: entry.type,
        name: entry.name,
        participant_id: entry.participant_id,
        value: entry.value,
        settings: getDefaultVariableSettings(entry.type),
    };
}

export interface EditorReport {
    engine: 'midad';
    documentReadyMs: number | null;
    readinessLimitMs: number;
    performancePassed: boolean;
    pages: number;
    glyphs: number;
    revision: number;
    layoutMs: number | null;
    mountedCanvases: number;
}

export interface DocumentEditorEvents {
    change: [document: NativeDocument];
    ready: [report: EditorReport];
    error: [error: unknown];
    reviewPick: [id: string];
    chromeHeight: [height: number];
    fieldDetails: [id: string];
    fieldValue: [id: string, anchor: HTMLElement];
    fieldPalette: [];
    pageLayoutApplied: [layout: PageLayout];
    outlineRequested: [];
}
