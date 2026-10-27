export type ToolGroup =
    | 'history'
    | 'type'
    | 'marks'
    | 'color'
    | 'align'
    | 'lineheight'
    | 'direction'
    | 'indent'
    | 'lists'
    | 'insert'
    | 'bilingual'
    | 'page';

import type { InsertCapabilities } from '@saad5400/midad/content/capabilities';
import type { NativeNode } from '@saad5400/midad/document';
import type { BlockFormat, FormatCommand, SelectionStyle } from '@saad5400/midad/formatting';
import type { NativeLabels } from '@saad5400/midad/labels';
import type { ListKind } from '@saad5400/midad/lists';
import type { TableCommand } from '@saad5400/midad/tables';

export interface NativeToolbarState {
    labels: NativeLabels;
    active: boolean;
    canInsertObjects?: boolean;
    fixedPages?: boolean;
    textStyle: SelectionStyle;
    block?: NativeNode;
    direction: 'ltr' | 'rtl';
    code?: boolean;
    listKind?: ListKind;
    inTable?: boolean;
    tableLocked?: boolean;
    selectingCells?: boolean;
    canMerge?: boolean;
    canSplit?: boolean;
    hasField?: boolean;
    fieldAlign?: string;
    hasImage?: boolean;
    canUploadImage?: boolean;
    hideObjects?: boolean;
    insert?: InsertCapabilities;
    embedded?: boolean;
    ready?: boolean;
    canUndo?: boolean;
    canRedo?: boolean;
    hideExport?: boolean;
    exporting?: boolean;
    printing?: boolean;
    pageSetupBusy?: boolean;
    bilingualBusy?: boolean;
    bilingualOpen?: boolean;
    bilingualWorking?: boolean;
    bilingualFailed?: boolean;
    bilingualMessage?: string;
    bilingualSplit?: boolean;
    bilingualPopupId?: string;
    clausesBusy?: boolean;
    pageCount?: number;
    outlineOpen?: boolean;
    outlineCount?: number;
    outlineReady?: boolean;
    findOpen?: boolean;
    findReady?: boolean;
    zoomMode?: string;
    automaticZoom?: number;
    zoomOutDisabled?: boolean;
    zoomInDisabled?: boolean;
}

export interface NativeToolbarActions {
    closeGroup?(): void;
    format(command: FormatCommand, focus?: boolean): void;
    block(patch: BlockFormat): void;
    style(key: string, event: Event): void;
    heading(value: string): void;
    list(kind: ListKind): void;
    indent(lift: boolean): void;
    table(command: TableCommand): void;
    insertTable(rows: number, columns: number, header: boolean): void;
    cells(): void;
    merge(): void;
    split(): void;
    insertField(): void;
    editField(): void;
    insertImage(): void;
    editImage(): void;
    link(): void;
    undo(): void;
    redo(): void;
    export(): void;
    pageSetup(): void;
    bilingual(): void;
    clauses(): void;
}

export { preserveSurfaceFocus as keepEditingFocus } from '@saad5400/midad/browser';
