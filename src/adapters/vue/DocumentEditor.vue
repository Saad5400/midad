<script setup lang="ts">
import { NativeReviewViolation } from '../../editing/proposals.js';
import { useNativeFind } from './use-find.js';
import type { DocumentEditorProps } from './props.js';
import Page from './Page.vue';
import type { PageViewState } from '../../browser/view/page-view.js';
import PdfPage from './PdfPage.vue';
import {
    editorChromeKey,
    EmptyChrome,
    fieldData,
    fieldDraft,
    parseFieldPalette,
    type EditorChrome,
    type EditorReport,
    type DocumentEditorEvents,
    type EditorIntegration,
    type EditorFieldData as VariableData,
    type FieldPaletteEntry as VariablePaletteEntry,
    type EditorReviewHighlight as ReviewHighlight,
    type EditorReviewPolicy,
    type PageOrientationController,
    type ClipboardAction,
    type BlockAction,
} from './integration.js';
import type { MediaResolver } from '../../rendering/assets.js';
import { scrollingContainer, SelectionScroller } from '../../browser/input/autoscroll.js';
import {
    bilingualContext,
    bilingualOptions,
    bilingualRows,
    bilingualRowsInScope,
    bilingualScopeState,
    bilingualScopeTargets,
    configureBilingual,
    droppedLanguages,
    endBilingual,
    setBilingualSettings,
    type BilingualOptions,
    type BilingualScope,
} from '../../content/bilingual/columns.js';
import { BilingualTranslationRunner, type BilingualTranslationStatus } from '../../content/bilingual/runner.js';
import type { BilingualApplied, BilingualTranslator } from '../../content/bilingual/translation.js';
import { blockContext, deleteBlock, moveBlock, moveBlockStep } from '../../editing/blocks.js';
import { composeCommandMenu, emptyWritingPosition, type EmptyWritingPosition } from '../../browser/index.js';
import type { TableControlEdit as NativeTableEdit } from '../../browser/commands/index.js';
import { InputQueue, PrintShortcut, TypingHistory } from '../../browser/input/index.js';
import {
    caretViewportRect,
    DocumentLayoutController,
    EditingOverlayView,
    PdfPrintController,
    selectionOverlayGeometry,
    selectionViewportRectangles,
    type EditingOverlayFrame,
} from '../../browser/view/index.js';
import { ViewportReadiness } from '../../browser/view/viewport-readiness.js';
import { persistClauseNumbers } from '../../content/clauses/numbering.js';
import {
    changeClauseVariant,
    clauseContext,
    insertNativeClause,
    nativeClauses,
    persistClauseVariants,
    removeNativeClause,
    setClauseProperties,
    type ClauseProperties,
    type ClauseVariantAction,
    type LibraryClause,
} from '../../content/clauses/commands.js';
import {
    clipboardPayload,
    NATIVE_CLIPBOARD_TYPE,
    NATIVE_WEB_CLIPBOARD_TYPE,
    pasteFragment,
    plainTextFragment,
    readClipboard,
    type NativeFragment,
} from '../../interchange/clipboard.js';
import { insertCapabilities, type InsertCapabilities } from '../../content/capabilities.js';
import { applyDocumentCommand } from '../../content/commands.js';
import {
    fieldDetailsPatch,
    FieldEditQueue,
    getDefaultVariableDimensions,
    VARIABLE_CONFIGS,
    type FieldPatch,
} from '../../content/fields/index.js';
import { initializeDocumentTypography } from '../../content/typography.js';
import {
    applyDocumentEdit,
    DocumentSession,
    exportDocument,
    findNode,
    importDocument,
    type Attributes,
    type Json,
    type NativeDocument,
    type NativeMark,
    type NativeNode,
} from '../../document/index.js';
import {
    blockText,
    commandSelection,
    isTextBlock,
    joinPreviousTextBlock,
    nodePath,
    replaceBlockNode,
    replaceInlineText,
    runDocumentCommand,
    splitTextBlock,
    textBlocks,
    textDifference,
    writeAtPosition,
    type TextCaret,
    type WritingResult,
} from '../../editing/index.js';
import {
    inlineNativeField,
    insertFloatingNativeField,
    placeNativeField,
    transformField,
    type FieldBounds,
    type FieldPlacement,
} from '../../content/fields/placement.js';
import {
    createNativeFieldAttributes,
    fieldDisplayValue,
    fieldSettings,
    fieldStyle,
    insertNativeField,
    nativeFields,
    removeNativeField,
    stampNativeFields,
    updateNativeField,
    type FieldDraft,
} from '../../content/fields/commands.js';
import { bindFloatingAnchors } from '../../content/floating-anchors.js';
import { documentFontReplacements } from '../../typography/fonts.js';
import {
    changeTextMarks,
    formatBlock,
    formatText,
    linkedRangeAtCaret,
    marksAtCaret,
    normalizeLink,
    selectionCodeState,
    selectionTextStyle,
    type BlockFormat,
    type FormatCommand,
    type SelectionStyle,
} from '../../editing/formatting.js';
import { persistNativeIdentities } from '../../document/identities.js';
import {
    inlineNativeImage,
    insertFloatingNativeImage,
    insertNativeImage,
    nativeImages,
    placeNativeImage,
    removeNativeImage,
    stampNativeImages,
    updateNativeImage,
    type AttachmentUpload,
    type ImageDraft,
    type ImageUpload,
} from '../../content/images.js';
import { initialTextCaret, keyboardShortcut, SelectionController } from '../../browser/input/interaction.js';
import { NATIVE_READY_LIMIT_MS, NativeTextKernel } from '../../rendering/kernel.js';
import { nativeLabels } from '../../browser/labels.js';
import { cellAt, hitTest, type DocumentScene } from '../../layout/index.js';
import {
    indentList,
    joinListItem,
    listContext,
    splitListItem,
    toggleList,
    type ListKind,
    type StructureResult,
} from '../../editing/lists.js';
import { NativeNavigation, type CaretAffinity } from '../../browser/input/navigation.js';
import { documentOutline, type OutlineGroup, type OutlineHeading } from '../../layout/outline.js';
import {
    documentPageLayout,
    pageLayoutForPage,
    setDocumentPageLayout,
    setPageLayout,
    type PageLayout,
} from '../../content/page-layout.js';
import { documentPresentation, setDocumentPresentation, type NativePresentation } from '../../content/presentation.js';
import { readImageFile } from '../../rendering/raster-image.js';
import {
    replaceSelection,
    selectedText,
    selectionRanges,
    selectNodeText,
    type NativeSelection,
} from '../../editing/selection.js';
import { documentTextStyle, nodeTextStyle } from '../../typography/style.js';
import type { NativePeer } from '../../collaboration/client.js';
import { tableRectangle, type TableCellSelection } from '../../editing/table-grid.js';
import {
    insertTable,
    mergeTableCells,
    resizeTableColumns,
    setTableRowHeight,
    splitTableCell,
    tableCommand,
    tableContext,
    tabTable,
    type TableCommand,
} from '../../editing/tables.js';
import { inheritedDirection } from '../../typography/index.js';
import { POINT_TO_PIXEL, VIEW_ZOOM_MAX, VIEW_ZOOM_MIN, viewZoom } from '../../browser/view/viewport.js';
import { toRaw, computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, shallowRef, watch } from 'vue';
import type { PdfSource as NativePdfSource } from '../../pdf/reading/index.js';
import { useNativeCommands, type NativeCommandContext, type NativeCommandMenuItem } from './use-commands.js';

const props = defineProps<DocumentEditorProps>();
const chrome = computed(() => props.chrome ?? {});
provide(editorChromeKey, chrome);
const NativeBilingualPanel = computed(() => toRaw(chrome.value.NativeBilingualPanel ?? EmptyChrome));
const NativeClausePanel = computed(() => toRaw(chrome.value.NativeClausePanel ?? EmptyChrome));
const NativeCommandContextMenu = computed(() => toRaw(chrome.value.NativeCommandContextMenu ?? EmptyChrome));
const NativeCommandPopup = computed(() => toRaw(chrome.value.NativeCommandPopup ?? EmptyChrome));
const NativeFieldPanel = computed(() => toRaw(chrome.value.NativeFieldPanel ?? EmptyChrome));
const NativeFindPanel = computed(() => toRaw(chrome.value.NativeFindPanel ?? EmptyChrome));
const NativeImagePanel = computed(() => toRaw(chrome.value.NativeImagePanel ?? EmptyChrome));
const NativeOutlinePanel = computed(() => toRaw(chrome.value.NativeOutlinePanel ?? EmptyChrome));
const NativePage = computed(() => toRaw(chrome.value.NativePage ?? Page));
const NativePageSetup = computed(() => toRaw(chrome.value.NativePageSetup ?? EmptyChrome));
const NativePdfPage = computed(() => toRaw(chrome.value.NativePdfPage ?? PdfPage));
const NativeSelectionMenu = computed(() => toRaw(chrome.value.NativeSelectionMenu ?? EmptyChrome));
const NativeTableControls = computed(() => toRaw(chrome.value.NativeTableControls ?? EmptyChrome));
const NativeToolbar = computed(() => toRaw(chrome.value.NativeToolbar ?? EmptyChrome));
const PagesPanelToggle = computed(() => toRaw(chrome.value.PagesPanelToggle ?? EmptyChrome));
const trans = (key: string) => props.integration?.translate?.(key) ?? key;
const bilingualT = (key: string) => props.integration?.bilingualTranslate?.(key) ?? key;
const paletteEntry = (value: unknown) => (props.integration?.parseField ?? parseFieldPalette)(value);
const paletteDraft = (...args: Parameters<NonNullable<EditorIntegration['fieldDraft']>>) =>
    (props.integration?.fieldDraft ?? fieldDraft)(...args);
const variableForUi = (field: Parameters<typeof fieldData>[0]) => (props.integration?.fieldForUi ?? fieldData)(field);
const fieldMime = computed(() => props.integration?.fieldMime ?? 'application/x-midad-field');
const nativeCommandMenu = (state: Parameters<NonNullable<EditorIntegration['commandMenu']>>[0]) =>
    props.integration?.commandMenu?.(state) ?? [];
const nativeDocumentCommand = (...args: Parameters<NonNullable<EditorIntegration['command']>>) =>
    props.integration?.command?.(...args);
const emit = defineEmits<DocumentEditorEvents>();
const insertion = computed(() =>
    insertCapabilities(
        { ...props.insert, ...(props.loadPdf ? { tables: false, clauses: false, bilingual: false } : {}) },
        !!props.textOnly,
    ),
);
const responsiveWidth = computed(() => (props.embedded ? props.reflowWidth : undefined));
const pdfSource = shallowRef<NativePdfSource>();
const pdfFingerprint = ref<string>();
const pdfController = new AbortController();
const pdfPainted = ref(new Set<number>());
const pdfFailures = ref(new Set<number>());
const pdfRetries = reactive(new Map<number, number>());
const layoutDocument = (document: NativeDocument, renderer: NativeTextKernel): DocumentScene =>
    layoutController.layout(document, renderer);
const started = props.startedAt ?? performance.now();
const labels = computed(() => ({ ...nativeLabels[props.locale ?? 'ar'], ...props.labels }));
const initial = importDocument(props.content, props.documentId);
const session = new DocumentSession(
    !props.readonly && !props.embedded && !props.reviewPolicy && !props.loadPdf
        ? initializeDocumentTypography(initial)
        : initial,
);
const typingHistory = new TypingHistory();
const historyHighlightNodes = computed(() => {
    void documentRevision.value;
    const nodes = new Map<string, 'added' | 'removed' | 'modified' | 'moved'>();
    if (!props.historyHighlights?.length) return nodes;
    const index = new Map<string, NativeNode>();
    const indexNode = (node: NativeNode): void => {
        index.set(node.id, node);
        node.children?.forEach(indexNode);
    };
    indexNode(session.document.root);
    for (const highlight of props.historyHighlights ?? []) {
        const node = index.get(highlight.id);
        if (!node) {
            nodes.set(highlight.id, highlight.kind);
            continue;
        }
        if (node.kind === 'doc') continue;
        const visit = (part: NativeNode): void => {
            nodes.set(part.id, highlight.kind);
            part.children?.forEach(visit);
        };
        visit(node);
    }
    return nodes;
});
const documentRevision = ref(session.document.revision);
const fontReplacements = computed(() => {
    void documentRevision.value;
    return documentFontReplacements(session.document);
});
const canUndo = ref(false);
const canRedo = ref(false);
let clauseController: AbortController | undefined;
const clauseInitialTab = ref<'library'>();
const clausePanelOpen = ref(false),
    clauseBusy = ref(false),
    clauseError = ref('');
const clauseInitialId = ref<string>();
let pendingClauseCaret: TextCaret | undefined;
const editorDocument = computed(() => {
    void documentRevision.value;
    return session.document;
});
function openClauses(): void {
    clauseInitialTab.value = undefined;
    clauseInitialId.value = clauseContext(session.document, activeBlock.value ?? undefined)?.id;
    clauseError.value = '';
    pendingClauseCaret = undefined;
    clausePanelOpen.value = true;
}
async function closeClauses(): Promise<void> {
    clauseController?.abort();
    clauseController = undefined;
    clauseBusy.value = false;
    clausePanelOpen.value = false;
    commands.endPending('library');
    await nextTick();
    const target = pendingClauseCaret;
    pendingClauseCaret = undefined;
    if (
        target &&
        findNode(session.document, target.blockId) &&
        scene.value?.pages.some((page) => page.lines.some((line) => line.paragraphId === target.blockId))
    )
        await placeCaret(target);
    else if (!scene.value?.pages.some((page) => page.lines.some((line) => line.paragraphId === activeBlock.value))) {
        const line = scene.value?.pages.flatMap((page) => page.lines)[0];
        if (line) await placeCaret({ blockId: line.paragraphId, offset: 0 });
        else {
            clearTextInput();
            caret.value = null;
            selection.value = [];
        }
    } else input.value?.focus({ preventScroll: true });
}
async function clauseAction(
    operation: (document: NativeDocument) => NativeDocument | WritingResult | Promise<NativeDocument | WritingResult>,
    close = false,
    prepare?: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
    if (props.readonly || !kernel.value || !sceneCurrent.value || clauseBusy.value) return;
    const controller = new AbortController();
    clauseController = controller;
    clauseBusy.value = true;
    clauseError.value = '';
    try {
        if (prepare) await prepare(controller.signal);
        if (controller.signal.aborted) return;
        if (disposed || props.readonly || props.reviewPolicy) throw new Error('Clause editing is unavailable');
        const base = session.document;
        const result = await operation(base);
        const document = 'document' in result ? result.document : result;
        if (document === base) return;
        await kernel.value.prepare(document);
        const prepared = layoutDocument(document, kernel.value);
        if (controller.signal.aborted) return;
        if (disposed || props.readonly || props.reviewPolicy || session.document !== base)
            throw new Error('The document changed during clause editing');
        if (!(await commit(document))) return;
        scene.value = prepared;
        if ('caret' in result) pendingClauseCaret = result.caret;
        activeFieldId.value = undefined;
        activeImageId.value = undefined;
        emit('change', document);
        if (close) await closeClauses();
        else {
            await nextTick();
            updateCaret();
        }
    } catch (failure) {
        if (!controller.signal.aborted) {
            clauseError.value = labels.value.invalidClause;
            emit('error', failure);
            await render();
        }
    } finally {
        if (clauseController === controller) {
            clauseController = undefined;
            clauseBusy.value = false;
        }
    }
}
async function insertClause(source?: LibraryClause): Promise<void> {
    const pending = commands.pending.value?.kind === 'library' ? commands.pending.value.context : undefined;
    const at = nativeSelection()?.focus;
    const position = vacantPosition();
    let prepared = source;
    await clauseAction(
        (document) => {
            if (pending) {
                if (!commands.valid(pending)) throw new Error('The insertion target changed');
                return (
                    applyDocumentCommand(
                        document,
                        pending.selection,
                        { kind: 'clause', source: prepared },
                        { target: pending.target, trigger: pending.trigger },
                    ) ?? document
                );
            }
            if (at || !position) return insertNativeClause(document, at, prepared);
            return (
                writeAtPosition(document, null, position.target, (working, selected) =>
                    insertNativeClause(working, selected.focus, prepared),
                ) ?? document
            );
        },
        true,
        async (signal) => {
            if (source && props.prepareLibraryClause) prepared = await props.prepareLibraryClause(source, signal);
        },
    );
}
function clauseProperties(id: string, patch: ClauseProperties): void {
    void clauseAction((document) => setClauseProperties(document, id, patch));
}
function clauseVariant(id: string, action: ClauseVariantAction): void {
    void clauseAction((document) => changeClauseVariant(document, id, action));
}
function removeClause(id: string, unwrap: boolean): void {
    void clauseAction((document) => removeNativeClause(document, id, unwrap));
}
async function editClause(id: string): Promise<void> {
    const clause = nativeClauses(session.document).find((node) => node.id === id);
    const node = clause?.attributes?.isTitleHidden
        ? clause.children?.find((child) => child.kind === 'clauseBody')
        : clause;
    const block = node && textBlocks(node)[0];
    if (block) pendingClauseCaret = { blockId: block.id, offset: 0 };
    await closeClauses();
}
const editorRoot = ref<HTMLElement>();
const pagesElement = ref<HTMLElement>();
const zoomMode = ref('auto');
const zoomSteps = [10, 25, 50, 75, 100, 125, 150, 200, 300, 400];
const viewBox = ref({ width: 1024, height: 768 });
let viewObserver: ResizeObserver | undefined;
const kernel = shallowRef<NativeTextKernel>();
let releaseKernel: (() => void) | undefined;
const scene = shallowRef<DocumentScene>();
const layoutController = new DocumentLayoutController({
    kernel: () => kernel.value,
    surface: () =>
        pdfSource.value
            ? { kind: 'pdf', pages: pdfSource.value.pages }
            : { kind: 'flow', width: responsiveWidth.value },
    validate: (document) => {
        if (pdfSource.value && document.root.attributes?.nativePdfSource !== pdfFingerprint.value)
            throw new Error('The imported PDF source changed. Reload the document.');
    },
});
watch(scene, (value) => layoutController.display(session.document, value), { flush: 'sync' });

const outlinePreference = ref<boolean | null>(null);
const outlineHostVisible = ref(true);
const outlineAutoOpen = ref(false);
const outlineMobile = ref(false);
const outlineActivate = ref(false);
const outlineTop = ref('4rem');
const outlineGroups = shallowRef<readonly OutlineGroup[]>([]);
const outlineOpen = computed(
    () =>
        !props.embedded &&
        !props.endPanelOpen &&
        outlineHostVisible.value &&
        !clausePanelOpen.value &&
        (outlinePreference.value ?? outlineAutoOpen.value),
);
const outlineCount = computed(() => outlineGroups.value.reduce((count, group) => count + group.headings.length, 0));
watch([scene, documentRevision], () => {
    if (scene.value?.documentId === session.document.id && scene.value.revision === session.document.revision)
        outlineGroups.value = documentOutline(session.document, scene.value);
});
function editorChrome(): { bottom: number; height: number } {
    const root = editorRoot.value;
    const boxes = [
        ...(root?.querySelectorAll<HTMLElement>('.native-format-toolbar, .native-controls, .native-find-panel') ?? []),
    ]
        .filter((element) => element.getClientRects().length)
        .map((element) => element.getBoundingClientRect());
    return {
        bottom: Math.max(0, root?.getBoundingClientRect().top ?? 0, ...boxes.map((box) => box.bottom)),
        height: boxes.reduce((sum, box) => sum + box.height, 0),
    };
}
function updateOutlinePosition(): void {
    outlineTop.value = `${editorChrome().bottom}px`;
}
function toggleOutline(): void {
    outlineActivate.value = true;
    outlinePreference.value = !outlineOpen.value;
    if (outlinePreference.value) emit('outlineRequested');
}
function focusOutlineControls(): void {
    if (toolbar.value) void toolbar.value.focusOutlineControls?.();
    else
        void nextTick(() =>
            editorRoot.value
                ?.querySelector<HTMLButtonElement>('[data-outline-trigger]')
                ?.focus({ preventScroll: true }),
        );
}
function closeOutline(): void {
    outlinePreference.value = false;
    focusOutlineControls();
}
async function jumpOutline(heading?: OutlineHeading): Promise<void> {
    if (!sceneCurrent.value) return;
    if (outlineMobile.value) outlinePreference.value = false;
    await nextTick();
    if (!sceneCurrent.value) return;
    if (heading) {
        heading = outlineGroups.value.flatMap((group) => group.headings).find((item) => item.id === heading!.id);
        if (!heading) return;
    }
    const pageIndex = heading ? heading.page - 1 : 0;
    const target = pagesElement.value?.querySelector<HTMLElement>(`[data-page="${pageIndex + 1}"]`);
    if (!target) return;
    const container = scrollingContainer(target);
    const bounds = container === document.scrollingElement ? { top: 0 } : container.getBoundingClientRect();
    const top = Math.max(bounds.top, Number.parseFloat(outlineTop.value) || 0) + 16;
    const offset = (heading?.top ?? 0) * viewScale.value;
    container.scrollTop += target.getBoundingClientRect().top + offset - top;
    if (outlineMobile.value) focusOutlineControls();
}
watch(outlineOpen, () => {
    void nextTick(measureView);
});
watch(pagesElement, (next, previous) => {
    if (previous) viewObserver?.unobserve(previous);
    if (next) viewObserver?.observe(next);
});
const viewPageSize = computed(() => ({
    width: Math.max(responsiveWidth.value ?? 595.275, ...(scene.value?.pages.map((page) => page.width) ?? [])),
    height: Math.max(0, ...(scene.value?.pages.map((page) => page.height) ?? [841.89])),
}));
const viewZoomFactor = computed(() => viewZoom(zoomMode.value, viewPageSize.value, viewBox.value));
const automaticZoom = computed(() => viewZoom('auto', viewPageSize.value, viewBox.value));
const viewScale = computed(() => POINT_TO_PIXEL * viewZoomFactor.value);
watch(viewScale, () => pdfPainted.value.clear());
function measureView(): void {
    const pages = pagesElement.value;
    if (!pages) return;
    const style = getComputedStyle(pages);
    outlineHostVisible.value = pages.getClientRects().length > 0 && pages.clientWidth > 0;
    outlineMobile.value = innerWidth < 1024;
    const chrome = editorChrome();
    outlineTop.value = `${chrome.bottom}px`;
    const reserved = outlineOpen.value && !outlineMobile.value ? 204 : 0;
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    outlineAutoOpen.value =
        !outlineMobile.value &&
        pages.clientWidth + reserved - padding > viewPageSize.value.width * viewScale.value + 204 + 40;
    emit('chromeHeight', chrome.height);
    const width = Math.max(1, pages.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    const height = Math.max(96, innerHeight - chrome.bottom - 56);
    if (viewBox.value.width !== width || viewBox.value.height !== height) viewBox.value = { width, height };
}
async function changeZoom(mode: string): Promise<void> {
    const pages = pagesElement.value;
    if (!pages) return;
    const top = editorChrome().bottom;
    const selectionAnchor = caret.value ?? selection.value[0];
    const preserveSelection = selectionAnchor && selectionAnchor.top >= top && selectionAnchor.top < innerHeight;
    const y = preserveSelection ? selectionAnchor.top + selectionAnchor.height / 2 : top + (innerHeight - top) / 2;
    const pageElements = [...pages.querySelectorAll<HTMLElement>('.native-page')];
    const anchor = pageElements
        .map((element) => ({ element, box: element.getBoundingClientRect() }))
        .sort((a, b) => Math.max(a.box.top - y, 0, y - a.box.bottom) - Math.max(b.box.top - y, 0, y - b.box.bottom))[0];
    const anchorY = anchor ? Math.max(anchor.box.top, Math.min(anchor.box.bottom, y)) : y;
    const pointY = anchor ? (anchorY - anchor.box.top) / viewScale.value : 0;
    const x = preserveSelection
        ? selectionAnchor.left
        : Math.max(0, pages.getBoundingClientRect().left) + Math.min(innerWidth, pages.clientWidth) / 2;
    const pointX = anchor ? (x - anchor.box.left) / viewScale.value : 0;
    zoomMode.value = mode;
    measureView();
    await nextTick();
    if (anchor?.element.isConnected) {
        const box = anchor.element.getBoundingClientRect();
        scrollingContainer(pages).scrollTop += box.top + pointY * viewScale.value - anchorY;
        pages.scrollLeft += box.left + pointX * viewScale.value - x;
    }
    scheduleCaretUpdate();
}
function zoomBy(direction: -1 | 1): void {
    void changeZoom(
        String(
            Math.max(
                VIEW_ZOOM_MIN * 100,
                Math.min(VIEW_ZOOM_MAX * 100, Math.round(viewZoomFactor.value * 10) * 10 + direction * 10),
            ),
        ),
    );
}
watch(viewScale, async () => {
    stopSelectionScroll();
    endHandle();
    await nextTick();
    updateCaret();
});
const validatingEdits = ref(0);
const queuedInputs = ref(0);
const pendingTextInputs = ref(0);
const sceneCurrent = computed(
    () =>
        !error.value &&
        !paintFailures.size &&
        !pdfFailures.value.size &&
        scene.value?.revision === documentRevision.value &&
        (responsiveWidth.value === undefined ||
            Math.abs((scene.value?.pages[0]?.width ?? 0) - responsiveWidth.value) < 0.002),
);
const error = ref('');
const paintFailures = reactive(new Map<number, unknown>());
let paintErrorMessage: string | undefined;
const interactionError = ref('');
const clipboardBusy = ref(false);
let floatingFieldClipboard: { attributes: Attributes; placement: FieldPlacement } | undefined;
const selectionMenu = ref<{ focus: () => void }>();
const menuAt = ref<{ left: number; top: number } | null>(null);
const blockMenuId = ref<string>();
const contextMenuView = ref<{ focus: () => void }>();
const menuContext = shallowRef<NativeCommandContext>();
const menuMode = ref<'context' | 'block' | 'add'>('context');
const gutterMenuId = ref<string>();
const gutterContexts = computed(() => {
    void documentRevision.value;
    const path = activeBlock.value ? nodePath(session.document, activeBlock.value) : [];
    const fallback = session.document.root.attributes?.dir === 'ltr' ? 'ltr' : 'rtl';
    return Object.fromEntries(
        (session.document.root.children ?? []).map((node) => [
            node.id,
            {
                direction: inheritedDirection(node, fallback),
                ...(node.kind === 'parallelRow' && !node.attributes?.show
                    ? {
                          columns: node.children?.map((cell) => cell.id),
                          activeColumn: path[1]?.id === node.id ? path[2]?.id : undefined,
                      }
                    : {}),
            },
        ]),
    );
});
const gutterActive = computed(() => {
    void documentRevision.value;
    if (
        !inputFocused.value ||
        !activeBlock.value ||
        documentSelection.value ||
        input.value?.selectionStart !== input.value?.selectionEnd
    )
        return;
    return { id: blockContext(session.document, activeBlock.value)?.node.id, page: caretPageIndex() };
});

function focusContextMenu(): void {
    (contextMenuView.value ?? selectionMenu.value)?.focus?.();
}
const blockDrag = shallowRef<{
    id: string;
    target?: string;
    side?: 'before' | 'after';
    left?: number;
    top?: number;
    width?: number;
}>();
const menuHeight = ref(56);
let plainPaste = false;
const readyMs = ref<number | null>(null);
const shapeMs = ref<number | null>(null);
const input = ref<HTMLTextAreaElement>();
const editingOverlayHost = ref<HTMLElement>();
let editingOverlay: EditingOverlayView | undefined;
const inputFocused = ref(false);
const activeBlock = ref<string | null>(null);
const inheritedMenuOptions = computed(() => props.menuOptions ?? {});
const commands = useNativeCommands({
    document: () => session.document,
    selection: nativeSelection,
    target: () => vacantPosition()?.target,
    marks: () => storedMarks.value,
    objectId: () => selectedField.value?.id ?? selectedImage.value?.id,
    enabled: () =>
        !!chrome.value.NativeCommandPopup &&
        !props.readonly &&
        !props.reviewPolicy &&
        sceneCurrent.value &&
        !applyingInput.value &&
        !mediaBusy.value &&
        !sharedApplying.value &&
        inputFocused.value &&
        document.activeElement === input.value &&
        !menuAt.value &&
        !imagePanelOpen.value &&
        !bilingualOpen.value &&
        !clausePanelOpen.value &&
        !fieldPanelOpen.value &&
        !activeFieldId.value &&
        !activeImageId.value,
});
watch(commands.pending, (next, previous) => {
    if (!previous || next?.kind === previous.kind) return;
    if (previous.kind === 'library') {
        clauseController?.abort();
        clauseController = undefined;
        clauseBusy.value = false;
        clausePanelOpen.value = false;
    }
    if (previous.kind === 'image') {
        mediaController?.abort();
        imagePanelOpen.value = false;
    }
    if (previous.kind === 'bilingual') bilingualOpen.value = false;
});
const slashTrigger = commands.trigger;
const commandPalette = commands.palette;
const commandPaletteId = `native-commands-${crypto.randomUUID()}`;
function commandWritingDirection(context: NativeCommandContext): 'rtl' | 'ltr' {
    let direction = toolbarDirection.value;
    if (context.trigger) {
        try {
            runDocumentCommand(
                session.document,
                context.selection,
                context.target,
                context.trigger,
                (working, selected) => {
                    direction = nodePath(working, selected.focus.blockId).reduce<'ltr' | 'rtl'>(
                        (value, node) => inheritedDirection(node, value),
                        'rtl',
                    );
                    return undefined;
                },
            );
        } catch {
            return direction;
        }
    }
    return direction;
}
const commandGroups = computed(() => {
    void documentRevision.value;
    const exclude = [
        ...(inheritedMenuOptions.value.exclude ?? []),
        ...(props.menuExclude ?? []),
        ...(menuAt.value && menuMode.value === 'context' ? ['bilingual'] : []),
    ];
    const base = nativeCommandMenu({
        label: (key) => trans(`menu.${key}`),
        direction: commandWritingDirection(commands.context(!!slashTrigger.value)),
        textOnly: !!props.textOnly,
        insert: insertion.value,
        canUploadImage: !!props.uploadImage,
        block: toolbarBlock.value,
        list: toolbarList.value,
        style: formatState.value,
        field: !!selectedField.value,
        exclude,
    });
    return composeCommandMenu<NativeCommandMenuItem>(
        base,
        props.loadClauseLibrary && !props.textOnly && !props.embedded
            ? [
                  {
                      id: 'insert',
                      icon: 'add-square',
                      label: trans('menu.insert'),
                      items: [
                          {
                              id: 'clause-library',
                              label: trans('library.title'),
                              icon: 'books',
                              keywords: ['library', 'catalog', 'clause library', 'مكتبة', 'بنود'],
                          },
                      ],
                  },
              ]
            : [],
        { exclude },
    );
});
const contextCommandGroups = computed(() => {
    if (selectedImage.value?.floating) return [];
    return selectedField.value?.floating
        ? commandGroups.value.filter((group) => ['format', 'paragraph'].includes(group.id))
        : commandGroups.value;
});
const templateBoxes = computed(() => {
    void documentRevision.value;
    return commands.templateRanges.value.flatMap((range) =>
        rangeRectangles({
            anchor: { blockId: range.blockId, offset: range.from },
            focus: { blockId: range.blockId, offset: range.to },
        }).map((box) => ({ ...box, id: range.id, active: range.active })),
    );
});
function menuLabel(key: string, fallback: string): string {
    const value = trans(key);
    return value === key ? fallback : value;
}
async function runMenuItem(item: NativeCommandMenuItem, context = commands.context()): Promise<void> {
    if (props.readonly || props.reviewPolicy || !sceneCurrent.value || mediaBusy.value || !kernel.value) return;
    if (!commands.valid(context)) {
        interactionError.value = labels.value.invalidBlock;
        return;
    }
    refreshFormatting();
    commands.dismiss();
    if (item.id === 'clause-library') {
        if (!props.loadClauseLibrary || props.textOnly || props.embedded) return;
        closeMenu(false);
        commands.beginPending('library', context);
        openClauses();
        clauseInitialTab.value = 'library';
        return;
    }
    if (item.id === 'image' || item.id === 'bilingual') {
        closeMenu(false);
        commands.beginPending(item.id, context);
        if (item.id === 'image') openImage();
        else openBilingual();
        return;
    }
    const selection = context.selection;
    const rawName =
        selection && !selection.cells && selection.anchor.blockId === selection.focus.blockId
            ? blockText(findNode(session.document, selection.anchor.blockId)!)
                  .slice(
                      Math.min(selection.anchor.offset, selection.focus.offset),
                      Math.max(selection.anchor.offset, selection.focus.offset),
                  )
                  .trim()
            : '';
    const action = nativeDocumentCommand(item.id, {
        direction: commandWritingDirection(context),
        style: formatState.value,
        selectionName: rawName && rawName.length <= 80 && !rawName.includes('\uFFFC') ? rawName : undefined,
        label: (key) => menuLabel(`menu.${key}`, labels.value.fieldName),
        clauseTitle: menuLabel('clause.title', labels.value.clausePlaceholderTitle),
        clauseBody: menuLabel('clause.body', labels.value.clausePlaceholderBody),
    });
    if (!action) return;
    closeMenu(false);
    blockMenuId.value = undefined;
    if (!context.trigger && action.kind === 'format') {
        await applyFormat(action.format);
        return;
    }
    if (!context.trigger && action.kind === 'block' && selectedField.value) {
        await applyBlockFormat(action.attributes);
        return;
    }
    try {
        const result = applyDocumentCommand(session.document, context.selection, action, {
            trigger: context.trigger,
            target: context.target,
            marks: context.marks,
        });
        if (!result) return;
        if (!['format', 'block'].includes(action.kind)) {
            commands.live.cancel();
            commands.templateRevision.value++;
        }
        if (!(await commit(result.document))) return;
        storedMarks.value = result.marks;
        if (result.template) {
            const selected = commands.live.start(session.document, result.template);
            commands.templateRevision.value++;
            if (selected) setSelection(selected.anchor, selected.focus);
        } else if (result.caret) setSelection(result.caret, result.caret);
        if (result.fieldId) selectField(result.fieldId);
        if (result.marks !== undefined) storedPosition = selectionKey();
        emit('change', session.document);
        await render();
        updateCaret();
        const focus = nativeSelection()?.focus;
        if (focus) revealCaret(focus);
    } catch (failure) {
        interactionError.value = labels.value.invalidBlock;
        emit('error', failure);
    }
}
function runSlashItem(item: NativeCommandMenuItem): void {
    if (!slashTrigger.value) return;
    void runMenuItem(item, commands.context(true));
}

const emptyPosition = shallowRef<EmptyWritingPosition>();
function clearTextInput(): void {
    activeBlock.value = null;
    commands.reset();
    emptyPosition.value = undefined;
    if (input.value) input.value.value = '';
    inputSelection = undefined;
    inputMarks = undefined;
    applyingInput.value = false;
}

function vacantPosition(): EmptyWritingPosition | undefined {
    if (props.readonly || !scene.value || !sceneCurrent.value || activeBlock.value) return;
    return emptyWritingPosition(
        session.document,
        scene.value,
        emptyPosition.value?.pageIndex ?? initialPage,
        undefined,
        emptyPosition.value?.target,
    );
}
const caret = ref<{ left: number; top: number; height: number } | null>(null);
const selection = shallowRef<Array<{ left: number; top: number; width: number; height: number }>>([]);
const touchSelection = ref(false);
const touchHandles = ref<Array<{ endpoint: 'start' | 'end'; left: number; top: number; height: number }>>([]);
const menuPosition = computed(() => {
    if (menuAt.value) return menuAt.value;
    if (
        !touchSelection.value ||
        !selection.value.length ||
        (!documentSelection.value?.cells && !touchHandles.value.length)
    )
        return null;
    const first = selection.value[0];
    return {
        left: Math.max(8, Math.min(innerWidth - 320, first.left)),
        top: Math.max(editorChrome().bottom + 8, first.top - menuHeight.value - 12),
    };
});
const documentSelection = shallowRef<NativeSelection | null>(null);
const selectingCells = ref(false);
const activeFieldId = ref<string>();
const fieldPanelOpen = ref(false);
const fieldPanelError = ref('');
const fieldEditRevision = ref(0);
const fieldEditError = ref('');
const fieldEdits = new FieldEditQueue(applyFieldDetails, () => fieldEditRevision.value++);
const fieldEditsPending = computed(() => {
    void fieldEditRevision.value;
    return fieldEdits.dirty;
});
const allFields = computed(() => {
    if (documentRevision.value !== session.document.revision) return [];
    return nativeFields(session.document);
});
const selectedField = computed(() => allFields.value.find((field) => field.id === activeFieldId.value));
const activeImageId = ref<string>();
const allImages = computed(() => {
    if (documentRevision.value !== session.document.revision) return [];
    return nativeImages(session.document);
});
const selectedImage = computed(() => allImages.value.find((image) => image.id === activeImageId.value));
const floatingImageIds = computed(() =>
    allImages.value.filter((image) => image.floating && !image.attributes.locked).map((image) => image.id),
);
const imagePanelOpen = ref(false),
    imagePanelError = ref(''),
    mediaBusy = ref(false);
let mediaController: AbortController | undefined;
const imagePage = computed(() => {
    const index =
        scene.value?.pages.findIndex((page) =>
            activeImageId.value
                ? page.commands.some((command) => command.kind === 'image' && command.nodeId === activeImageId.value)
                : false,
        ) ?? -1;
    return Math.max(0, index >= 0 ? index : caretPageIndex());
});
function caretPageIndex(): number {
    const focus = nativeSelection()?.focus;
    return focus ? (navigation()?.row(focus, selectionController.affinity)?.pageIndex ?? 0) : 0;
}

const imageLimits = computed(() => {
    const page = scene.value?.pages[imagePage.value];
    const margins = documentPageLayout(session.document).margins;
    return {
        width: Math.max(1, (page?.width ?? 595) / 0.75 - margins.left - margins.right),
        height: Math.max(1, (page?.height ?? 842) / 0.75 - margins.top - margins.bottom),
    };
});
const floatingFieldIds = computed(() => allFields.value.filter((field) => field.floating).map((field) => field.id));
const fieldPanelPage = computed(() => {
    const index =
        scene.value?.pages.findIndex((page) =>
            activeFieldId.value
                ? page.commands.some((command) => command.kind === 'field' && command.nodeId === activeFieldId.value)
                : false,
        ) ?? -1;
    return Math.max(0, index >= 0 ? index : caretPageIndex());
});
const selectionController = new SelectionController();
let navigationState: NativeNavigation | undefined;
const pdfBusy = ref(false);
const pageSetupOpen = ref(false),
    pageSetupBusy = ref(false),
    pageSetupError = ref('');
const bilingualOpen = ref(false),
    bilingualBusy = ref(false),
    bilingualError = ref('');
const bilingualInitial = shallowRef<BilingualOptions>(bilingualOptions());
const bilingualPreviewScope = ref<BilingualScope['kind'] | null>(null);
const bilingualPreviewIds = computed(() => {
    void documentRevision.value;
    const ids = new Set<string>();
    if (!bilingualOpen.value || !bilingualPreviewScope.value) return ids;
    try {
        const targets = bilingualScopeTargets(session.document, bilingualScope(bilingualPreviewScope.value));
        const visit = (node: NativeNode, selected = false): void => {
            selected ||= targets.has(node.id);
            if (selected) ids.add(node.id);
            node.children?.forEach((child) => visit(child, selected));
        };
        visit(session.document.root);
    } catch {
        return ids;
    }
    return ids;
});

const translationStatus = shallowRef<BilingualTranslationStatus>({
    pending: 0,
    translated: 0,
    failed: 0,
    stale: 0,
    tooLong: 0,
});
let translationRunner: BilingualTranslationRunner | undefined;
let translationTimer: ReturnType<typeof setTimeout> | undefined;
let translationMuted = false;
const queuedTranslationRows = new Set<string>();
function getTranslationRunner(): BilingualTranslationRunner | undefined {
    if (disposed || props.readonly || props.reviewPolicy || !props.bilingualTranslator) return;
    return (translationRunner ??= new BilingualTranslationRunner({
        document: () => session.document,
        apply: applyTranslationChange,
        translator: props.bilingualTranslator,
        status: (value) => {
            translationStatus.value = value;
        },
    }));
}
function resetTranslations(): void {
    clearTimeout(translationTimer);
    queuedTranslationRows.clear();
    translationRunner?.dispose();
    translationRunner = undefined;
    translationStatus.value = { pending: 0, translated: 0, failed: 0, stale: 0, tooLong: 0 };
}
watch([() => props.readonly, () => props.reviewPolicy], ([readonly, reviewPolicy]) => {
    if (readonly || reviewPolicy) resetTranslations();
});
watch(() => props.bilingualTranslator, resetTranslations);
function queueTranslations(before: NativeDocument, after: NativeDocument): void {
    if (translationMuted || !props.bilingualTranslator || props.readonly) return;
    const previous = new Map(bilingualRows(before).map((row) => [row.id, row]));
    bilingualRows(after).forEach((row) => {
        if (row.attributes?.fill === 'auto' && !row.attributes.show && previous.get(row.id) !== row)
            queuedTranslationRows.add(row.id);
    });
    clearTimeout(translationTimer);
    if (queuedTranslationRows.size)
        translationTimer = setTimeout(() => {
            const rows = [...queuedTranslationRows];
            queuedTranslationRows.clear();
            getTranslationRunner()?.start(rows);
        }, 650);
}
async function applyTranslationChange(
    change: (document: NativeDocument) => BilingualApplied,
    signal?: AbortSignal,
): Promise<BilingualApplied | undefined> {
    for (let attempt = 0; attempt < 3; attempt++) {
        if (disposed || signal?.aborted || props.readonly || props.reviewPolicy || !kernel.value) return;
        if (pdfBusy.value)
            await new Promise<void>((resolve) => {
                const finish = () => {
                    stop();
                    signal?.removeEventListener('abort', finish);
                    resolve();
                };
                const stop = watch(pdfBusy, (busy) => {
                    if (!busy) finish();
                });
                signal?.addEventListener('abort', finish, { once: true });
                if (signal?.aborted) finish();
            });
        if (disposed || signal?.aborted || props.readonly || !kernel.value) return;
        const before = session.document;
        const result = change(before);
        if (result.document === before) return result;
        await kernel.value.prepare(result.document);
        if (disposed || signal?.aborted || props.readonly || props.reviewPolicy) return;
        if (session.document !== before) continue;
        const prepared = layoutDocument(result.document, kernel.value);
        const selected = nativeSelection();
        const wasFocused = document.activeElement === input.value;
        translationMuted = true;
        try {
            if (!(await commit(result.document))) return;
        } finally {
            translationMuted = false;
        }
        scene.value = prepared;
        emit('change', result.document);
        await nextTick();
        if (selected) {
            const focus = findNode(result.document, selected.focus.blockId);
            const anchor = findNode(result.document, selected.anchor.blockId);
            if (focus && anchor && isTextBlock(focus) && isTextBlock(anchor)) {
                const old = findNode(before, focus.id);
                const offset =
                    old &&
                    !blockText(old).length &&
                    selected.anchor.blockId === focus.id &&
                    selected.anchor.offset === selected.focus.offset
                        ? blockText(focus).length
                        : selected.focus.offset;
                setSelection(
                    {
                        ...selected.anchor,
                        offset:
                            selected.anchor.blockId === focus.id && !selected.anchor.offset
                                ? offset
                                : selected.anchor.offset,
                    },
                    { ...selected.focus, offset },
                    selected.scopeId,
                    selected.cells,
                    wasFocused,
                );
            }
        }
        updateCaret();
        return result;
    }
}
function retryTranslations(kind: BilingualScope['kind']): void {
    try {
        getTranslationRunner()?.start(
            bilingualRowsInScope(session.document, bilingualScope(kind)).map((row) => row.id),
            true,
        );
    } catch {
        bilingualError.value = labels.value.invalidBilingual;
    }
}
const translationMessage = computed(() => {
    const value = translationStatus.value;
    return value.pending
        ? bilingualT('filling')
        : value.tooLong
          ? bilingualT('fill_too_long')
          : value.failed
            ? bilingualT('fill_failed')
            : '';
});

const bilingualHasSelection = computed(() => {
    const selection = nativeSelection();
    return (
        !!selection &&
        (!!selection.cells ||
            selection.anchor.blockId !== selection.focus.blockId ||
            selection.anchor.offset !== selection.focus.offset)
    );
});
function closeBilingual(): void {
    bilingualOpen.value = false;
    commands.endPending('bilingual');
    void nextTick(() => {
        if (!document.activeElement?.closest('[role=dialog], [role=menu]'))
            void toolbar.value?.focusBilingualControls?.();
    });
}
const bilingualPopupId = ref<string>();
const bilingualAnchor = computed(() => {
    void bilingualOpen.value;
    return editorRoot.value?.querySelector<HTMLElement>('[data-bilingual-trigger]') ?? undefined;
});
const bilingualSplit = computed(() => {
    void documentRevision.value;
    return bilingualRows(session.document).some((row) => !row.attributes?.show);
});
function openBilingual(): void {
    if (!insertion.value.bilingual) return;
    const row =
        bilingualContext(session.document, activeBlock.value ?? undefined) ?? bilingualRows(session.document)[0];
    bilingualInitial.value = {
        ...bilingualOptions(row),
        ...(!row && props.bilingualTranslator ? { fill: 'auto' as const } : {}),
    };
    bilingualError.value = '';
    bilingualOpen.value = true;
}
function bilingualCommandPreview(): { document: NativeDocument; selection: NativeSelection | null } {
    const context = commands.pending.value?.kind === 'bilingual' ? commands.pending.value.context : undefined;
    let document = session.document,
        selection = nativeSelection();
    if (context?.trigger) {
        try {
            runDocumentCommand(document, context.selection, context.target, context.trigger, (working, selected) => {
                document = working;
                selection = selected;
                return undefined;
            });
        } catch {
            return { document: session.document, selection: nativeSelection() };
        }
    }
    return { document, selection };
}
function bilingualScope(kind: BilingualScope['kind']): BilingualScope {
    const page = Math.max(scene.value?.coverPages ?? 0, caretPageIndex());
    return { kind, selection: bilingualCommandPreview().selection ?? undefined, scene: scene.value, page };
}
function bilingualDrop(options: BilingualOptions, kind: BilingualScope['kind']): readonly string[] {
    return droppedLanguages(bilingualCommandPreview().document, options, bilingualScope(kind));
}
async function applyBilingual(
    options: BilingualOptions,
    kind: BilingualScope['kind'],
    confirmed: readonly string[],
    operation: 'split' | 'settings' | 'settings-display' | 'end' | 'display',
): Promise<void> {
    if (
        props.readonly ||
        props.reviewPolicy ||
        disposed ||
        bilingualBusy.value ||
        !kernel.value ||
        !sceneCurrent.value ||
        mediaBusy.value
    )
        return;
    bilingualBusy.value = true;
    bilingualError.value = '';
    try {
        const base = session.document;
        const pending = commands.pending.value?.kind === 'bilingual' ? commands.pending.value.context : undefined;
        if (pending && !commands.valid(pending)) throw new Error('The insertion target changed');
        const scope = bilingualScope(kind);
        const preview = bilingualCommandPreview();
        const removed =
            operation === 'end' || operation === 'display' ? [] : droppedLanguages(preview.document, options, scope);
        if (removed.some((language) => !confirmed.some((item) => item.toLowerCase() === language.toLowerCase())))
            throw new Error('The removal warning changed');
        const action = (working: NativeDocument, selected = preview.selection) => {
            const scoped = { ...scope, selection: selected ?? undefined };
            return operation === 'end' || operation === 'display'
                ? endBilingual(working, scoped, options.show ?? 'all', operation === 'end')
                : operation === 'settings' || operation === 'settings-display'
                  ? setBilingualSettings(working, options, scoped, removed.length > 0, operation === 'settings-display')
                  : configureBilingual(working, options, scoped, removed.length > 0);
        };
        const result = pending?.trigger
            ? runDocumentCommand(base, pending.selection, pending.target, pending.trigger, action)
            : action(base);
        if (!result) {
            closeBilingual();
            return;
        }
        if (result.document === base) {
            bilingualOpen.value = false;
            await nextTick();
            await placeCaret(result.caret, scene.value!);
            return;
        }
        await kernel.value.prepare(result.document);
        if (disposed || props.readonly || props.reviewPolicy || session.document !== base)
            throw new Error('The document changed during bilingual setup');
        const prepared = layoutDocument(result.document, kernel.value);
        if (!(await commit(result.document))) return;
        scene.value = prepared;
        activeFieldId.value = undefined;
        activeImageId.value = undefined;
        emit('change', result.document);
        if (options.fill === 'auto' && operation !== 'end' && operation !== 'display')
            getTranslationRunner()?.start(result.rows ?? [], true);
        bilingualOpen.value = false;
        commands.endPending('bilingual');
        await nextTick();
        await placeCaret(result.caret, prepared);
    } catch {
        bilingualError.value = labels.value.invalidBilingual;
        await render();
    } finally {
        bilingualBusy.value = false;
    }
}
const pageLayout = computed(() => {
    void documentRevision.value;
    return documentPageLayout(session.document);
});
const presentation = computed(() => {
    void documentRevision.value;
    return documentPresentation(session.document);
});
provide<PageOrientationController>('pageOrientation', {
    current: computed(() => pageLayout.value.orientation),
    page: props.loadPdf
        ? undefined
        : {
              current: () =>
                  (activeFieldId.value
                      ? fieldPanelPage.value
                      : activeImageId.value
                        ? imagePage.value
                        : caretPageIndex()) + 1,
              orientation: (page) => pageLayoutForPage(session.document, page).orientation,
          },
    busy: pageSetupBusy,
    error: pageSetupError,
    disabled: computed(() => props.readonly || !sceneCurrent.value || mediaBusy.value),
    apply: (orientation, scope, page) =>
        applyPageSetup(
            { ...pageLayout.value, orientation },
            presentation.value,
            false,
            scope === 'page' ? page : undefined,
        ),
});
async function applyPageSetup(
    layout: PageLayout,
    presentation: NativePresentation,
    offerDefaults = false,
    targetPage?: number,
): Promise<boolean> {
    if (
        props.readonly ||
        props.reviewPolicy ||
        disposed ||
        pageSetupBusy.value ||
        !kernel.value ||
        !sceneCurrent.value ||
        mediaBusy.value
    )
        return false;
    if (
        targetPage !== undefined &&
        (!Number.isInteger(targetPage) || targetPage < 1 || targetPage > (scene.value?.pages.length ?? 0))
    ) {
        pageSetupError.value = labels.value.invalidPageSetup;
        return false;
    }
    pageSetupBusy.value = true;
    pageSetupError.value = '';
    try {
        const previous = session.document;
        const configure = (document: NativeDocument) =>
            targetPage === undefined
                ? setDocumentPresentation(setDocumentPageLayout(document, layout), presentation)
                : setPageLayout(document, targetPage, { orientation: layout.orientation });
        if (configure(previous) === previous) {
            pageSetupOpen.value = false;
            await nextTick();
            if (offerDefaults) emit('pageLayoutApplied', layout);
            return true;
        }
        const stamped = stampNativeImages(stampNativeFields(previous, scene.value!), scene.value!);
        const changed = configure(stamped);
        const next = Object.freeze({ ...changed, revision: previous.revision + 1 });
        await kernel.value.prepare(next);
        if (disposed || props.readonly || props.reviewPolicy || session.document !== previous)
            throw new Error('The document changed during page setup');
        const prepared = layoutDocument(next, kernel.value);
        if (!(await commit(next))) return false;
        scene.value = prepared;
        emit('change', next);
        pageSetupOpen.value = false;
        await nextTick();
        updateCaret();
        if (offerDefaults) emit('pageLayoutApplied', layout);
        return true;
    } catch {
        pageSetupError.value = labels.value.invalidPageSetup;
        await render();
        return false;
    } finally {
        pageSetupBusy.value = false;
    }
}
let inputSelection:
    | { before: string; from: number; to: number; direction?: HTMLTextAreaElement['selectionDirection'] }
    | undefined;
const storedMarks = shallowRef<readonly NativeMark[]>();
const formatState = shallowRef<SelectionStyle>(documentTextStyle(session.document));
const codeState = ref<boolean | undefined>(false);
const toolbar = ref<{
    focusPageControls: () => void;
    focusOutlineControls: () => void;
    focusBilingualControls: () => void;
    openLink: () => void | Promise<void>;
}>();
const toolbarBlock = computed<NativeNode | undefined>(() =>
    scene.value && activeBlock.value
        ? findNode(session.document, activeBlock.value)
        : vacantPosition()
          ? { id: '', kind: 'paragraph' }
          : undefined,
);
const selectedBlock = computed(() => {
    void documentRevision.value;
    const id = blockMenuId.value ?? activeBlock.value;
    return id ? blockContext(session.document, id) : undefined;
});
const toolbarList = computed(() => {
    if (documentRevision.value !== session.document.revision) return;
    return activeBlock.value
        ? (listContext(session.document, activeBlock.value)?.list.kind as ListKind | undefined)
        : undefined;
});
const toolbarTable = computed(() => {
    if (documentRevision.value !== session.document.revision) return false;
    return activeBlock.value ? !!tableContext(session.document, activeBlock.value) : false;
});
const selectedCells = computed(() => {
    if (documentRevision.value !== session.document.revision || !documentSelection.value?.cells) return;
    return tableRectangle(session.document, documentSelection.value.cells);
});
const activeTableId = computed(() => {
    if (documentRevision.value !== session.document.revision || !activeBlock.value) return;
    return tableContext(session.document, activeBlock.value)?.grid.table.id;
});
const controlledTableId = ref<string>();
const tableHandlesId = computed(() => controlledTableId.value ?? activeTableId.value);
const activeTableLocked = computed(() => {
    void documentRevision.value;
    return !!activeTableId.value && findNode(session.document, activeTableId.value)?.attributes?.locked === true;
});
const tableHandlesLocked = computed(() => {
    void documentRevision.value;
    return !!tableHandlesId.value && findNode(session.document, tableHandlesId.value)?.attributes?.locked === true;
});
const tableControlSelection = computed(() => {
    void documentRevision.value;
    void activeBlock.value;
    void documentSelection.value;
    void caret.value;
    return nativeSelection();
});
const canSplitCell = computed(() => {
    if (documentRevision.value !== session.document.revision || !activeBlock.value) return false;
    const cell = tableContext(session.document, activeBlock.value)?.cell;
    return !!cell && (cell.rowspan > 1 || cell.colspan > 1);
});
const tableRowHeights = computed(() => {
    const heights: Record<string, number> = {};
    for (const page of scene.value?.pages ?? [])
        for (const row of page.tableRows ?? []) heights[row.rowId] = (heights[row.rowId] ?? 0) + row.height;
    return heights;
});
const toolbarDirection = computed(() => {
    if (selectedField.value) return fieldSettings(selectedField.value.attributes).direction === 'ltr' ? 'ltr' : 'rtl';
    for (const page of scene.value?.pages ?? []) {
        const line = page.lines.find((line) => line.paragraphId === activeBlock.value);
        if (line) return line.shaped.direction;
    }
    return 'rtl';
});
const toolbarFieldAlign = computed(() => {
    if (!selectedField.value) return;
    const align = fieldSettings(selectedField.value.attributes).textAlign ?? 'center';
    return align === 'start'
        ? toolbarDirection.value === 'rtl'
            ? 'right'
            : 'left'
        : align === 'end'
          ? toolbarDirection.value === 'rtl'
              ? 'left'
              : 'right'
          : String(align);
});
let storedPosition: string | undefined;
let inputMarks: readonly NativeMark[] | undefined;
const applyingInput = ref(false);
const sharedApplying = ref(false);
let sharedPointer = false;
let sharedWasFocused = false;
function sharedPointerStart(): void {
    stopTyping();
    sharedPointer = true;
}
function sharedPointerEnd(): void {
    sharedPointer = false;
}
function unlockShared(): void {
    sharedApplying.value = false;
}
function lockShared(purpose?: 'history'): NativeSelection | null | false {
    if (
        !sceneCurrent.value ||
        applyingInput.value ||
        (queuedInputs.value > 0 && !(purpose === 'history' && queuedHistoryKey)) ||
        validatingEdits.value > 0 ||
        mediaBusy.value ||
        sharedPointer ||
        blockDrag.value ||
        sharedApplying.value ||
        !!menuAt.value ||
        editorRoot.value?.querySelector('dialog[open]')
    )
        return false;
    sharedApplying.value = true;
    sharedWasFocused = document.activeElement === input.value;
    return nativeSelection();
}
let disposed = false;
let selectionScroller: SelectionScroller | undefined;
interface EditorSelection {
    blockId: string;
    empty?: EmptyWritingPosition;
    from: number;
    to: number;
    marks?: readonly NativeMark[];
    range?: NativeSelection;
    affinity?: CaretAffinity;
    direction?: HTMLTextAreaElement['selectionDirection'];
}
const pastSelections: Array<EditorSelection | null> = [];
const futureSelections: Array<EditorSelection | null> = [];

function currentSelection(): EditorSelection | null {
    return activeBlock.value && input.value
        ? {
              blockId: activeBlock.value,
              affinity: selectionController.affinity,
              direction: input.value.selectionDirection,
              ...(documentSelection.value ? { range: documentSelection.value } : {}),
              from: input.value.selectionStart,
              to: input.value.selectionEnd,
              ...(storedMarks.value === undefined ? {} : { marks: storedMarks.value }),
          }
        : null;
}

function emptySelection(): EditorSelection | null {
    const position = vacantPosition();
    return position ? { blockId: '', from: 0, to: 0, empty: position, marks: storedMarks.value } : null;
}

function selectionKey(): string {
    return `${activeBlock.value}:${input.value?.selectionStart}:${input.value?.selectionEnd}`;
}

let formatSnapshot:
    | {
          document: NativeDocument;
          selection: NativeSelection | null;
          key: string;
          marks: readonly NativeMark[] | undefined;
      }
    | undefined;

function refreshFormatting(): void {
    if (selectedField.value) {
        formatState.value = fieldStyle(selectedField.value.attributes);
        codeState.value = false;
        formatSnapshot = undefined;
        return;
    }
    const selected = currentSelection();
    if (!selected) {
        if (vacantPosition()) {
            formatState.value = nodeTextStyle(
                { id: '', kind: 'text', marks: storedMarks.value },
                documentTextStyle(session.document),
            );
            codeState.value = storedMarks.value?.some((mark) => mark.kind === 'code') ?? false;
        }
        return;
    }
    if (!applyingInput.value && storedPosition !== selectionKey()) storedMarks.value = undefined;
    const key = selectionKey();
    if (
        formatSnapshot?.document === session.document &&
        formatSnapshot.selection === documentSelection.value &&
        formatSnapshot.key === key &&
        formatSnapshot.marks === storedMarks.value
    )
        return;
    formatSnapshot = { document: session.document, selection: documentSelection.value, key, marks: storedMarks.value };

    if (documentSelection.value) {
        const ranges = selectionRanges(session.document, documentSelection.value).filter(
            (range) => range.from !== range.to,
        );
        if (!ranges.length) return;
        const states = ranges.map((range) =>
            selectionTextStyle(session.document, { ...range, expectedRevision: session.document.revision }),
        );
        const first = states[0];
        formatState.value = Object.fromEntries(
            Object.entries(first).map(([key, value]) => [
                key,
                states.every((state) => JSON.stringify(state[key as keyof SelectionStyle]) === JSON.stringify(value))
                    ? value
                    : undefined,
            ]),
        ) as SelectionStyle;
        const codes = ranges.map((range) =>
            selectionCodeState(session.document, { ...range, expectedRevision: session.document.revision }),
        );
        codeState.value = codes.every((code) => code === codes[0]) ? codes[0] : undefined;
        return;
    }
    const range = { ...selected, expectedRevision: session.document.revision };
    formatState.value = selectionTextStyle(session.document, range, storedMarks.value);
    codeState.value = selectionCodeState(session.document, range, storedMarks.value);
}

async function prepareCandidateScene(document: NativeDocument) {
    return layoutController.prepare(document);
}

function rebaseInputView(before: NativeDocument, after: NativeDocument): void {
    if (!input.value || !activeBlock.value) return;
    const oldNode = findNode(before, activeBlock.value),
        newNode = findNode(after, activeBlock.value);
    if (!oldNode || !newNode) return;
    const oldText = blockText(oldNode),
        text = blockText(newNode);
    if (oldText === text || input.value.value !== oldText) return;
    const point = (blockId: string, offset: number) => {
        const source = findNode(before, blockId),
            target = findNode(after, blockId);
        if (!source || !target) return offset;
        const change = textDifference(blockText(source), blockText(target));
        return offset <= change.from
            ? offset
            : offset >= change.to
              ? offset + change.text.length - (change.to - change.from)
              : change.from + change.text.length;
    };
    const from = point(activeBlock.value, input.value.selectionStart),
        to = point(activeBlock.value, input.value.selectionEnd);
    const direction = input.value.selectionDirection;
    input.value.value = text;
    input.value.setSelectionRange(from, to, direction);
    if (documentSelection.value) {
        const selected = documentSelection.value;
        documentSelection.value = {
            ...selected,
            anchor: { ...selected.anchor, offset: point(selected.anchor.blockId, selected.anchor.offset) },
            focus: { ...selected.focus, offset: point(selected.focus.blockId, selected.focus.offset) },
        };
    }
    if (selectionController.anchor) {
        const anchor = selectionController.anchor;
        selectionController.anchor = { ...anchor, offset: point(anchor.blockId, anchor.offset) };
    }
}
const fieldAddedListeners = new Set<(field: { id: string }) => void>();
function onFieldAdded(callback: (field: { id: string }) => void): () => void {
    fieldAddedListeners.add(callback);
    return () => {
        fieldAddedListeners.delete(callback);
    };
}

async function commit(
    document: NativeDocument,
    typing?: object,
    previousSelection?: EditorSelection | null,
    inputContext?: Pick<InputSnapshot, 'intent' | 'objectId'>,
): Promise<boolean> {
    if (document === session.document) return true;
    validatingEdits.value++;
    try {
        validateProposal(document);
        return await applyDocumentEdit(
            document,
            () => session.document,
            prepareCandidateScene,
            (prepared) => {
                layoutController.remember(document, prepared);
                interactionError.value = '';
                const before = session.document;
                if (!typing) typingHistory.reset();
                const selected =
                    previousSelection === undefined ? (currentSelection() ?? emptySelection()) : previousSelection;
                const created = session.commit(document, typing);
                if (
                    inputContext &&
                    (inputContext.intent !== inputPointerIntent ||
                        previousSelection?.blockId !== activeBlock.value ||
                        inputContext.objectId !== (selectedField.value?.id ?? selectedImage.value?.id))
                )
                    rebaseInputView(before, document);
                if (created)
                    pastSelections.push(
                        selected && inputSelection
                            ? {
                                  ...selected,
                                  from: inputSelection.from,
                                  to: inputSelection.to,
                                  direction: inputSelection.direction,
                              }
                            : selected,
                    );
                futureSelections.length = 0;
                commands.live.update(before, document);
                commands.templateRevision.value++;
                trackSession();
                queueTranslations(before, document);
                if (fieldAddedListeners.size) {
                    const existing = new Set(nativeFields(before).map((field) => field.id));
                    const added = nativeFields(document).filter((field) => !existing.has(field.id));
                    if (added.length)
                        setTimeout(() => {
                            if (!disposed)
                                for (const field of added) for (const notify of fieldAddedListeners) notify(field);
                        }, 0);
                }
                return true;
            },
            (prepared) => prepared.release(),
        );
    } catch (failure) {
        if (reviewRefused(failure)) return false;
        if (kernel.value && !disposed) {
            await kernel.value.prepare(session.document);
            kernel.value.clearUnused(new Set());
        }
        interactionError.value = labels.value.editRejected;
        typingHistory.reset();
        session.stopCapturing();
        applyingInput.value = false;
        if (inputQueue.pending) {
            inputRecovery++;
            lastRejectedInputIntent = inputContext?.intent ?? inputPointerIntent;
        }
        if (inputContext && previousSelection) {
            const node = findNode(session.document, previousSelection.blockId);
            const length = node ? blockText(node).length : 0;
            inputSelections.set(
                inputContext.intent,
                node
                    ? (previousSelection.range ?? {
                          anchor: { blockId: node.id, offset: Math.min(length, previousSelection.from) },
                          focus: { blockId: node.id, offset: Math.min(length, previousSelection.to) },
                      })
                    : null,
            );
        }
        if (input.value && (inputContext === undefined || inputContext.intent === inputPointerIntent)) {
            const at = inputSelection?.from ?? input.value.selectionStart;
            const node = activeBlock.value && findNode(session.document, activeBlock.value);
            input.value.value = node ? blockText(node) : '';
            const offset = Math.min(at, input.value.value.length);
            input.value.setSelectionRange(offset, offset);
            queuedSelection = nativeSelection();
        }
        inputSelection = undefined;
        inputMarks = undefined;
        scheduleCaretUpdate();
        return false;
    } finally {
        validatingEdits.value--;
    }
}

function validateProposal(document: NativeDocument): void {
    props.reviewPolicy?.validate(document);
}
function reviewRefused(failure: unknown): boolean {
    if (!(failure instanceof NativeReviewViolation)) return false;
    interactionError.value = labels.value.reviewTextLocked;
    applyingInput.value = false;
    inputSelection = undefined;
    inputMarks = undefined;
    if (input.value && activeBlock.value) {
        const at = input.value.selectionStart;
        input.value.value = blockText(findNode(session.document, activeBlock.value)!);
        input.value.setSelectionRange(Math.min(at, input.value.value.length), Math.min(at, input.value.value.length));
    }
    return true;
}
let initialPage = 0;
function primeCaret(): void {
    if (props.readonly || !scene.value || !sceneCurrent.value || !input.value || activeBlock.value) return;
    if (emptyPosition.value && vacantPosition()) {
        refreshFormatting();
        scheduleCaretUpdate();
        return;
    }
    const target = initialTextCaret(session.document, scene.value, initialPage);
    if (!target) return;
    selectionController.affinity = 'downstream';
    selectionController.column = undefined;
    selectionController.region = undefined;
    activeBlock.value = target.blockId;
    selectionController.anchor = target;
    input.value.value = blockText(findNode(session.document, target.blockId)!);
    input.value.setSelectionRange(target.offset, target.offset);
    refreshFormatting();
    scheduleCaretUpdate();
}
function inputFocus(): void {
    inputFocused.value = true;
    primeCaret();
    scheduleCaretUpdate();
}
watch(
    () => props.readonly,
    (readonly) => {
        if (!readonly) primeCaret();
    },
);
function trackSession(): void {
    documentRevision.value = session.document.revision;
    canUndo.value = props.sharedHistory?.canUndo ?? session.canUndo;
    canRedo.value = props.sharedHistory?.canRedo ?? session.canRedo;
}
watch(() => props.sharedHistory, trackSession);
const budgetPassed = computed(() => readyMs.value !== null && readyMs.value <= NATIVE_READY_LIMIT_MS);
const readiness = new ViewportReadiness({
    revision: () => scene.value?.revision,
    canCommit: () => !error.value && !paintFailures.size,
    committed: (page) => {
        initialPage = page;
        primeCaret();
        readyMs.value = performance.now() - started;
        emit('ready', report());
    },
});
const ready = readiness.ready;


function report(): EditorReport {
    return {
        engine: 'midad',
        documentReadyMs: readyMs.value,
        readinessLimitMs: NATIVE_READY_LIMIT_MS,
        performancePassed: budgetPassed.value,
        pages: scene.value?.pages.length ?? 0,
        glyphs: scene.value?.glyphCount ?? 0,
        revision: session.document.revision,
        layoutMs: shapeMs.value,
        mountedCanvases: editorRoot.value?.querySelectorAll('.native-page canvas').length ?? 0,
    };
}

function hydratedScene(
    document: NativeDocument,
    renderer: NativeTextKernel,
): { document: NativeDocument; scene: DocumentScene } {
    return layoutController.hydrate(document, renderer);
}

async function render(): Promise<void> {
    if (!kernel.value) return;
    const snapshot = session.document;
    await kernel.value.prepare(snapshot);
    if (disposed || snapshot !== session.document) return;
    const start = performance.now();
    const prepared = layoutController.cached(snapshot, kernel.value) ?? hydratedScene(snapshot, kernel.value);
    scene.value = prepared.scene;
    if (prepared.document.root !== snapshot.root && !props.reviewPolicy) {
        session.document = prepared.document;
        if (readyMs.value !== null && !props.readonly) emit('change', prepared.document);
    }
    shapeMs.value = performance.now() - start;
    if (!paintFailures.size) error.value = '';
    await nextTick();
    if (readyMs.value !== null) primeCaret();
}

const printBusy = ref(false),
    printError = ref('');
let printer: PdfPrintController | undefined, printShortcut: PrintShortcut | undefined;
async function requestPrint(): Promise<void> {
    printError.value = '';
    if (!printer) {
        printError.value = labels.value.printFailed;
        return;
    }
    await printer.print().catch(() => {});
}

onMounted(async () => {
    editingOverlay = new EditingOverlayView(editingOverlayHost.value!, editingOverlayFrame.value, {
        focus: inputFocus,
        blur: () => {
            inputFocused.value = false;
            stopTyping();
        },
        input: change,
        beforeInput,
        key,
        copy,
        paste,
        select: inputSelected,
        handleStart: startHandle,
        handleMove: dragHandle,
        handleEnd: endHandle,
    });
    input.value = editingOverlay.input;
    if (!props.embedded) {
        printer = new PdfPrintController(editorRoot.value!, {
            before: preparePdf,
            bytes: pdfBytes,
            identity: () => session.document,
            ready: () => !!kernel.value && !!scene.value && readyMs.value !== null && !error.value,
            busy: (busy) => {
                printBusy.value = busy;
            },
            error: () => {
                printError.value = labels.value.printFailed;
            },
        });
        printShortcut = new PrintShortcut(editorRoot.value!, () => {
            void requestPrint();
        });
    }
    window.addEventListener('pointerup', sharedPointerEnd);
    window.addEventListener('pointercancel', sharedPointerEnd);
    window.addEventListener('blur', sharedPointerEnd);
    viewObserver = new ResizeObserver(measureView);
    viewObserver.observe(editorRoot.value!);
    if (pagesElement.value) viewObserver.observe(pagesElement.value);
    window.addEventListener('scroll', updateOutlinePosition, { passive: true, capture: true });
    window.addEventListener('resize', measureView);
    selectionScroller = new SelectionScroller(editorRoot.value!);
    window.addEventListener('pointerup', stopSelectionScroll);
    window.addEventListener('pointercancel', stopSelectionScroll);
    window.addEventListener('blur', stopSelectionScroll);
    window.addEventListener('pointerdown', outsideMenu);
    window.addEventListener('scroll', scheduleCaretUpdate, true);
    window.addEventListener('resize', scheduleCaretUpdate);
    try {
        if (props.loadPdf) {
            const bytes = await props.loadPdf(pdfController.signal);
            const digest = Array.from(
                new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
                (value) => value.toString(16).padStart(2, '0'),
            ).join('');
            if (session.document.root.attributes?.nativePdfSource !== digest)
                throw new Error('The imported PDF source changed. Reload the document.');
            pdfFingerprint.value = digest;
            const source = await (
                props.integration?.openPdf ??
                (() => {
                    throw new Error('Configure a PDF source loader for this integration');
                })
            )(bytes, pdfController.signal);
            if (disposed) {
                await source.destroy();
                return;
            }
            pdfSource.value = source;
        }
        const borrowed = props.sharedKernel;
        if (borrowed) releaseKernel = borrowed.retain();
        const created = borrowed ?? (await NativeTextKernel.create(props.resolveMedia));
        if (disposed) {
            if (borrowed) releaseKernel?.();
            else created.destroy();
            return;
        }
        kernel.value = created;
        await render();
    } catch (failure) {
        if (disposed) return;
        error.value = String(failure);
        emit('error', failure);
        readiness.fail(failure);
    }
});

function pageFailed(index: number, failure: unknown): void {
    paintFailures.set(index, failure);
    paintErrorMessage = String(failure);
    error.value = paintErrorMessage;
    caret.value = null;
    selection.value = [];
    touchHandles.value = [];
    emit('error', failure);
    if (readyMs.value === null) readiness.fail(failure);
}
async function retryPaint(): Promise<void> {
    try {
        for (const index of pdfFailures.value) pdfRetries.set(index, (pdfRetries.get(index) ?? 0) + 1);
        await render();
        await nextTick();
        if (!error.value && document.activeElement === document.body) input.value?.focus({ preventScroll: true });
    } catch (failure) {
        error.value = String(failure);
        emit('error', failure);
    }
}
function painted(index: number): void {
    if (pdfFailures.value.has(index)) return;
    if (paintFailures.delete(index) && !paintFailures.size && error.value === paintErrorMessage) error.value = '';
}

function setSelection(
    anchor: TextCaret,
    focus: TextCaret,
    scopeId?: string,
    cells?: TableCellSelection,
    focusEditor = true,
): void {
    if (!input.value) return;
    queuedSelection = { anchor, focus, ...(scopeId ? { scopeId } : {}), ...(cells ? { cells } : {}) };
    if (inputQueue.pending) inputSelections.set(inputPointerIntent, queuedSelection);
    blockMenuId.value = undefined;
    activeFieldId.value = undefined;
    activeImageId.value = undefined;
    if (!cells && !scopeId && anchor.blockId === focus.blockId && Math.abs(anchor.offset - focus.offset) === 1)
        activeFieldId.value = allFields.value.find(
            (field) => field.blockId === focus.blockId && field.offset === Math.min(anchor.offset, focus.offset),
        )?.id;
    if (!cells && !scopeId && anchor.blockId === focus.blockId && Math.abs(anchor.offset - focus.offset) === 1)
        activeImageId.value = allImages.value.find(
            (image) => image.blockId === focus.blockId && image.offset === Math.min(anchor.offset, focus.offset),
        )?.id;
    const current = documentSelection.value;
    const same =
        current &&
        current.anchor.blockId === anchor.blockId &&
        current.anchor.offset === anchor.offset &&
        current.focus.blockId === focus.blockId &&
        current.focus.offset === focus.offset &&
        current.scopeId === scopeId &&
        JSON.stringify(current.cells) === JSON.stringify(cells);
    if (same) {
        scheduleCaretUpdate();
        return;
    }
    documentSelection.value =
        anchor.blockId === focus.blockId && !scopeId && !cells
            ? null
            : { anchor, focus, ...(scopeId ? { scopeId } : {}), ...(cells ? { cells } : {}) };
    selectingCells.value = !!cells;
    activeBlock.value = focus.blockId;
    input.value.value = blockText(findNode(session.document, focus.blockId)!);
    if (focusEditor) input.value.focus({ preventScroll: true });
    const from = anchor.blockId === focus.blockId ? Math.min(anchor.offset, focus.offset) : focus.offset;
    const to = anchor.blockId === focus.blockId ? Math.max(anchor.offset, focus.offset) : focus.offset;
    input.value.setSelectionRange(from, to, focus.offset < anchor.offset ? 'backward' : 'forward');
    commands.templateChanged(nativeSelection());
    scheduleCaretUpdate();
}

async function selectPoint(
    index: number,
    x: number,
    y: number,
    extend = false,
    clicks = 1,
    shift = false,
    clientX?: number,
    clientY?: number,
    pointerType = 'mouse',
    held = false,
): Promise<void> {
    if (!scene.value || !kernel.value || !input.value || !sceneCurrent.value) return;
    inputPointerIntent++;
    activeFieldId.value = undefined;
    if (!extend) {
        stopSelectionScroll();
        menuAt.value = null;
    }
    if (extend && clientX !== undefined && clientY !== undefined) {
        selectionScroller?.update(
            clientX,
            clientY,
            () => void selectPoint(index, x, y, true, clicks, shift, clientX, clientY, pointerType),
        );
        const pages = [...(editorRoot.value?.querySelectorAll<HTMLElement>('.native-page') ?? [])];
        let distance = Infinity;
        pages.forEach((page, candidate) => {
            const box = page.getBoundingClientRect();
            const next = Math.max(box.top - clientY, 0, clientY - box.bottom);
            if (next < distance) {
                distance = next;
                index = candidate;
                x = (clientX - box.left) / viewScale.value;
                y = (clientY - box.top) / viewScale.value;
            }
        });
    }
    touchSelection.value = pointerType === 'touch';
    const result = selectionController.point(
        session.document,
        scene.value,
        {
            page: index,
            x,
            y,
            extend,
            clicks,
            shift,
            pointerType,
            held,
        },
        {
            selection: nativeSelection(),
            selectingCells: selectingCells.value,
            allowEmpty: !props.reviewPolicy,
            navigation: navigation(),
            upstreamAffinity: kernel.value.ck.Affinity.Upstream,
        },
    );
    selectingCells.value = result.selectingCells;
    if (result.kind === 'none') return;
    if (result.kind === 'empty') {
        emptyPosition.value = result.position;
        activeBlock.value = null;
        activeImageId.value = undefined;
        documentSelection.value = null;
        input.value.value = '';
        input.value.setSelectionRange(0, 0);
        input.value.focus({ preventScroll: true });
        refreshFormatting();
        updateCaret();
        return;
    }
    if (result.kind === 'text') {
        emptyPosition.value = undefined;
        if (!extend && !shift && result.clicks === 1) {
            const picked = props.reviewHighlights?.find((item) =>
                selectionRanges(session.document, item.selection).some(
                    (range) =>
                        range.blockId === result.hit.blockId &&
                        result.hit.blockOffset >= range.from &&
                        result.hit.blockOffset <= range.to,
                ),
            );
            if (picked) emit('reviewPick', picked.id);
        }
        storedMarks.value = undefined;
        storedPosition = undefined;
    }
    const range = result.selection;
    setSelection(range.anchor, range.focus, range.scopeId, range.cells);
}

function inputSelected(): void {
    commands.templateChanged(nativeSelection());
    if (!documentSelection.value && input.value && activeBlock.value) {
        selectionController.anchor = {
            blockId: activeBlock.value,
            offset:
                input.value.selectionDirection === 'backward' ? input.value.selectionEnd : input.value.selectionStart,
        };
    }
    scheduleCaretUpdate();
}

let caretFrame: number | undefined;
function scheduleCaretUpdate(event?: Event): void {
    if (event?.type === 'scroll' && event.target === input.value) return;
    if (caretFrame === undefined)
        caretFrame = requestAnimationFrame(() => {
            caretFrame = undefined;
            updateCaret();
        });
}

const peerBoxes = shallowRef<
    Array<{
        id: string;
        name: string;
        color: string;
        caret: { left: number; top: number; height: number } | null;
        rectangles: Array<{ left: number; top: number; width: number; height: number }>;
    }>
>([]);
watch(
    () => props.peers,
    () => scheduleCaretUpdate(),
);
function rangeRectangles(
    selected: NativeSelection,
    visibleOnly = true,
): Array<{ left: number; top: number; width: number; height: number }> {
    if (!scene.value || !sceneCurrent.value || !kernel.value) return [];
    const origins = new Map<number, DOMRect>();
    scene.value.pages.forEach((_page, index) => {
        const element = pagesElement.value?.querySelector<HTMLElement>(`[data-page="${index + 1}"]`);
        if (!element) return;
        const bounds = element.getBoundingClientRect();
        if (!visibleOnly || (bounds.bottom >= 0 && bounds.top <= innerHeight)) origins.set(index, bounds);
    });
    return selectionViewportRectangles(session.document, scene.value, selected, {
        canvasKit: kernel.value.ck,
        scale: viewScale.value,
        pages: new Set(origins.keys()),
        pageOrigin: (index) => origins.get(index),
    });
}
const reviewBoxes = shallowRef<
    Array<{ id: string; kind: string; active: boolean; rectangles: ReturnType<typeof rangeRectangles> }>
>([]);
watch(
    () => props.reviewHighlights,
    () => scheduleCaretUpdate(),
);
function updateReview(): void {
    reviewBoxes.value = (props.reviewHighlights ?? []).flatMap((item) => {
        try {
            return [
                { id: item.id, kind: item.kind, active: !!item.active, rectangles: rangeRectangles(item.selection) },
            ];
        } catch {
            return [];
        }
    });
}
const find = reactive(
    useNativeFind({
        root: editorRoot,
        pages: pagesElement,
        document: computed(() => {
            void documentRevision.value;
            return session.document;
        }),
        scene,
        ready: computed(
            () =>
                sceneCurrent.value &&
                !queuedInputs.value &&
                !validatingEdits.value &&
                !applyingInput.value &&
                !sharedApplying.value &&
                !clipboardBusy.value &&
                !mediaBusy.value &&
                !fieldEditsPending.value,
        ),
        available: () => !!chrome.value.NativeFindPanel && readyMs.value !== null && !!scene.value && !!kernel.value && !error.value && !mediaBusy.value,
        scale: viewScale,
        canvasKit: () => kernel.value?.ck,
        selectedText: () => {
            if (document.activeElement !== input.value) return '';
            const selected = nativeSelection();
            return selected ? selectedText(session.document, selected) : '';
        },
        select: (selected) => {
            setSelection(selected.anchor, selected.focus, undefined, undefined, false);
            revealSelection(selected);
        },
        focus: () => input.value?.focus({ preventScroll: true }),
    }),
);
watch([() => find.opened, () => find.top], () => {
    void nextTick(() => {
        if (disposed) return;
        measureView();
        scheduleCaretUpdate();
    });
});
function updatePeers(): void {
    if (!props.peers?.length) {
        if (peerBoxes.value.length) peerBoxes.value = [];
        return;
    }
    if (!scene.value || !sceneCurrent.value || !kernel.value) return;
    peerBoxes.value = props.peers.map((peer) => {
        const rectangles: Array<{ left: number; top: number; width: number; height: number }> = [];
        let caret: ReturnType<typeof caretRectangle> = null;
        try {
            if (peer.selection) {
                caret = caretRectangle(peer.selection.focus);
                rectangles.push(...rangeRectangles(peer.selection));
            }
        } catch {
            caret = null;
        }
        return { id: peer.id, name: peer.name, color: peer.color, caret, rectangles };
    });
}
function updateCaret(): void {
    commands.refresh();
    updatePeers();
    updateReview();
    if (disposed || !scene.value || !input.value || !kernel.value) return;
    if (!activeBlock.value) {
        const position = vacantPosition();
        const element =
            position && editorRoot.value?.querySelector<HTMLElement>(`[data-page="${position.pageIndex + 1}"]`);
        const bounds = element?.getBoundingClientRect();
        caret.value =
            position && bounds
                ? {
                      left: bounds.left + position.x * viewScale.value,
                      top: bounds.top + position.y * viewScale.value,
                      height: position.height * viewScale.value,
                  }
                : null;
        selection.value = [];
        touchHandles.value = [];
        return;
    }
    refreshFormatting();
    const origins = new Map<number, DOMRect>();
    const visiblePages = new Set<number>();
    scene.value.pages.forEach((_page, index) => {
        const element = editorRoot.value?.querySelector<HTMLElement>(`[data-page="${index + 1}"]`);
        if (!element) return;
        const bounds = element.getBoundingClientRect();
        origins.set(index, bounds);
        if (bounds.bottom >= 0 && bounds.top <= innerHeight) visiblePages.add(index);
    });
    const start = input.value.selectionStart,
        end = input.value.selectionEnd;
    const selected = documentSelection.value ?? {
        anchor: { blockId: activeBlock.value, offset: input.value.selectionDirection === 'backward' ? end : start },
        focus: { blockId: activeBlock.value, offset: input.value.selectionDirection === 'backward' ? start : end },
    };
    const geometry = selectionOverlayGeometry(navigation(), selected, {
        canvasKit: kernel.value.ck,
        scale: viewScale.value,
        pages: visiblePages,
        pageOrigin: (index) => origins.get(index),
        affinity: selectionController.affinity,
        touch: touchSelection.value,
        hideCaret: !!documentSelection.value || start !== end,
    });
    selection.value = geometry.rectangles;
    caret.value = geometry.caret;
    touchHandles.value = geometry.handles;
}

function navigation(): NativeNavigation | undefined {
    if (disposed || !scene.value || !kernel.value || !sceneCurrent.value) return;
    if (navigationState?.scene !== scene.value || navigationState.document !== session.document)
        navigationState = new NativeNavigation(session.document, scene.value, kernel.value.ck);
    return navigationState;
}

function caretRectangle(
    target: TextCaret,
    affinity: CaretAffinity = 'downstream',
): { left: number; top: number; height: number } | null {
    return caretViewportRect(
        navigation(),
        target,
        (pageIndex) =>
            editorRoot.value?.querySelector<HTMLElement>(`[data-page="${pageIndex + 1}"]`)?.getBoundingClientRect(),
        viewScale.value,
        affinity,
    );
}

function startHandle(event: PointerEvent, endpoint: 'start' | 'end'): void {
    if (!input.value || !activeBlock.value) return;
    const range = documentSelection.value ?? {
        anchor: { blockId: activeBlock.value, offset: input.value.selectionStart },
        focus: { blockId: activeBlock.value, offset: input.value.selectionEnd },
    };
    if (selectionController.startHandle(session.document, range, endpoint, event, caretRectangle))
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function dragHandle(event: PointerEvent): void {
    if (!selectionController.handleActive(event.pointerId) || !scene.value || !sceneCurrent.value) return;
    selectionScroller?.update(event.clientX, event.clientY, () => dragHandle(event));
    const pages = [...(editorRoot.value?.querySelectorAll<HTMLElement>('.native-page') ?? [])].map((page) =>
        page.getBoundingClientRect(),
    );
    const range = selectionController.dragHandle(scene.value, event, pages, viewScale.value);
    if (!range) return;
    touchSelection.value = true;
    setSelection(range.anchor, range.focus);
}

function endHandle(): void {
    selectionController.endHandle();
    stopSelectionScroll();
}

function stopSelectionScroll(): void {
    selectionScroller?.stop();
}

let inputPointerIntent = 0;
let lastQueuedInputIntent = 0;
let lastRejectedInputIntent = -1;
let inputSequence = 0;
let inputRecovery = 0;
let queuedKeys = 0;
let rebasedInputs = 0;
let queuedSelection: NativeSelection | null = null;
interface InputSnapshot {
    kind: 'input';
    intent: number;
    objectId?: string;
    blockId: string | null;
    target?: EmptyWritingPosition['target'];
    before: string;
    range: NativeSelection | null;
    history: EditorSelection | null;
    floating: boolean;
    sequence: number;
    recovery: number;
    rebase: boolean;
    difference: ReturnType<typeof textDifference>;
    event: Event;
    value: string;
    from: number;
    to: number;
    direction: 'forward' | 'backward' | 'none';
    selection: typeof inputSelection;
    marks: typeof inputMarks;
}
interface QueuedKey {
    kind: 'key';
    intent: number;
    event: KeyboardEvent;
    selection: NativeSelection | null;
}
const inputSelections = new Map<number, NativeSelection | null>();
let queuedKeyIntent: number | undefined;
let queuedHistoryKey = false;
const createdInputTargets = new Map<string, string>();
let replacedInputRanges = new WeakMap<NativeSelection, TextCaret>();
const inputQueue = new InputQueue<InputSnapshot | QueuedKey>(async (action) => {
    if (disposed || !input.value) return;
    if (action.kind === 'key') {
        createdInputTargets.clear();
        replacedInputRanges = new WeakMap();
        if (action.intent !== inputPointerIntent) {
            interactionError.value = labels.value.editRejected;
            return;
        }
        queuedKeyIntent = action.intent;
        queuedHistoryKey =
            (action.event.ctrlKey || action.event.metaKey) &&
            !action.event.altKey &&
            ['z', 'y'].includes(action.event.key.toLowerCase());
        try {
            const selected = action.selection ?? inputSelections.get(action.intent);
            if (selected && !selectedField.value && !selectedImage.value)
                setSelection(selected.anchor, selected.focus, selected.scopeId, selected.cells, inputFocused.value);
            const sequence = inputSequence;
            await keyNow(action.event);
            if (sequence === inputSequence && action.intent === inputPointerIntent)
                inputSelections.set(action.intent, nativeSelection());
        } finally {
            queuedKeyIntent = undefined;
            queuedHistoryKey = false;
        }
        return;
    }
    let snapshot = action;
    const rebase =
        snapshot.rebase || (snapshot.recovery !== inputRecovery && snapshot.intent === lastRejectedInputIntent);
    if (rebase && !snapshot.rebase) rebasedInputs++;
    try {
        if (rebase) {
            const selected =
                inputSelections.get(snapshot.intent) ??
                (snapshot.intent === inputPointerIntent ? nativeSelection() : null);
            const node = selected && findNode(session.document, selected.focus.blockId);
            if (selected && node) {
                const before = blockText(node);
                const collapsed =
                    selected.anchor.blockId === selected.focus.blockId &&
                    selected.anchor.offset === selected.focus.offset;
                let from = Math.min(before.length, selected.focus.offset),
                    to = from;
                if (!collapsed && selected.anchor.blockId === selected.focus.blockId) {
                    from = Math.min(selected.anchor.offset, selected.focus.offset);
                    to = Math.max(selected.anchor.offset, selected.focus.offset);
                } else if (!snapshot.difference.text) {
                    const length = snapshot.difference.to - snapshot.difference.from;
                    if ((snapshot.event as InputEvent).inputType?.endsWith('Backward'))
                        from = Math.max(0, from - length);
                    else to = Math.min(before.length, to + length);
                }
                const value = before.slice(0, from) + snapshot.difference.text + before.slice(to);
                const offset = from + snapshot.difference.text.length;
                snapshot = {
                    ...snapshot,
                    value,
                    from: offset,
                    to: offset,
                    blockId: selected.focus.blockId,
                    before,
                    range:
                        selected.scopeId || selected.cells || selected.anchor.blockId !== selected.focus.blockId
                            ? selected
                            : null,
                    history: { blockId: selected.focus.blockId, from, to, marks: storedMarks.value, direction: 'none' },
                    difference: { from, to, text: snapshot.difference.text },
                    selection: { before, from, to, direction: 'none' },
                    marks: storedMarks.value,
                };
                if (activeBlock.value === selected.focus.blockId && inputFocused.value) {
                    input.value.value = value;
                    input.value.setSelectionRange(offset, offset);
                }
            } else if (snapshot.target) {
                const value = snapshot.difference.text;
                snapshot = {
                    ...snapshot,
                    value,
                    from: value.length,
                    to: value.length,
                    before: '',
                    difference: { from: 0, to: 0, text: value },
                    selection: { before: '', from: 0, to: 0, direction: 'none' },
                    marks: storedMarks.value,
                };
                input.value.value = value;
                input.value.setSelectionRange(value.length, value.length);
            }
        }
        inputSelection = snapshot.selection;
        inputMarks = snapshot.marks;
        applyingInput.value = true;
        await changeNow(snapshot.event, snapshot);
    } finally {
        if (rebase && !action.rebase) rebasedInputs--;
    }
});
function change(event: Event): Promise<void> | undefined {
    if (props.readonly || (event as InputEvent).isComposing || !input.value) return;
    const value = input.value.value;
    const before =
        inputSelection?.before ??
        blockText(
            (activeBlock.value && findNode(session.document, activeBlock.value)) || { id: '', kind: 'paragraph' },
        );
    const rebase = lastQueuedInputIntent === inputPointerIntent && (queuedKeys > 0 || rebasedInputs > 0);
    lastQueuedInputIntent = inputPointerIntent;
    if (rebase) rebasedInputs++;
    queuedInputs.value++;
    pendingTextInputs.value++;
    return inputQueue
        .push({
            kind: 'input',
            intent: inputPointerIntent,
            objectId: selectedField.value?.id ?? selectedImage.value?.id,
            blockId: activeBlock.value,
            target: activeBlock.value ? undefined : vacantPosition()?.target,
            before,
            range: documentSelection.value,
            history: currentSelection() ?? emptySelection(),
            floating: !!selectedField.value?.floating || !!selectedImage.value?.floating,
            sequence: ++inputSequence,
            recovery: inputRecovery,
            rebase,
            difference: textDifference(before, value, inputSelection),
            event,
            value,
            from: input.value.selectionStart,
            to: input.value.selectionEnd,
            direction: input.value.selectionDirection,
            selection: inputSelection,
            marks: inputMarks,
        })
        .finally(() => {
            queuedInputs.value--;
            pendingTextInputs.value--;
            if (rebase) rebasedInputs--;
            if (!queuedInputs.value) {
                createdInputTargets.clear();
                replacedInputRanges = new WeakMap();
                inputSelections.clear();
            }
        });
}
async function changeNow(event: Event, snapshot: InputSnapshot): Promise<void> {
    if (props.readonly || (event as InputEvent).isComposing || !input.value) return;
    const targetKey = snapshot.target && JSON.stringify(snapshot.target);
    const replaced = snapshot.range && replacedInputRanges.get(snapshot.range);
    const blockId = replaced?.blockId ?? snapshot.blockId ?? (targetKey ? createdInputTargets.get(targetKey) : null);
    let releasedObject = false;
    const ownsInput = () =>
        inputFocused.value &&
        snapshot.intent === inputPointerIntent &&
        ((selectedField.value?.id ?? selectedImage.value?.id) === snapshot.objectId ||
            (releasedObject && !selectedField.value && !selectedImage.value)) &&
        (blockId
            ? activeBlock.value === blockId
            : !activeBlock.value && targetKey === JSON.stringify(vacantPosition()?.target));
    if (!blockId) {
        try {
            const text = snapshot.value;
            const result =
                snapshot.target &&
                writeAtPosition(session.document, null, snapshot.target, (document, selected) => ({
                    document: replaceInlineText(document, {
                        blockId: selected.focus.blockId,
                        from: 0,
                        to: 0,
                        text,
                        marks: inputMarks,
                        expectedRevision: document.revision,
                    }),
                    caret: { blockId: selected.focus.blockId, offset: text.length },
                }));
            if (result) {
                const typing = typingHistory.group({
                    revision: session.document.revision,
                    blockId: result.caret.blockId,
                    from: 0,
                    to: 0,
                    text,
                    inputType: (event as InputEvent).inputType,
                    collapsed: true,
                    style: JSON.stringify(inputMarks),
                });
                if (!(await commit(result.document, typing, snapshot.history, snapshot))) return;
                if (targetKey) createdInputTargets.set(targetKey, result.caret.blockId);
                queuedSelection = { anchor: result.caret, focus: result.caret };
                inputSelections.set(snapshot.intent, queuedSelection);
                emit('change', session.document);
                if (ownsInput()) {
                    if (snapshot.sequence === inputSequence) await placeCaret(result.caret);
                    else activeBlock.value = result.caret.blockId;
                } else await render();
            }
        } catch (failure) {
            if (!reviewRefused(failure)) {
                interactionError.value = labels.value.editRejected;
            }
        } finally {
            applyingInput.value = false;
            inputSelection = undefined;
            inputMarks = undefined;
        }
        return;
    }
    if (snapshot.floating) {
        if (ownsInput()) input.value.value = blockText(findNode(session.document, blockId)!);
        applyingInput.value = false;
        inputSelection = undefined;
        return;
    }
    if (ownsInput()) {
        activeFieldId.value = undefined;
        releasedObject = true;
    }
    if (snapshot.range && !replaced) {
        try {
            applyingInput.value = false;
            await replaceDocumentSelection(snapshot.difference.text, snapshot.range, ownsInput());
        } catch (failure) {
            if (!reviewRefused(failure)) interactionError.value = labels.value.editRejected;
        }
        return;
    }
    const node = findNode(session.document, blockId);
    if (!node) {
        applyingInput.value = false;
        interactionError.value = labels.value.editRejected;
        return;
    }
    try {
        const current = blockText(node);
        let difference = snapshot.difference;
        if (snapshot.before !== current) {
            const previous = textDifference(snapshot.before, current);
            const offset = (value: number) =>
                value <= previous.from
                    ? value
                    : value >= previous.to
                      ? value + previous.text.length - (previous.to - previous.from)
                      : previous.from + previous.text.length;
            difference = { ...difference, from: offset(difference.from), to: offset(difference.to) };
        }
        const history = snapshot.history && {
            ...snapshot.history,
            blockId: node.id,
            empty: undefined,
            from: difference.from,
            to: difference.to,
            ...(replaced ? { range: undefined } : {}),
        };
        const typing = typingHistory.group({
            revision: session.document.revision,
            blockId: node.id,
            ...difference,
            inputType: (event as InputEvent).inputType,
            collapsed: !!inputSelection && inputSelection.from === inputSelection.to,
            style: JSON.stringify(inputMarks),
        });
        const candidate = replaceInlineText(session.document, {
            blockId: node.id,
            ...difference,
            expectedRevision: session.document.revision,
            marks: inputMarks,
        });
        if (!(await commit(candidate, typing, history, snapshot))) return;
        inputSelection = undefined;
        inputMarks = undefined;
        applyingInput.value = false;
        const accepted = { blockId: node.id, offset: difference.from + difference.text.length };
        queuedSelection = { anchor: accepted, focus: accepted };
        inputSelections.set(snapshot.intent, queuedSelection);
        if (snapshot.sequence === inputSequence && ownsInput()) {
            input.value.value = blockText(findNode(session.document, node.id)!);
            input.value.setSelectionRange(accepted.offset, accepted.offset);
        }
        if (storedMarks.value !== undefined && ownsInput()) storedPosition = selectionKey();
        emit('change', session.document);
        await render();
        updateCaret();
        if (snapshot.sequence === inputSequence && ownsInput()) revealCaret(accepted);
    } catch (failure) {
        if (!reviewRefused(failure)) interactionError.value = labels.value.editRejected;
    } finally {
        applyingInput.value = false;
        inputSelection = undefined;
        inputMarks = undefined;
    }
}

async function history(direction: 'undo' | 'redo', localOnly = false): Promise<void> {
    typingHistory.reset();
    if (!localOnly && props.sharedHistory) {
        await props.sharedHistory[direction]();
        return;
    }
    const previous = currentSelection() ?? emptySelection();
    const before = session.document;
    if (props.readonly) return;
    try {
        if (
            !session[direction]((candidate) => {
                validateProposal(candidate);
                if (!kernel.value) throw new Error('The renderer is unavailable');
                layoutDocument(candidate, kernel.value);
            })
        )
            return;
    } catch (failure) {
        if (reviewRefused(failure)) return;
        throw failure;
    }
    commands.live.update(before, session.document);
    commands.templateRevision.value++;
    trackSession();
    const target = (direction === 'undo' ? pastSelections : futureSelections).pop();
    (direction === 'undo' ? futureSelections : pastSelections).push(previous);
    if (target && !target.empty) activeBlock.value = target.blockId;
    else {
        clearTextInput();
        emptyPosition.value = target?.empty;
    }
    selectionController.affinity = target?.affinity ?? 'downstream';
    documentSelection.value = target?.range ?? null;
    selectingCells.value = !!target?.range?.cells;
    storedMarks.value = target?.marks;
    inputSelection = undefined;
    selection.value = [];
    caret.value = null;
    emit('change', session.document);
    if (input.value)
        input.value.value = activeBlock.value
            ? blockText(findNode(session.document, activeBlock.value) ?? { id: '', kind: 'paragraph' })
            : '';
    if (target && input.value) {
        input.value.setSelectionRange(target.from, target.to, target.direction);
        input.value.focus({ preventScroll: true });
    }
    storedPosition = selectionKey();
    queuedSelection = nativeSelection();
    if (inputQueue.pending) inputSelections.set(queuedKeyIntent ?? inputPointerIntent, queuedSelection);
    await render();
    updateCaret();
    if (target && !target.empty)
        revealCaret(
            target.range?.focus ?? {
                blockId: target.blockId,
                offset: target.direction === 'backward' ? target.from : target.to,
            },
        );
}

async function placeCaret(next: TextCaret, prepared?: DocumentScene): Promise<void> {
    queuedSelection = { anchor: next, focus: next };
    if (inputQueue.pending) inputSelections.set(queuedKeyIntent ?? inputPointerIntent, queuedSelection);
    selectionController.affinity = 'downstream';
    documentSelection.value = null;
    selectingCells.value = false;
    selectionController.anchor = next;
    activeBlock.value = next.blockId;
    if (!input.value) return;
    input.value.value = blockText(findNode(session.document, next.blockId)!);
    input.value.setSelectionRange(next.offset, next.offset);
    input.value.focus({ preventScroll: true });
    if (storedMarks.value !== undefined) storedPosition = selectionKey();
    if (prepared) {
        scene.value = prepared;
        await nextTick();
    } else await render();
    updateCaret();
    revealCaret(next);
}

function beforeInput(event: InputEvent | CompositionEvent): void {
    if (event.type === 'compositionstart' || ('isComposing' in event && event.isComposing)) commands.hide();
    if (sharedApplying.value) {
        event.preventDefault();
        return;
    }
    if (selectedField.value?.floating || selectedImage.value?.floating) {
        event.preventDefault();
        if (!props.readonly && 'inputType' in event && event.inputType.startsWith('delete'))
            void (selectedImage.value ? deleteImage() : deleteField());
        return;
    }
    if (
        !props.readonly &&
        documentSelection.value &&
        'inputType' in event &&
        !event.isComposing &&
        event.inputType.startsWith('delete')
    ) {
        event.preventDefault();
        void replaceDocumentSelection('');
        return;
    }

    if (props.readonly || ('isComposing' in event && event.isComposing) || !input.value) return;
    if (
        'inputType' in event &&
        event.inputType.startsWith('delete') &&
        input.value.selectionStart === input.value.selectionEnd &&
        ((event.inputType.endsWith('Backward') && input.value.selectionStart === 0) ||
            (event.inputType.endsWith('Forward') && input.value.selectionEnd === input.value.value.length) ||
            !input.value.value)
    ) {
        event.preventDefault();
        return;
    }
    refreshFormatting();
    inputSelection = {
        before: input.value.value,
        from: input.value.selectionStart,
        to: input.value.selectionEnd,
        direction: input.value.selectionDirection,
    };
    inputMarks = storedMarks.value;
    applyingInput.value = true;
    selectionController.affinity = 'downstream';
}

async function applyFormat(command: FormatCommand, focusEditor = true): Promise<void> {
    if (selectedImage.value) return;
    if (props.readonly || applyingInput.value || !input.value) return;
    refreshFormatting();
    if (selectedField.value) {
        const settings = fieldSettings(selectedField.value.attributes);
        let patch: Record<string, Json>;
        if (command.kind === 'style') patch = { ...command.attributes };
        else if (command.kind === 'toggle') {
            if (command.mark === 'code') return;
            const style = fieldStyle(selectedField.value.attributes);
            const enabled = command.enabled ?? !style[command.mark];
            patch =
                command.mark === 'bold'
                    ? { fontWeight: enabled ? 'bold' : 'normal' }
                    : command.mark === 'italic'
                      ? { fontStyle: enabled ? 'italic' : 'normal' }
                      : command.mark === 'underline'
                        ? { textDecoration: enabled ? 'underline' : 'none' }
                        : { strike: enabled };
        } else if (command.kind === 'clear')
            patch = {
                fontFamily: 'Arial',
                fontSize: '14px',
                color: '#000000',
                fontWeight: 'normal',
                fontStyle: 'normal',
                textDecoration: 'none',
                backgroundColor: null,
                strike: false,
                lineHeight: null,
            };
        else return;
        const attrs = selectedField.value.attributes;
        await saveField({
            type: attrs.type as FieldDraft['type'],
            name: String(attrs.name),
            settings: { ...settings, ...patch },
        });
        return;
    }
    const selected = currentSelection();
    if (!selected && vacantPosition()) {
        if (command.kind === 'link' && command.href) {
            const text = normalizeLink(command.href);
            const marks = changeTextMarks(storedMarks.value ?? [], command);
            const result = writeAtPosition(session.document, null, vacantPosition()!.target, (document, range) => ({
                document: replaceInlineText(document, {
                    blockId: range.focus.blockId,
                    from: 0,
                    to: 0,
                    text,
                    marks,
                    expectedRevision: document.revision,
                }),
                caret: { blockId: range.focus.blockId, offset: text.length },
            }));
            if (result) {
                if (!(await commit(result.document))) return;
                storedMarks.value = changeTextMarks(marks, { kind: 'link', href: null });
                emit('change', session.document);
                await placeCaret(result.caret);
            }
            return;
        }
        storedMarks.value = changeTextMarks(storedMarks.value ?? [], command);
        storedPosition = selectionKey();
        refreshFormatting();
        if (focusEditor) input.value.focus({ preventScroll: true });
        updateCaret();
        return;
    }
    if (!selected) return;
    if (documentSelection.value) {
        let next = session.document;
        const resolved =
            command.kind === 'toggle' && command.enabled === undefined
                ? {
                      ...command,
                      enabled:
                          command.mark === 'code' ? codeState.value !== true : formatState.value[command.mark] !== true,
                  }
                : command;
        for (const range of selectionRanges(next, documentSelection.value))
            next = formatText(next, { ...range, expectedRevision: next.revision }, resolved);
        if (next !== session.document) {
            if (!(await commit(Object.freeze({ ...next, revision: session.document.revision + 1 })))) return;
            emit('change', session.document);
            await render();
        }
        if (focusEditor) input.value.focus({ preventScroll: true });
        updateCaret();
        return;
    }

    try {
        const block = findNode(session.document, selected.blockId)!;
        let range = { ...selected, expectedRevision: session.document.revision };
        if (selected.from === selected.to && command.kind === 'link') {
            const linked = linkedRangeAtCaret(block, selected.from);
            if (linked) range = { ...range, ...linked };
            else if (command.href) {
                const text = normalizeLink(command.href);
                const marks = changeTextMarks(storedMarks.value ?? marksAtCaret(block, selected.from), command);
                if (!(await commit(replaceInlineText(session.document, { ...range, text, marks })))) return;
                storedMarks.value = changeTextMarks(marks, { kind: 'link', href: null });
                emit('change', session.document);
                await placeCaret({ blockId: block.id, offset: selected.from + text.length });
                input.value.focus({ preventScroll: true });
                return;
            }
        }
        if (range.from === range.to) {
            const state = selectionTextStyle(session.document, range, storedMarks.value);
            const resolved =
                command.kind === 'toggle' && command.enabled === undefined
                    ? {
                          ...command,
                          enabled:
                              command.mark === 'code'
                                  ? selectionCodeState(session.document, range, storedMarks.value) !== true
                                  : state[command.mark] !== true,
                      }
                    : command;
            storedMarks.value = changeTextMarks(storedMarks.value ?? marksAtCaret(block, range.from), resolved);
            storedPosition = selectionKey();
            error.value = '';
        } else {
            const next = formatText(session.document, range, command);
            if (next !== session.document) {
                if (!(await commit(next))) return;
                emit('change', session.document);
                await render();
            }
        }
        input.value.setSelectionRange(selected.from, selected.to);
        if (focusEditor) input.value.focus({ preventScroll: true });
        updateCaret();
    } catch (failure) {
        error.value = String(failure);
        emit('error', failure);
    }
}

async function applyBlockFormat(patch: BlockFormat): Promise<void> {
    if (props.readonly || applyingInput.value) return;
    if (selectedField.value && (patch.textAlign || patch.dir)) {
        const attrs = selectedField.value.attributes;
        await saveField({
            type: attrs.type as FieldDraft['type'],
            name: String(attrs.name),
            settings: {
                ...fieldSettings(attrs),
                ...(patch.textAlign ? { textAlign: patch.textAlign } : {}),
                ...(patch.dir ? { direction: patch.dir } : {}),
            },
        });
        return;
    }
    if (!activeBlock.value) {
        const position = vacantPosition();
        const result =
            position &&
            writeAtPosition(session.document, null, position.target, (document, selected) => ({
                document: formatBlock(document, selected.focus.blockId, patch),
                caret: selected.focus,
            }));
        if (result) await finishStructure(result);
        return;
    }
    if (documentSelection.value) {
        let next = session.document;
        for (const range of selectionRanges(next, documentSelection.value))
            next = formatBlock(next, range.blockId, patch);
        if (next !== session.document) {
            if (!(await commit(Object.freeze({ ...next, revision: session.document.revision + 1 })))) return;
            emit('change', session.document);
            await render();
        }
        input.value?.focus({ preventScroll: true });
        updateCaret();
        return;
    }

    try {
        const next = formatBlock(session.document, activeBlock.value, patch);
        if (next === session.document) {
            input.value?.focus({ preventScroll: true });
            return;
        }
        if (!(await commit(next))) return;
        if (patch.kind) {
            storedMarks.value = undefined;
            storedPosition = undefined;
        }
        emit('change', session.document);
        await render();
        input.value?.focus({ preventScroll: true });
        updateCaret();
    } catch (failure) {
        error.value = String(failure);
        emit('error', failure);
    }
}

async function replaceDocumentSelection(
    text: string,
    selected = documentSelection.value,
    focusEditor = true,
): Promise<void> {
    if (props.readonly || !selected) return;
    if (props.reviewPolicy && selectionRanges(session.document, selected).length > 1) {
        reviewRefused(new NativeReviewViolation());
        return;
    }
    const result = replaceSelection(session.document, selected, text);
    if (!(await commit(result.document))) return;
    if (inputQueue.pending) replacedInputRanges.set(selected, result.caret);
    if (focusEditor) storedMarks.value = undefined;
    inputSelection = undefined;
    emit('change', session.document);
    if (focusEditor) await placeCaret(result.caret);
    else await render();
}

function nativeSelection(): NativeSelection | null {
    if (documentSelection.value) return documentSelection.value;
    const selected = currentSelection();
    return selected
        ? {
              anchor: {
                  blockId: selected.blockId,
                  offset: selected.direction === 'backward' ? selected.to : selected.from,
              },
              focus: {
                  blockId: selected.blockId,
                  offset: selected.direction === 'backward' ? selected.from : selected.to,
              },
          }
        : null;
}

function copy(event: ClipboardEvent): void {
    if (selectedField.value?.floating) {
        event.preventDefault();
        void copyField(selectedField.value.id, event.type === 'cut');
        return;
    }
    floatingFieldClipboard = undefined;
    const range = nativeSelection();
    if (!range || !event.clipboardData || !selectedText(session.document, range)) return;
    event.preventDefault();
    try {
        const payload = clipboardPayload(session.document, range);
        event.clipboardData.setData(NATIVE_CLIPBOARD_TYPE, payload.native);
        event.clipboardData.setData('text/html', payload.html);
        event.clipboardData.setData('text/plain', payload.text);
        if (event.type === 'cut' && !props.readonly) void applyFragment({ blocks: [] }, range, true);
    } catch {
        interactionError.value = labels.value.clipboardError;
    }
}

async function applyFragment(fragment: NativeFragment, range = nativeSelection(), remove = false): Promise<void> {
    if (props.readonly || !kernel.value || (!range && (!vacantPosition() || remove || props.reviewPolicy))) return;
    const base = session.document;
    if (props.reviewPolicy && range) {
        if (selectionRanges(base, range).length !== 1) {
            reviewRefused(new NativeReviewViolation());
            return;
        }
        const text = fragment.blocks.map(blockText).join(' ').replace(/\s+/g, ' ').trim();
        const result = replaceSelection(base, range, remove ? '' : text);
        try {
            if (!(await commit(result.document))) return;
            storedMarks.value = undefined;
            inputSelection = undefined;
            applyingInput.value = false;
            emit('change', session.document);
            await placeCaret(result.caret);
        } catch (failure) {
            if (!reviewRefused(failure)) throw failure;
        }
        return;
    }
    try {
        if (props.textOnly) {
            const allowed = (node: NativeNode): boolean =>
                !['clause', 'parallelRow', 'table', 'image', 'variable', 'pdfPage'].includes(node.kind) &&
                (node.children?.every(allowed) ?? true);
            if (!fragment.blocks.every(allowed)) throw new Error('This content requires a document editor');
        }
        const result = writeAtPosition(base, range, vacantPosition()?.target, (document, selected) =>
            remove ? replaceSelection(document, selected, '') : pasteFragment(document, selected, fragment),
        );
        if (!result) return;
        clipboardBusy.value = true;
        await kernel.value.prepare(result.document);
        if (disposed || props.readonly || session.document !== base) {
            if (!disposed) await render();
            return;
        }
        const started = performance.now();
        const prepared = layoutDocument(result.document, kernel.value);
        shapeMs.value = performance.now() - started;
        if (!(await commit(result.document))) return;
        storedMarks.value = undefined;
        inputSelection = undefined;
        applyingInput.value = false;
        menuAt.value = null;
        interactionError.value = '';
        emit('change', session.document);
        await placeCaret(result.caret, prepared);
    } catch {
        if (disposed) return;
        interactionError.value = labels.value.pasteError;
        await render();
    } finally {
        clipboardBusy.value = false;
    }
}

function paste(event: ClipboardEvent): void {
    if (!props.readonly && floatingFieldClipboard && !plainPaste) {
        event.preventDefault();
        void pasteFloatingField();
        return;
    }
    if (props.readonly || !event.clipboardData || (!nativeSelection() && !vacantPosition())) return;
    event.preventDefault();
    const file = [...event.clipboardData.files].find((file) => file.type.startsWith('image/'));
    if (
        !props.reviewPolicy &&
        file &&
        !event.clipboardData.getData('text/plain') &&
        !event.clipboardData.getData('text/html')
    ) {
        plainPaste = false;
        void insertPickedImage(file);
        return;
    }
    try {
        if (
            event.clipboardData.files.length &&
            !event.clipboardData.getData('text/html') &&
            !event.clipboardData.getData('text/plain')
        )
            throw new Error('Image uploads are required');
        const fragment = props.reviewPolicy
            ? plainTextFragment(event.clipboardData.getData('text/plain'))
            : readClipboard((type) => event.clipboardData!.getData(type), plainPaste);
        plainPaste = false;
        void applyFragment(fragment);
    } catch {
        plainPaste = false;
        interactionError.value = labels.value.pasteError;
    }
}

function selectAll(): void {
    const range = selectionController.selectAll(session.document, nativeSelection());
    if (!range) return;
    if (!range.cells) {
        selectionController.anchor = range.anchor;
    }
    setSelection(range.anchor, range.focus, range.scopeId, range.cells);
}

function outsideMenu(event: PointerEvent): void {
    if (!(event.target as HTMLElement).closest('.native-selection-menu, [data-command-menu]')) {
        menuAt.value = null;
        blockMenuId.value = undefined;
        gutterMenuId.value = undefined;
        menuContext.value = undefined;
    }
}
function measureMenu(height: number): void {
    menuHeight.value = height;
    if (menuAt.value) menuAt.value.top = Math.max(8, Math.min(menuAt.value.top, innerHeight - height - 8));
}

function closeMenu(restore = true): void {
    const blockId = blockMenuId.value;
    gutterMenuId.value = undefined;
    menuAt.value = null;
    menuContext.value = undefined;
    blockMenuId.value = undefined;
    touchSelection.value = false;
    touchHandles.value = [];
    const opener = blockId
        ? pagesElement.value?.querySelector<HTMLElement>(`.native-block-handle[data-block-id="${CSS.escape(blockId)}"]`)
        : undefined;
    if (restore) (opener ?? input.value)?.focus({ preventScroll: true });
}

async function contextMenu(event: MouseEvent): Promise<void> {
    const page = (event.target as HTMLElement).closest<HTMLElement>('.native-page');
    if (!page || !scene.value) return;
    event.preventDefault();
    blockMenuId.value = undefined;
    menuMode.value = 'context';
    const index = Number(page.dataset.page) - 1,
        bounds = page.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / viewScale.value,
        y = (event.clientY - bounds.top) / viewScale.value;
    const fieldId = (event.target as HTMLElement).closest<HTMLElement>('[data-field-id]')?.dataset.fieldId;
    if (fieldId) selectField(fieldId);
    else {
        const hit = hitTest(scene.value, index, x, y);
        if (!hit) {
            await selectPoint(index, x, y);
            if (!vacantPosition()) return;
        }
        const range = nativeSelection();
        if (
            hit &&
            (!range ||
                !selectionRanges(session.document, range).some(
                    (range) =>
                        range.blockId === hit.blockId && hit.blockOffset >= range.from && hit.blockOffset <= range.to,
                ))
        )
            await selectPoint(index, x, y);
    }
    menuContext.value = commands.context();
    menuAt.value = {
        left: Math.max(8, Math.min(innerWidth - 320, event.clientX)),
        top: Math.max(8, Math.min(innerHeight - 128, event.clientY)),
    };
    await nextTick();
    focusContextMenu();
}

async function commandLinkAction(action: 'open' | 'copy' | 'remove'): Promise<void> {
    const href = formatState.value.href;
    if (!href) return;
    closeMenu();
    if (action === 'remove') await applyFormat({ kind: 'link', href: null });
    else if (action === 'open') {
        if (/^(https?:|mailto:|tel:)/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
    } else
        try {
            await navigator.clipboard.writeText(href);
        } catch {
            interactionError.value = labels.value.clipboardError;
        }
}
function contextMenuItem(item: NativeCommandMenuItem): void {
    if (!menuAt.value || !menuContext.value) return;
    void runMenuItem(item, menuContext.value);
}
async function clipboardAction(action: ClipboardAction): Promise<void> {
    if (selectedField.value?.floating && (action === 'copy' || action === 'cut')) {
        await copyField(selectedField.value.id, action === 'cut');
        closeMenu();
        return;
    }
    if (action === 'paste' && floatingFieldClipboard) {
        await pasteFloatingField();
        return;
    }
    if (action === 'selectAll') {
        selectAll();
        return;
    }
    const range = nativeSelection(),
        base = session.document;
    if (
        (!range && !((action === 'paste' || action === 'pastePlain') && vacantPosition())) ||
        (props.readonly && action !== 'copy')
    )
        return;
    const identityOf = () => JSON.stringify({ selection: nativeSelection(), target: vacantPosition()?.target });
    const identity = identityOf();
    clipboardBusy.value = true;
    interactionError.value = '';
    try {
        if (action === 'copy' || action === 'cut') {
            floatingFieldClipboard = undefined;
            const payload = clipboardPayload(base, range!);
            if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
                const formats: Record<string, Blob> = {
                    'text/plain': new Blob([payload.text], { type: 'text/plain' }),
                    'text/html': new Blob([payload.html], { type: 'text/html' }),
                };
                if (ClipboardItem.supports?.(NATIVE_WEB_CLIPBOARD_TYPE))
                    formats[NATIVE_WEB_CLIPBOARD_TYPE] = new Blob([payload.native], { type: NATIVE_CLIPBOARD_TYPE });
                await navigator.clipboard.write([new ClipboardItem(formats)]);
            } else await navigator.clipboard.writeText(payload.text);
            if (action === 'cut' && session.document === base && identityOf() === identity)
                await applyFragment({ blocks: [] }, range, true);
        } else {
            const formats = new Map<string, string>();
            if (navigator.clipboard.read) {
                const item = (await navigator.clipboard.read())[0];
                const imageType =
                    action === 'paste' &&
                    !props.textOnly &&
                    !props.reviewPolicy &&
                    item &&
                    !item.types.some((type) => type === 'text/html' || type === 'text/plain')
                        ? item.types.find((type) => type.startsWith('image/'))
                        : undefined;
                if (item && imageType) {
                    const blob = await item.getType(imageType);
                    if (session.document === base && identityOf() === identity)
                        await insertPickedImage(new File([blob], 'pasted-image', { type: imageType }));
                    return;
                }
                if (item)
                    for (const type of [NATIVE_WEB_CLIPBOARD_TYPE, 'text/html', 'text/plain'])
                        if (item.types.includes(type)) formats.set(type, await (await item.getType(type)).text());
            } else formats.set('text/plain', await navigator.clipboard.readText());
            if (session.document === base && identityOf() === identity)
                await applyFragment(
                    props.reviewPolicy
                        ? plainTextFragment(formats.get('text/plain') ?? '')
                        : readClipboard((type) => formats.get(type) ?? '', action === 'pastePlain'),
                    range,
                );
        }
    } catch {
        interactionError.value = labels.value.clipboardError;
    } finally {
        clipboardBusy.value = false;
    }
}

async function finishStructure(
    result: StructureResult,
    selected?: NativeSelection,
    options: { reveal?: boolean } = {},
): Promise<void> {
    if (result.document !== session.document) {
        if (!(await commit(result.document))) return;
        storedMarks.value = undefined;
        emit('change', session.document);
    }
    if (selected) {
        await render();
        setSelection(selected.anchor, selected.focus, selected.scopeId, selected.cells);
        updateCaret();
        if (options.reveal !== false) revealCaret(selected.focus);
    } else await placeCaret(result.caret);
}

async function blockAction(action: BlockAction): Promise<void> {
    const target = selectedBlock.value;
    if (props.readonly || !target || !kernel.value || !sceneCurrent.value || applyingInput.value || mediaBusy.value)
        return;
    const selected = nativeSelection();
    const result =
        action === 'delete'
            ? deleteBlock(session.document, target.node.id)
            : action === 'unwrap'
              ? removeNativeClause(session.document, target.node.id, true)
              : { document: moveBlockStep(session.document, target.node.id, action), caret: selected?.focus };
    if (result)
        await applyBlockChange({ ...result, focusBlock: target.node.id }, action === 'delete' ? null : selected);
}

async function applyBlockChange(
    result: { document: NativeDocument; caret?: TextCaret; focusBlock?: string },
    selected: NativeSelection | null,
): Promise<void> {
    if (props.readonly || !kernel.value || !sceneCurrent.value || applyingInput.value || mediaBusy.value) return;
    const base = session.document;
    menuAt.value = null;
    blockMenuId.value = undefined;
    mediaBusy.value = true;
    interactionError.value = '';
    try {
        if (result.document === base) return;
        await kernel.value.prepare(result.document);
        const prepared = layoutDocument(result.document, kernel.value);
        if (session.document !== base) throw new Error('The document changed before the block action');
        if (!(await commit(result.document))) return;
        scene.value = prepared;
        activeImageId.value = undefined;
        activeFieldId.value = undefined;
        emit('change', result.document);
        await nextTick();
        if (selected) {
            setSelection(selected.anchor, selected.focus, selected.scopeId, selected.cells);
            updateCaret();
            revealCaret(selected.focus);
        } else if (result.caret) await placeCaret(result.caret, prepared);
    } catch {
        interactionError.value = labels.value.invalidBlock;
        await render();
    } finally {
        mediaBusy.value = false;
    }
    if (!selected && !result.caret && result.focusBlock) {
        await nextTick();
        pagesElement.value
            ?.querySelector<HTMLButtonElement>(`.native-block-handle[data-block-id="${CSS.escape(result.focusBlock)}"]`)
            ?.focus({ preventScroll: true });
    }
}

async function openAddMenu(id: string, x: number, y: number, index: number, column?: string): Promise<void> {
    if (props.readonly || props.reviewPolicy || !scene.value || !sceneCurrent.value || mediaBusy.value) return;
    const node = findNode(session.document, column ?? id);
    if (!node) return;
    const blocks = textBlocks(node);
    const block = column ? blocks.at(-1) : blocks[0];
    if (block) {
        const caret = { blockId: block.id, offset: column ? blockText(block).length : 0 };
        setSelection(caret, caret);
    } else {
        const slot = column
            ? scene.value.pages[index].columns?.find((item) => item.id === column)
            : scene.value.pages[index].cells?.find((item) => item.tableId === id);
        if (slot) await selectPoint(index, slot.x + slot.width / 2, slot.y + slot.height / 2);
        else {
            const next = (session.document.root.children ?? [])
                .slice((session.document.root.children ?? []).findIndex((item) => item.id === id) + 1)
                .flatMap(textBlocks)[0];
            if (next) setSelection({ blockId: next.id, offset: 0 }, { blockId: next.id, offset: 0 });
            else {
                clearTextInput();
                emptyPosition.value = emptyWritingPosition(session.document, scene.value, index, undefined, {
                    containerId: session.document.root.id,
                    afterId: id,
                });
            }
        }
    }
    refreshFormatting();
    commands.dismiss();
    menuMode.value = 'add';
    gutterMenuId.value = id;
    blockMenuId.value = undefined;
    menuContext.value = commands.context();
    menuAt.value = { left: x, top: y };
    await nextTick();
    focusContextMenu();
}
async function openBlockMenu(id: string, x: number, y: number): Promise<void> {
    const node = blockContext(session.document, id)?.node;
    if (props.readonly || !node || !sceneCurrent.value || mediaBusy.value) return;
    const current = nativeSelection();
    if (!current || blockContext(session.document, current.focus.blockId)?.node !== node) {
        const first = textBlocks(node)[0];
        if (first) await placeCaret({ blockId: first.id, offset: 0 });
        else {
            clearTextInput();
            documentSelection.value = null;
            selection.value = [];
            caret.value = null;
        }
    }
    activeFieldId.value = undefined;
    activeImageId.value = undefined;
    menuMode.value = 'block';
    menuContext.value = commands.context();
    blockMenuId.value = id;
    menuAt.value = {
        left: Math.max(8, Math.min(innerWidth - 320, x)),
        top: Math.max(8, Math.min(innerHeight - menuHeight.value - 8, y)),
    };
    await nextTick();
    focusContextMenu();
}

function blockDropAt(id: string, x: number, y: number): NonNullable<typeof blockDrag.value> {
    const elements = [...(pagesElement.value?.querySelectorAll<HTMLElement>('.native-page') ?? [])];
    const nearest = elements
        .map((element, index) => ({ index, bounds: element.getBoundingClientRect() }))
        .filter(({ bounds }) => x >= bounds.left - 44 && x <= bounds.right + 44)
        .sort(
            (a, b) =>
                Math.max(a.bounds.top - y, 0, y - a.bounds.bottom) - Math.max(b.bounds.top - y, 0, y - b.bounds.bottom),
        )[0];
    if (!nearest || Math.max(nearest.bounds.top - y, 0, y - nearest.bounds.bottom) > 28) return { id };
    const localY = (y - nearest.bounds.top) / viewScale.value;
    const target = [...(scene.value?.pages[nearest.index].blocks ?? [])].sort(
        (a, b) => Math.abs(a.y + a.height / 2 - localY) - Math.abs(b.y + b.height / 2 - localY),
    )[0];
    if (!target || target.id === id || !blockContext(session.document, target.id)) return { id };
    const side = localY < target.y + target.height / 2 ? 'before' : 'after';
    return {
        id,
        target: target.id,
        side,
        left: nearest.bounds.left + target.x * viewScale.value,
        top: nearest.bounds.top + (target.y + (side === 'after' ? target.height : 0)) * viewScale.value,
        width: target.width * viewScale.value,
    };
}

function dragBlock(id: string, x: number, y: number): void {
    if (props.readonly || !sceneCurrent.value || mediaBusy.value || !blockContext(session.document, id)) return;
    menuAt.value = null;
    touchSelection.value = false;
    touchHandles.value = [];
    blockDrag.value = blockDropAt(id, x, y);
    selectionScroller?.update(x, y, () => dragBlock(id, x, y));
}

function cancelBlockDrag(): void {
    if (blockDrag.value) stopSelectionScroll();
    blockDrag.value = undefined;
}

async function dropBlock(id: string, x: number, y: number): Promise<void> {
    const drop = blockDropAt(id, x, y);
    cancelBlockDrag();
    if (!drop.target || !drop.side || props.readonly) return;
    const selected = nativeSelection();
    const preserve =
        selected && blockContext(session.document, selected.focus.blockId)?.node.id === id ? selected : null;
    const first = textBlocks(blockContext(session.document, id)!.node)[0];
    await applyBlockChange(
        {
            document: moveBlock(session.document, id, drop.target, drop.side),
            focusBlock: id,
            caret: first ? { blockId: first.id, offset: 0 } : undefined,
        },
        preserve,
    );
}

async function applyList(kind: ListKind): Promise<void> {
    const selected = nativeSelection();
    if (props.readonly || applyingInput.value || !sceneCurrent.value || (!selected && !vacantPosition())) return;
    const result = writeAtPosition(session.document, selected, vacantPosition()?.target, (document, range) => ({
        document: toggleList(document, range, kind),
        caret: range.focus,
    }));
    if (result) await finishStructure(result, selected ?? undefined);
}

function selectField(id: string, focusEditor = true): void {
    const field = allFields.value.find((field) => field.id === id);
    if (!field) return;
    if (field.blockId)
        setSelection(
            { blockId: field.blockId, offset: field.offset! },
            { blockId: field.blockId, offset: field.offset! + 1 },
            undefined,
            undefined,
            focusEditor,
        );
    else {
        const focus = nativeSelection()?.focus;
        const selected = selectNodeText(session.document.root);
        if (focus) setSelection(focus, focus, undefined, undefined, focusEditor);
        else if (selected) setSelection(selected.anchor, selected.anchor, undefined, undefined, focusEditor);
    }
    activeFieldId.value = id;
    refreshFormatting();
    if (focusEditor) input.value?.focus({ preventScroll: true });
}

function openField(id?: string): void {
    if (
        props.readonly ||
        props.textOnly ||
        (!id && !insertion.value.fields) ||
        (props.reviewPolicy && !props.reviewPolicy.fields)
    )
        return;
    activeImageId.value = undefined;
    if (id) selectField(id);
    else activeFieldId.value = undefined;
    if (props.externalFieldDetails) {
        if (id) emit('fieldDetails', id);
        else emit('fieldPalette');
        return;
    }
    fieldPanelError.value = '';
    fieldPanelOpen.value = true;
}

async function copyField(id: string, cut = false): Promise<void> {
    const field = nativeFields(session.document).find((field) => field.id === id);
    if (!field || (cut && props.readonly)) return;
    if (!field.floating) {
        selectField(id);
        await clipboardAction(cut ? 'cut' : 'copy');
        return;
    }
    for (const [page, entry] of scene.value?.pages.entries() ?? []) {
        const box = entry.commands.find((command) => command.kind === 'field' && command.nodeId === id);
        if (box?.kind !== 'field') continue;
        floatingFieldClipboard = {
            attributes: JSON.parse(JSON.stringify(field.attributes)),
            placement: { page, x: box.x, y: box.y, width: box.width, height: box.height },
        };
        if (cut) {
            selectField(id);
            await deleteField();
        }
        return;
    }
}

async function pasteFloatingField(): Promise<void> {
    if (!floatingFieldClipboard || !canInsertFields() || props.reviewPolicy || !kernel.value || !scene.value) return;
    const { attributes, placement } = floatingFieldClipboard;
    const page = scene.value.pages[placement.page];
    if (!page) return;
    try {
        const target = {
            ...placement,
            x: Math.max(0, Math.min(placement.x + 9, page.width - placement.width)),
            y: Math.max(0, Math.min(placement.y + 9, page.height - placement.height)),
        };
        const draft: FieldDraft = {
            type: attributes.type as FieldDraft['type'],
            name: String(attributes.name),
            description: String(attributes.description ?? ''),
            value: String(attributes.value ?? ''),
            participant_id: String(attributes.participant_id ?? ''),
            settings: fieldSettings(attributes),
        };
        const result = insertFloatingNativeField(session.document, draft, scene.value, target, attributes);
        const prepared = layoutDocument(result.document, kernel.value);
        if (!(await commit(result.document))) return;
        scene.value = prepared;
        activeFieldId.value = result.fieldId;
        floatingFieldClipboard = { attributes, placement: target };
        emit('change', session.document);
        await nextTick();
        refreshFormatting();
        updateCaret();
        input.value?.focus({ preventScroll: true });
    } catch {
        interactionError.value = labels.value.pasteError;
    }
}

async function applyFieldDetails(id: string, patch: FieldPatch): Promise<void> {
    const started = performance.now();
    while (!disposed) {
        if (performance.now() - started >= 5000) throw new Error('The field edit timed out');
        if (props.readonly || props.textOnly || props.reviewPolicy) throw new Error('Field editing is unavailable');
        if (applyingInput.value || sharedApplying.value || mediaBusy.value) {
            await new Promise((resolve) => setTimeout(resolve, 16));
            continue;
        }
        const renderer = kernel.value;
        if (!renderer) throw new Error('The editor is not ready');
        const base = session.document;
        const previous = nativeFields(base).find((field) => field.id === id);
        if (!previous) return;
        let next = updateNativeField(base, id, patch);
        await renderer.prepare(next);
        if (disposed) return;
        if (session.document !== base || sharedApplying.value || applyingInput.value || mediaBusy.value) continue;
        if (props.readonly) throw new Error('Field editing is unavailable');
        const field = nativeFields(next).find((field) => field.id === id)!;
        const style = fieldStyle(field.attributes);
        const settings = fieldSettings(field.attributes);
        if (!['signature', 'stamp', 'initials'].includes(String(field.attributes.type)) && !settings.multiline) {
            const measured = renderer.shapeRich(
                [{ nodeId: '', text: fieldDisplayValue(field.attributes) || 'Mgأب', style, editable: false }],
                100000,
                settings.direction === 'ltr' ? 'ltr' : 'rtl',
            );
            const height = Math.max(
                Number(field.attributes.height),
                Math.ceil((measured.lines[0].bottom - measured.lines[0].top) / 0.75),
            );
            if (height > Number(field.attributes.height))
                next = Object.freeze({ ...updateNativeField(next, id, { height }), revision: base.revision + 1 });
        }
        const prepared = layoutDocument(next, renderer);
        if (!(await commit(next))) return;
        scene.value = prepared;
        emit('change', session.document);
        refreshFormatting();
        await nextTick();
        updateCaret();
        return;
    }
}

async function flushFieldDetails(): Promise<boolean> {
    try {
        await fieldEdits.flush();
        fieldEditError.value = '';
        return true;
    } catch {
        fieldEditError.value = labels.value.invalidField;
        return false;
    }
}

function updateFieldDetails(data: VariableData): void {
    if (props.readonly || props.textOnly || props.reviewPolicy) return;
    const previous = variablesForUi().find((field) => field.id === data.id);
    if (!previous || data.type !== previous.type) return;
    if (data.participant_id && !props.participants?.some((person) => person.id === data.participant_id)) return;
    const patch = fieldDetailsPatch(previous, data);
    if (!Object.keys(patch).length) return;
    fieldEdits.enqueue(data.id, patch);
    void flushFieldDetails();
}

async function closeField(): Promise<void> {
    mediaController?.abort();
    fieldPanelOpen.value = false;
    await nextTick();
    input.value?.focus({ preventScroll: true });
}

async function saveField(
    draft: FieldDraft,
    floating = selectedField.value?.floating ?? false,
    targetPage?: number,
    file?: File,
): Promise<void> {
    if (props.readonly || mediaBusy.value || !kernel.value) return;
    if (pdfSource.value) floating = true;
    const base = session.document,
        selected = nativeSelection();
    let controller: AbortController | undefined;
    try {
        let next: NativeDocument,
            caret = selected?.focus;
        let fieldId = activeFieldId.value;
        if (fieldId) {
            next = updateNativeField(base, fieldId, draft);
            if (props.reviewPolicy) {
                const original = findNode(base, fieldId)!,
                    edited = findNode(next, fieldId)!;
                const attrs = { ...original.attributes };
                for (const key of ['name', 'type', 'value', 'participant_id', 'width', 'height'])
                    if (edited.attributes?.[key] !== undefined) attrs[key] = edited.attributes[key];
                if (original.attributes?.width !== attrs.width || original.attributes?.height !== attrs.height)
                    attrs.manuallyResized = true;
                const settings = { ...fieldSettings(original.attributes ?? {}) };
                const options = fieldSettings(edited.attributes ?? {}).options;
                if (options !== undefined) settings.options = options;
                if (original.attributes?.settings !== undefined || options !== undefined)
                    attrs.settings = Object.freeze(settings);
                next = replaceBlockNode(next, fieldId, (node) =>
                    Object.freeze({ ...node, attributes: Object.freeze(attrs) }),
                );
            }
        } else if (floating && scene.value) {
            const defaults = getDefaultVariableDimensions(draft.type);
            const inserted = insertFloatingNativeField(base, draft, scene.value, {
                page: targetPage ?? 0,
                x: scene.value.margin,
                y: pageLayout.value.margins.top * 0.75,
                width: (draft.width ?? defaults.width) * 0.75,
                height: (draft.height ?? defaults.height) * 0.75,
            });
            next = inserted.document;
            fieldId = inserted.fieldId;
        } else {
            if (!selected && !vacantPosition()) return;
            const inserted = writeAtPosition(base, selected, vacantPosition()?.target, (document, selection) => {
                const replaced = replaceSelection(document, selection, '');
                return insertNativeField(
                    replaced.document,
                    {
                        blockId: replaced.caret.blockId,
                        from: replaced.caret.offset,
                        to: replaced.caret.offset,
                        expectedRevision: replaced.document.revision,
                    },
                    draft,
                );
            });
            if (!inserted) return;
            next = inserted.document;
            caret = inserted.caret;
            fieldId = inserted.fieldId;
        }
        if (!floating && selectedField.value?.floating) {
            if (!caret) throw new Error('Choose an insertion point');
            const inserted = inlineNativeField(next, fieldId!, caret);
            next = Object.freeze({ ...inserted.document, revision: base.revision + 1 });
            caret = inserted.caret;
        }
        if (next.revision !== base.revision + 1) next = Object.freeze({ ...next, revision: base.revision + 1 });
        await kernel.value.prepare(next);
        if (props.readonly || session.document !== base) {
            await render();
            return;
        }
        const field = nativeFields(next).find((field) => field.id === fieldId)!;
        const style = fieldStyle(field.attributes),
            settings = fieldSettings(field.attributes);
        const previous = selectedField.value;
        if (
            !['signature', 'stamp', 'initials'].includes(String(field.attributes.type)) &&
            !settings.multiline &&
            (!previous || fieldStyle(previous.attributes).size !== style.size)
        ) {
            const measured = kernel.value.shapeRich(
                [{ nodeId: '', text: fieldDisplayValue(field.attributes) || 'Mgأب', style, editable: false }],
                100000,
                settings.direction === 'ltr' ? 'ltr' : 'rtl',
            );
            const height = Math.max(
                Number(field.attributes.height),
                Math.ceil((measured.lines[0].bottom - measured.lines[0].top) / 0.75),
            );
            if (height > Number(field.attributes.height))
                next = Object.freeze({ ...updateNativeField(next, fieldId!, { height }), revision: base.revision + 1 });
        }
        let prepared = layoutDocument(next, kernel.value);
        if (floating) {
            const position = prepared.pages.flatMap((page, index) =>
                page.commands.flatMap((command) =>
                    command.kind === 'field' && command.nodeId === fieldId
                        ? [{ x: command.x, y: command.y, width: command.width, height: command.height, page: index }]
                        : [],
                ),
            )[0];
            if (!position) throw new Error('The field has no page position');
            if (targetPage !== undefined) {
                const page = prepared.pages[targetPage];
                if (!page) throw new Error('Choose a document page');
                position.page = targetPage;
                position.x = Math.max(0, Math.min(position.x, page.width - position.width));
                position.y = Math.max(0, Math.min(position.y, page.height - position.height));
            }
            const positioned = placeNativeField(next, fieldId!, prepared, position);
            next = Object.freeze({ ...positioned.document, revision: base.revision + 1 });
            caret = positioned.caret ?? caret;
            prepared = layoutDocument(next, kernel.value);
        }
        if (file) {
            if (
                draft.type !== 'attachment' ||
                draft.participant_id ||
                file.size > 10 * 1024 * 1024 ||
                !props.uploadAttachment
            )
                throw new Error('Invalid author attachment');
            controller = new AbortController();
            mediaController = controller;
            mediaBusy.value = true;
            const uploaded = await props.uploadAttachment(fieldId!, draft.name, file, controller.signal);
            if (controller.signal.aborted || props.readonly || session.document !== base)
                throw new Error('The attachment edit was cancelled');
            next = Object.freeze({
                ...updateNativeField(next, fieldId!, {
                    value: uploaded.value,
                    settings: { filename: uploaded.filename },
                }),
                revision: base.revision + 1,
            });
            await kernel.value.prepare(next);
            if (controller.signal.aborted || props.readonly || session.document !== base)
                throw new Error('The attachment edit was cancelled');
            prepared = layoutDocument(next, kernel.value);
        }
        if (!(await commit(next))) return;
        emit('change', session.document);
        if (caret) await placeCaret(caret, prepared);
        else {
            scene.value = prepared;
            await nextTick();
        }
        activeFieldId.value = fieldId;
        refreshFormatting();
        await closeField();
    } catch {
        if (!controller?.signal.aborted)
            fieldPanelError.value = file ? labels.value.uploadFailed : labels.value.invalidField;
        if (!disposed) await render();
    } finally {
        if (controller && mediaController === controller) {
            mediaController = undefined;
            mediaBusy.value = false;
        }
    }
}

async function positionField(id: string, page: number, bounds: FieldBounds): Promise<void> {
    if (props.readonly || applyingInput.value || !kernel.value || !scene.value || !sceneCurrent.value) return;
    const current = scene.value.pages[page]?.commands.find(
        (command) => command.kind === 'field' && command.nodeId === id,
    );
    if (
        current?.kind === 'field' &&
        (['x', 'y', 'width', 'height'] as const).every((key) => Math.abs(current[key] - bounds[key]) < 0.00001)
    )
        return;
    try {
        const next = placeNativeField(session.document, id, scene.value, { ...bounds, page }).document;
        const prepared = layoutDocument(next, kernel.value);
        if (!(await commit(next))) return;
        scene.value = prepared;
        activeFieldId.value = id;
        emit('change', session.document);
        await nextTick();
        updateCaret();
    } catch {
        interactionError.value = labels.value.invalidField;
        await render();
    }
}

async function deleteField(): Promise<void> {
    if (props.readonly || !activeFieldId.value) return;
    const result = removeNativeField(session.document, activeFieldId.value);
    if (result.document !== session.document) {
        const caret = result.caret ?? nativeSelection()?.focus;
        if (caret) await finishStructure({ document: result.document, caret });
        else {
            if (!(await commit(result.document))) return;
            emit('change', session.document);
            await render();
        }
    }
    activeFieldId.value = undefined;
    closeField();
}

function selectImage(id: string): void {
    const image = allImages.value.find((image) => image.id === id);
    if (!image) return;
    if (image.blockId)
        setSelection(
            { blockId: image.blockId, offset: image.offset! },
            { blockId: image.blockId, offset: image.offset! + 1 },
        );
    else {
        const focus = nativeSelection()?.focus ?? selectNodeText(session.document.root)?.anchor;
        if (focus) setSelection(focus, focus);
    }
    activeFieldId.value = undefined;
    activeImageId.value = id;
    input.value?.focus({ preventScroll: true });
}

function openImage(id?: string): void {
    if (props.readonly || props.textOnly || (!id && !insertion.value.images) || mediaBusy.value) return;
    if (id) selectImage(id);
    else activeImageId.value = undefined;
    activeFieldId.value = undefined;
    imagePanelError.value = '';
    imagePanelOpen.value = true;
}

async function closeImage(): Promise<void> {
    mediaController?.abort();
    imagePanelOpen.value = false;
    commands.endPending('image');
    await nextTick();
    input.value?.focus({ preventScroll: true });
}

async function saveImage(
    draft: ImageDraft,
    file: File | undefined,
    floating: boolean,
    targetPage: number,
    selectionOverride?: NativeSelection,
    positionOverride?: EmptyWritingPosition,
): Promise<void> {
    if (props.readonly || mediaBusy.value || !kernel.value || !scene.value || !sceneCurrent.value) return;
    if (pdfSource.value) floating = true;
    const base = session.document,
        selection = positionOverride ? null : (selectionOverride ?? nativeSelection()),
        position = positionOverride ?? vacantPosition(),
        previous = selectedImage.value;
    const controller = new AbortController();
    mediaController = controller;
    mediaBusy.value = true;
    imagePanelError.value = '';
    let localUrl: string | undefined;
    let uploading = false;
    try {
        const pending = commands.pending.value?.kind === 'image' ? commands.pending.value.context : undefined;
        if (pending && !commands.valid(pending)) throw new Error('The insertion target changed');
        const resolvedSelection = pending?.trigger
            ? commandSelection(base, pending.trigger)
            : (pending?.selection ?? selection);
        if (file) {
            if (!props.uploadImage) throw new Error('Image uploads are unavailable');
            const decoded = await readImageFile(file);
            file = decoded.file;
            localUrl = URL.createObjectURL(file);
            draft = { ...draft, src: localUrl };
        }
        let next: NativeDocument,
            id = previous?.id,
            caret = resolvedSelection?.focus;
        if (previous) {
            next = updateNativeImage(base, previous.id, draft);
            if (!floating && previous.floating) {
                if (!caret) throw new Error('Choose an insertion point');
                const inserted = inlineNativeImage(next, previous.id, caret);
                next = Object.freeze({ ...inserted.document, revision: base.revision + 1 });
                caret = inserted.caret;
            }
        } else if (floating) {
            const create = (document: NativeDocument, current: DocumentScene, point = resolvedSelection?.focus) => {
                const page = current.pages[targetPage];
                if (!page) throw new Error('Choose a document page');
                const line = page.lines.find((line) => line.paragraphId === (point?.blockId ?? activeBlock.value));
                return {
                    ...insertFloatingNativeImage(document, draft, current, {
                        page: targetPage,
                        x: Math.max(0, Math.min(line?.left ?? 54, page.width - draft.width * 0.75)),
                        y: Math.max(0, Math.min(line?.top ?? 54, page.height - draft.height * 0.75)),
                        width: draft.width * 0.75,
                        height: draft.height * 0.75,
                    }),
                    caret: point,
                };
            };
            const inserted = pending?.trigger
                ? runDocumentCommand(base, pending.selection, pending.target, pending.trigger, (working, selected) =>
                      create(working, layoutDocument(working, kernel.value!), selected.focus),
                  )
                : create(base, scene.value);
            if (!inserted) return;
            next = inserted.document;
            id = inserted.imageId;
            caret = inserted.caret;
        } else {
            if (!resolvedSelection && !position) throw new Error('Choose an insertion point');
            const inserted = writeAtPosition(base, resolvedSelection, position?.target, (document, selected) => {
                const replaced = replaceSelection(document, selected, '');
                return insertNativeImage(
                    replaced.document,
                    {
                        blockId: replaced.caret.blockId,
                        from: replaced.caret.offset,
                        to: replaced.caret.offset,
                        expectedRevision: replaced.document.revision,
                    },
                    draft,
                );
            });
            if (!inserted) return;
            next = inserted.document;
            id = inserted.imageId;
            caret = inserted.caret;
        }
        await kernel.value.prepare(next);
        if (controller.signal.aborted || props.readonly || session.document !== base)
            throw new Error('The image edit was cancelled');
        let prepared = layoutDocument(next, kernel.value);
        if (floating && !previous?.attributes.locked) {
            const box = prepared.pages
                .flatMap((page) => page.commands)
                .find((command) => command.kind === 'image' && command.nodeId === id);
            if (box?.kind !== 'image') throw new Error('The image has no page position');
            const positioned = placeNativeImage(next, id!, prepared, {
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
                page: targetPage,
            });
            next = Object.freeze({ ...positioned.document, revision: base.revision + 1 });
            caret = positioned.caret ?? caret;
            prepared = layoutDocument(next, kernel.value);
        }
        if (file) {
            uploading = true;
            const uploaded = await props.uploadImage!(file, draft.attachmentId ?? undefined, controller.signal);
            if (controller.signal.aborted || props.readonly || session.document !== base)
                throw new Error('The image edit was cancelled');
            kernel.value.images.alias(draft.src, uploaded.src);
            const positioned = nativeImages(next).find((image) => image.id === id)!.attributes;
            next = Object.freeze({
                ...updateNativeImage(next, id!, {
                    ...draft,
                    ...uploaded,
                    width: Number(positioned.width),
                    height: Number(positioned.height),
                }),
                revision: base.revision + 1,
            });
            prepared = layoutDocument(next, kernel.value);
        }
        if (!(await commit(next))) return;
        emit('change', session.document);
        if (caret) await placeCaret(caret, prepared);
        else {
            scene.value = prepared;
            await nextTick();
        }
        activeImageId.value = id;
        imagePanelOpen.value = false;
        commands.endPending('image');
        await nextTick();
        input.value?.focus({ preventScroll: true });
    } catch {
        if (!controller.signal.aborted)
            imagePanelError.value = uploading ? labels.value.uploadFailed : labels.value.invalidImage;
        if (!disposed) await render();
    } finally {
        if (localUrl) URL.revokeObjectURL(localUrl);
        if (mediaController === controller) {
            mediaController = undefined;
            mediaBusy.value = false;
        }
    }
}

async function insertPickedImage(file: File): Promise<void> {
    if (props.readonly || !insertion.value.images || mediaBusy.value || !props.uploadImage) return;
    const base = session.document,
        selection = nativeSelection(),
        position = vacantPosition();
    if (!selection && !position) return;
    try {
        const decoded = await readImageFile(file);
        if (props.readonly || session.document !== base) return;
        const scale = Math.min(1, imageLimits.value.width / decoded.width, imageLimits.value.height / decoded.height);
        activeImageId.value = undefined;
        await saveImage(
            { src: '', alt: file.name, width: decoded.width * scale, height: decoded.height * scale },
            decoded.file,
            false,
            imagePage.value,
            selection ?? undefined,
            position,
        );
        if (imagePanelError.value) interactionError.value = imagePanelError.value;
    } catch {
        interactionError.value = labels.value.invalidImage;
    }
}

function canInsertFields(): boolean {
    return (
        !!kernel.value &&
        !!scene.value &&
        sceneCurrent.value &&
        !props.readonly &&
        insertion.value.fields &&
        !mediaBusy.value &&
        !applyingInput.value &&
        !sharedApplying.value
    );
}

function dropPoint(event: DragEvent): { page: number; x: number; y: number } | undefined {
    const page = (event.target as HTMLElement).closest<HTMLElement>('.native-page');
    if (!page) return;
    const bounds = page.getBoundingClientRect();
    return {
        page: Number(page.dataset.page) - 1,
        x: (event.clientX - bounds.left) / viewScale.value,
        y: (event.clientY - bounds.top) / viewScale.value,
    };
}

async function insertPaletteField(
    source: VariablePaletteEntry,
    target?: { page: number; x: number; y: number; shift?: boolean; inline?: boolean },
): Promise<boolean> {
    const entry = paletteEntry(source);
    if (!canInsertFields() || !entry || !kernel.value || !scene.value) return false;
    if (entry.participant_id && !props.participants?.some((participant) => participant.id === entry.participant_id))
        return false;
    const base = session.document;
    const working = base;
    let selected = nativeSelection();
    const position = target ? emptyWritingPosition(base, scene.value, target.page, target) : vacantPosition();
    if (position) selected = null;
    const hit = target ? hitTest(scene.value, target.page, target.x, target.y) : undefined;
    if (hit)
        selected = {
            anchor: { blockId: hit.blockId, offset: hit.blockOffset },
            focus: { blockId: hit.blockId, offset: hit.blockOffset },
        };
    if (selected?.cells) selected = { anchor: selected.focus, focus: selected.focus };
    let floating = !!pdfSource.value || VARIABLE_CONFIGS[entry.type].display === 'block';
    if (target) {
        const line =
            hit &&
            scene.value.pages[target.page].lines.find(
                (line) =>
                    line.paragraphId === hit.blockId &&
                    target.y >= line.top &&
                    target.y <= line.top + line.height &&
                    target.x >= (line.left ?? scene.value!.margin) &&
                    target.x <= (line.left ?? scene.value!.margin) + line.shaped.width,
            );
        if (target.shift) floating = true;
        else if (target.inline && (hit || position)) floating = false;
        else if (!floating) floating = !line && !cellAt(scene.value, target.page, target.x, target.y);
        if (target.page < (scene.value.coverPages ?? 0)) {
            if (props.integration?.allowCoverField?.(entry.type) === false) return false;
            floating = true;
        }
    }
    if (!selected && !position) {
        const first = textBlocks(working.root)[0];
        if (first) selected = { anchor: { blockId: first.id, offset: 0 }, focus: { blockId: first.id, offset: 0 } };
    }
    try {
        const point = selected?.focus;
        const style = point
            ? selectionTextStyle(working, {
                  blockId: point.blockId,
                  from: point.offset,
                  to: point.offset,
                  expectedRevision: working.revision,
              })
            : documentTextStyle(session.document);
        const block = point ? findNode(working, point.blockId) : undefined;
        const direction =
            block?.attributes?.dir === 'ltr'
                ? 'ltr'
                : block?.attributes?.dir === 'rtl'
                  ? 'rtl'
                  : toolbarDirection.value;
        let draft = paletteDraft(
            entry,
            style,
            direction,
            typeof block?.attributes?.textAlign === 'string' ? block.attributes.textAlign : undefined,
        );
        const defaults = getDefaultVariableDimensions(entry.type);
        if (!['signature', 'stamp', 'initials'].includes(entry.type)) {
            const fieldTextStyle = fieldStyle(createNativeFieldAttributes(draft));
            const shaped = kernel.value.shapeRich(
                [{ nodeId: '', text: entry.name, style: fieldTextStyle, editable: false }],
                100000,
                direction,
            );
            draft = {
                ...draft,
                height: Math.max(defaults.height, Math.ceil((shaped.lines[0].bottom - shaped.lines[0].top) / 0.75)),
            };
        }
        let next: NativeDocument;
        let id: string;
        let caret: TextCaret | undefined;
        if (floating) {
            const pageIndex =
                target?.page ??
                (point
                    ? scene.value.pages.findIndex((page) =>
                          page.lines.some((line) => line.paragraphId === point.blockId),
                      )
                    : 0);
            const page = scene.value.pages[Math.max(0, pageIndex)];
            if (!page) return false;
            const width = Math.min(page.width, defaults.width * 0.75);
            const height = Math.min(page.height, (draft.height ?? defaults.height) * 0.75);
            const placement = {
                page: Math.max(0, pageIndex),
                x: Math.max(0, Math.min(page.width - width, target ? target.x - width / 2 : scene.value.margin)),
                y: Math.max(0, Math.min(page.height - height, target ? target.y - height / 2 : scene.value.margin)),
                width,
                height,
            };
            const inserted = insertFloatingNativeField(base, draft, scene.value, placement);
            next = inserted.document;
            id = inserted.fieldId;
        } else {
            if (!selected && !position) return false;
            const inserted = writeAtPosition(working, selected, position?.target, (document, selection) => {
                const replaced = replaceSelection(document, selection, '');
                return insertNativeField(
                    replaced.document,
                    {
                        blockId: replaced.caret.blockId,
                        from: replaced.caret.offset,
                        to: replaced.caret.offset,
                        expectedRevision: replaced.document.revision,
                    },
                    draft,
                );
            });
            if (!inserted) return false;
            next = inserted.document;
            id = inserted.fieldId;
            caret = inserted.caret;
        }
        const prepared = layoutDocument(next, kernel.value);
        if (!(await commit(next))) return false;
        selectingCells.value = false;
        emit('change', session.document);
        if (caret) await placeCaret(caret, prepared);
        else if (point && findNode(next, point.blockId)) await placeCaret(point, prepared);
        else {
            scene.value = prepared;
            documentSelection.value = null;
            await nextTick();
        }
        activeImageId.value = undefined;
        activeFieldId.value = id;
        refreshFormatting();
        input.value?.focus({ preventScroll: true });
        return true;
    } catch {
        interactionError.value = labels.value.invalidField;
        return false;
    }
}

function variablesForUi() {
    void documentRevision.value;
    void fieldEditRevision.value;
    return nativeFields(session.document).map((field) => {
        const variable = variableForUi(field);
        const patch = fieldEdits.patch(field.id);
        return patch
            ? ({ ...variable, ...patch, settings: { ...variable.settings, ...patch.settings } } as VariableData)
            : variable;
    });
}

function revealField(id: string): void {
    const node = editorRoot.value?.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(id)}"]`);
    if (node) node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
}

function dragFile(event: DragEvent): void {
    if (props.readonly || mediaBusy.value) return;
    if (
        (!props.textOnly && event.dataTransfer?.types.includes(fieldMime.value)) ||
        (props.uploadImage && event.dataTransfer?.types.includes('Files'))
    ) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    }
}

async function dropFile(event: DragEvent): Promise<void> {
    const target = dropPoint(event);
    if (!target) return;
    if (event.dataTransfer?.types.includes(fieldMime.value)) {
        if (!canInsertFields()) return;
        event.preventDefault();
        try {
            const entry = paletteEntry(JSON.parse(event.dataTransfer.getData(fieldMime.value)));
            if (!entry) throw new Error('Invalid field');
            await insertPaletteField(entry, {
                ...target,
                shift: event.shiftKey,
                inline: event.ctrlKey || event.metaKey,
            });
        } catch {
            interactionError.value = labels.value.invalidField;
        }
        return;
    }
    const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/'));
    if (props.readonly || mediaBusy.value || !props.uploadImage || !files.length) return;
    event.preventDefault();
    await selectPoint(target.page, target.x, target.y, false, 1, false);
    for (const file of files) await insertPickedImage(file);
}

async function positionImage(id: string, page: number, bounds: FieldBounds): Promise<void> {
    if (props.readonly || mediaBusy.value || !kernel.value || !scene.value || !sceneCurrent.value) return;
    const current = scene.value.pages[page]?.commands.find(
        (command) => command.kind === 'image' && command.nodeId === id,
    );
    if (
        current?.kind === 'image' &&
        (['x', 'y', 'width', 'height'] as const).every((key) => Math.abs(current[key] - bounds[key]) < 0.00001)
    )
        return;
    try {
        const next = placeNativeImage(session.document, id, scene.value, { ...bounds, page }).document;
        const prepared = layoutDocument(next, kernel.value);
        if (!(await commit(next))) return;
        scene.value = prepared;
        activeImageId.value = id;
        emit('change', session.document);
        await nextTick();
        updateCaret();
    } catch {
        interactionError.value = labels.value.invalidImage;
        await render();
    }
}

async function deleteImage(): Promise<void> {
    if (props.readonly || mediaBusy.value || !activeImageId.value || selectedImage.value?.attributes.locked) return;
    const result = removeNativeImage(session.document, activeImageId.value),
        caret = result.caret ?? nativeSelection()?.focus;
    if (caret) await finishStructure({ document: result.document, caret });
    else {
        if (!(await commit(result.document))) return;
        emit('change', session.document);
        await render();
    }
    activeImageId.value = undefined;
    closeImage();
}

async function forSave(document: NativeDocument): Promise<NativeDocument> {
    const hasObjects = nativeFields(document).length > 0 || nativeImages(document).length > 0;
    const stamp = (scene: DocumentScene) =>
        persistClauseVariants(
            persistNativeIdentities(
                persistClauseNumbers(
                    hasObjects
                        ? stampNativeImages(
                              stampNativeFields(
                                  pdfSource.value ? document : bindFloatingAnchors(document, scene),
                                  scene,
                              ),
                              scene,
                          )
                        : document,
                ),
            ),
        );
    if (scene.value?.revision === document.revision && scene.value.documentId === document.id)
        return stamp(scene.value);
    if (session.document === document) {
        await render();
        if (scene.value?.revision === document.revision) return stamp(scene.value);
    }
    const renderer = await NativeTextKernel.create(props.resolveMedia);
    try {
        await renderer.prepare(document);
        return stamp(layoutDocument(document, renderer));
    } finally {
        renderer.destroy();
    }
}

function selectCells(cells: TableCellSelection): void {
    const range = selectionController.cells(session.document, cells);
    if (!range) return;
    setSelection(range.anchor, range.focus, range.scopeId, range.cells);
    scheduleCaretUpdate();
}

function selectTableMenuCells(cells: TableCellSelection): void {
    const range = selectionController.cells(session.document, cells);
    if (!range) return;
    activeFieldId.value = undefined;
    activeImageId.value = undefined;
    setSelection(range.anchor, range.focus, range.scopeId, range.cells, false);
    scheduleCaretUpdate();
}

function dismissTableControls(): void {
    const selected = documentSelection.value;
    if (selected?.cells && findNode(session.document, selected.anchor.blockId))
        setSelection(selected.anchor, selected.anchor, undefined, undefined, false);
    updateCaret();
}
function focusTableControls(): void {
    dismissTableControls();
    input.value?.focus({ preventScroll: true });
}

async function applyTableControl(
    base: NativeDocument,
    edit: NativeTableEdit,
    selected: NativeSelection | null,
): Promise<boolean> {
    if (
        props.readonly ||
        props.reviewPolicy ||
        mediaBusy.value ||
        sharedApplying.value ||
        base !== session.document ||
        !sceneCurrent.value
    )
        return false;
    const intent = inputPointerIntent;
    if (!(await commit(edit.document))) return false;
    activeFieldId.value = undefined;
    activeImageId.value = undefined;
    storedMarks.value = undefined;
    emit('change', session.document);
    await render();
    const ownsSelection = intent === inputPointerIntent;
    if (ownsSelection) {
        if (selected) setSelection(selected.anchor, selected.focus, selected.scopeId, selected.cells, false);
        else if (edit.caret) setSelection(edit.caret, edit.caret, undefined, undefined, false);
    }
    updateCaret();
    if (ownsSelection && edit.reveal && edit.caret) revealCaret(edit.caret);
    return true;
}

function toggleCellSelection(): void {
    if (!activeBlock.value) return;
    if (selectingCells.value) {
        const focus = nativeSelection()?.focus;
        if (focus) setSelection(focus, focus);
    } else {
        const context = tableContext(session.document, activeBlock.value);
        if (context)
            selectCells({
                tableId: context.grid.table.id,
                anchorId: context.cell.node.id,
                focusId: context.cell.node.id,
            });
    }
}

async function mergeCells(): Promise<void> {
    if (props.readonly || !documentSelection.value?.cells) return;
    const result = mergeTableCells(session.document, documentSelection.value.cells);
    if (result) await finishStructure(result);
}

async function splitCell(): Promise<void> {
    if (props.readonly || !activeBlock.value) return;
    const context = tableContext(session.document, activeBlock.value);
    const result = context && splitTableCell(session.document, context.cell.node.id);
    if (result) await finishStructure(result);
}

async function resizeColumns(tableId: string, boundary: number, delta: number, width: number): Promise<void> {
    const selected = nativeSelection();
    if (props.readonly || !selected || !sceneCurrent.value) return;
    const layout = scene.value?.pages.flatMap((page) => page.cells ?? []).find((cell) => cell.tableId === tableId);
    if (!layout) return;
    const next = resizeTableColumns(session.document, tableId, boundary, delta, width, layout);
    if (next !== session.document) {
        const handle =
            document.activeElement instanceof HTMLElement &&
            document.activeElement.classList.contains('native-column-handle')
                ? document.activeElement
                : undefined;
        await finishStructure({ document: next, caret: selected.focus }, selected, { reveal: false });
        if (handle?.isConnected) handle.focus({ preventScroll: true });
    }
}

async function resizeRow(tableId: string, rowId: string, height: number | null): Promise<void> {
    const selected = nativeSelection();
    if (props.readonly || props.reviewPolicy || !selected || !sceneCurrent.value) return;
    const next = setTableRowHeight(session.document, tableId, rowId, height === null ? null : height / 0.75);
    if (next === session.document) return;
    const handle =
        document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('native-row-handle')
            ? document.activeElement
            : undefined;
    await finishStructure({ document: next, caret: selected.focus }, selected, { reveal: false });
    if (handle?.isConnected) handle.focus({ preventScroll: true });
}

async function indentSelection(lift: boolean): Promise<void> {
    const selected = nativeSelection();
    if (props.readonly || applyingInput.value || !sceneCurrent.value || (!selected && !vacantPosition())) return;
    if (selected && listContext(session.document, selected.focus.blockId))
        await finishStructure(
            { document: indentList(session.document, selected, lift), caret: selected.focus },
            selected,
        );
    else
        await applyBlockFormat({
            indent: Math.max(0, Math.min(20, Number(toolbarBlock.value?.attributes?.indent ?? 0) + (lift ? -1 : 1))),
        });
}

async function applyTable(command: TableCommand): Promise<void> {
    if (props.readonly || applyingInput.value || !sceneCurrent.value || !activeBlock.value) return;
    const result = tableCommand(session.document, activeBlock.value, command);
    if (result) await finishStructure(result);
}

async function createTable(rows: number, columns: number, header: boolean): Promise<void> {
    if (!insertion.value.tables) return;
    const selected = nativeSelection();
    if (
        props.readonly ||
        props.textOnly ||
        applyingInput.value ||
        !sceneCurrent.value ||
        (!selected && !vacantPosition())
    )
        return;
    try {
        const result = writeAtPosition(session.document, selected, vacantPosition()?.target, (document, range) => {
            const replaced = replaceSelection(document, range, '');
            return insertTable(replaced.document, replaced.caret, rows, columns, header);
        });
        if (result) await finishStructure(result);
    } catch (failure) {
        interactionError.value = labels.value.error;
        emit('error', failure);
    }
}

function revealCaret(target: TextCaret): void {
    const rect = caretRectangle(target, selectionController.affinity);
    if (rect) revealBounds({ ...rect, width: 0 });
}

function revealSelection(selected: NativeSelection): void {
    const rectangles = rangeRectangles(selected, false);
    if (!rectangles.length) {
        revealCaret(selected.anchor);
        return;
    }
    const left = Math.min(...rectangles.map((rect) => rect.left)),
        top = Math.min(...rectangles.map((rect) => rect.top));
    revealBounds({
        left,
        top,
        width: Math.max(...rectangles.map((rect) => rect.left + rect.width)) - left,
        height: Math.max(...rectangles.map((rect) => rect.top + rect.height)) - top,
    });
}

function revealBounds(rect: { left: number; top: number; width: number; height: number }): void {
    if (!editorRoot.value) return;
    const pages = editorRoot.value.querySelector<HTMLElement>('.native-pages');
    if (!pages) return;
    const container = scrollingContainer(pages);
    const bounds =
        container === document.scrollingElement ? { top: 0, bottom: innerHeight } : container.getBoundingClientRect();
    const top = Math.max(0, bounds.top, editorChrome().bottom) + 8,
        bottom = Math.min(innerHeight, bounds.bottom) - 8;
    container.scrollTop +=
        rect.height > bottom - top || rect.top < top
            ? rect.top - top
            : rect.top + rect.height > bottom
              ? rect.top + rect.height - bottom
              : 0;
    const box = pages.getBoundingClientRect();
    const left = Math.max(0, box.left) + 8,
        right = Math.min(innerWidth, box.right) - 8;
    pages.scrollLeft +=
        rect.width > right - left || rect.left < left
            ? rect.left - left
            : rect.left + rect.width > right
              ? rect.left + rect.width - right
              : 0;
    scheduleCaretUpdate();
}

function key(event: KeyboardEvent): Promise<void> | undefined {
    if (event.isComposing) return;
    const collapsed = input.value?.selectionStart === input.value?.selectionEnd;
    const boundaryDelete =
        ['Backspace', 'Delete'].includes(event.key) &&
        (!!documentSelection.value ||
            !!selectedField.value ||
            !!selectedImage.value ||
            (collapsed &&
                (event.key === 'Backspace'
                    ? input.value?.selectionStart === 0
                    : input.value?.selectionEnd === input.value?.value.length)));
    const block = activeBlock.value && findNode(session.document, activeBlock.value);
    const customEnter =
        event.key === 'Enter' &&
        (!!props.reviewPolicy ||
            !!documentSelection.value ||
            !!selectedImage.value ||
            !!selectedField.value?.floating ||
            (!event.shiftKey && (!block || ['paragraph', 'heading'].includes(block.kind))));
    const custom =
        customEnter ||
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab'].includes(event.key) ||
        boundaryDelete ||
        ((event.ctrlKey || event.metaKey) && ['a', 'z', 'y', 'b', 'i', 'u'].includes(event.key.toLowerCase()));
    if (!props.readonly && custom) {
        event.preventDefault();
        const selected = inputQueue.pending && lastQueuedInputIntent === inputPointerIntent ? null : nativeSelection();
        lastQueuedInputIntent = inputPointerIntent;
        queuedKeys++;
        queuedInputs.value++;
        return inputQueue.push({ kind: 'key', intent: inputPointerIntent, event, selection: selected }).finally(() => {
            queuedInputs.value--;
            queuedKeys--;
            if (!queuedInputs.value) {
                createdInputTargets.clear();
                replacedInputRanges = new WeakMap();
                inputSelections.clear();
            }
        });
    }
    return keyNow(event);
}
async function keyNow(event: KeyboardEvent): Promise<void> {
    if (event.isComposing) return;
    if (commands.key(event)) return;
    if (!props.readonly && document.activeElement === input.value) {
        const result = commands.live.key(event);
        if (result.handled) {
            event.preventDefault();
            commands.templateRevision.value++;
            if (result.selection) {
                storedMarks.value = undefined;
                storedPosition = undefined;
                setSelection(result.selection.anchor, result.selection.focus);
            }
            updateCaret();
            return;
        }
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
        if (floatingFieldClipboard && event.code === 'KeyV') {
            event.preventDefault();
            await pasteFloatingField();
            return;
        }
        if (selectedField.value?.floating && ['KeyC', 'KeyX'].includes(event.code)) {
            event.preventDefault();
            await copyField(selectedField.value.id, event.code === 'KeyX');
            return;
        }
    }
    try {
        await applyKey(event);
    } catch (failure) {
        if (!reviewRefused(failure)) throw failure;
    }
}
function stopTyping(): void {
    typingHistory.reset();
    session.stopCapturing();
}
async function applyKey(event: KeyboardEvent): Promise<void> {
    if (
        (event.key.length !== 1 && !['Backspace', 'Delete'].includes(event.key)) ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
    ) {
        stopTyping();
    }

    const reviewShortcut = keyboardShortcut(event);
    if (props.reviewPolicy && !props.readonly) {
        if (
            ((event.ctrlKey || event.metaKey) && ['b', 'i', 'u', 'k'].includes(reviewShortcut)) ||
            (event.altKey && event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key))
        ) {
            event.preventDefault();
            return;
        }
        if (event.key === 'Tab') return;
        const block = activeBlock.value ? findNode(session.document, activeBlock.value) : undefined;
        const selected = nativeSelection();
        if (
            ['Enter', 'Backspace', 'Delete'].includes(event.key) &&
            selected &&
            selectionRanges(session.document, selected).length > 1
        ) {
            event.preventDefault();
            reviewRefused(new NativeReviewViolation());
            return;
        }
        if (event.key === 'Enter' && block && input.value) {
            event.preventDefault();
            const from = input.value.selectionStart,
                to = input.value.selectionEnd;
            const context = listContext(session.document, block.id);
            const result =
                !event.shiftKey &&
                from > 0 &&
                context?.item.children?.length === 1 &&
                !blockText(block).slice(to).includes('\uFFFC')
                    ? splitListItem(session.document, {
                          blockId: block.id,
                          from,
                          to,
                          expectedRevision: session.document.revision,
                      })
                    : null;
            if (result) await finishStructure(result);
            else {
                const next = replaceInlineText(session.document, {
                    blockId: block.id,
                    from,
                    to,
                    text: '\n',
                    expectedRevision: session.document.revision,
                });
                if (!(await commit(next))) return;
                emit('change', session.document);
                await placeCaret({ blockId: block.id, offset: from + 1 });
            }
            return;
        }
        if (event.key === 'Backspace' && block && input.value?.selectionStart === 0 && input.value.selectionEnd === 0) {
            event.preventDefault();
            if (!findNode(props.reviewPolicy.base, block.id)) {
                const result = joinListItem(session.document, block.id);
                if (result) await finishStructure(result);
            }
            return;
        }
    }
    if (sharedApplying.value) {
        event.preventDefault();
        return;
    }
    if (event.isComposing) return;
    if (
        event.altKey &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        ['ArrowUp', 'ArrowDown'].includes(event.key)
    ) {
        event.preventDefault();
        await blockAction(event.key === 'ArrowUp' ? 'up' : 'down');
        return;
    }
    if (event.key === 'Escape' && (selectedImage.value || selectedField.value)) {
        event.preventDefault();
        const focus = nativeSelection()?.focus;
        activeImageId.value = undefined;
        activeFieldId.value = undefined;
        if (focus) setSelection(focus, focus);
        refreshFormatting();
        return;
    }
    if (selectedImage.value) {
        if (event.key === 'F2' || event.key === 'Enter') {
            event.preventDefault();
            openImage(selectedImage.value.id);
            return;
        }
        if (['Backspace', 'Delete'].includes(event.key)) {
            event.preventDefault();
            await deleteImage();
            return;
        }
        if (
            selectedImage.value.floating &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
        ) {
            event.preventDefault();
            const index = imagePage.value,
                page = scene.value?.pages[index];
            const box = page?.commands.find(
                (command) => command.kind === 'image' && command.nodeId === activeImageId.value,
            );
            const step = (event.shiftKey ? 10 : 1) * 0.75;
            if (box?.kind === 'image' && page)
                await positionImage(
                    selectedImage.value.id,
                    index,
                    transformField(
                        box,
                        'move',
                        event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
                        event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
                        page,
                    ),
                );
            return;
        }
    }
    if (
        selectedField.value?.floating &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    ) {
        event.preventDefault();
        const index = fieldPanelPage.value,
            page = scene.value?.pages[index];
        const field = page?.commands.find(
            (command) => command.kind === 'field' && command.nodeId === activeFieldId.value,
        );
        if (page && field?.kind === 'field') {
            const step = (event.shiftKey ? 10 : 1) * 0.75;
            await positionField(
                field.nodeId,
                index,
                transformField(
                    field,
                    'move',
                    event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
                    event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
                    page,
                ),
            );
        }
        return;
    }
    if ((event.key === 'F2' || (event.key === 'Enter' && selectedField.value?.floating)) && activeFieldId.value) {
        event.preventDefault();
        openField(activeFieldId.value);
        return;
    }
    if (selectedField.value?.floating && ['Backspace', 'Delete'].includes(event.key)) {
        event.preventDefault();
        await deleteField();
        return;
    }
    const shortcut = keyboardShortcut(event);
    const paging = ['PageUp', 'PageDown'].includes(event.key);
    const pages = paging ? editorRoot.value?.querySelector<HTMLElement>('.native-pages') : undefined;
    const container = pages ? scrollingContainer(pages) : undefined;
    const bounds =
        container === document.scrollingElement ? { top: 0, bottom: innerHeight } : container?.getBoundingClientRect();
    const height = bounds
        ? Math.max(96, Math.min(innerHeight, bounds.bottom) - Math.max(0, bounds.top, editorChrome().bottom))
        : undefined;
    const movement = selectionController.navigate(event, navigation(), nativeSelection(), {
        platform: navigator.platform,
        pageHeight: height === undefined ? undefined : height / viewScale.value,
    });
    if (movement) {
        event.preventDefault();
        const range = movement.selection;
        if (range) {
            setSelection(range.anchor, range.focus, range.scopeId, range.cells);
            if (movement.pageDirection && container && height) container.scrollTop += movement.pageDirection * height;
            revealCaret(range.focus);
        }
        return;
    }
    if (!['Shift', 'Control', 'Meta', 'Alt'].includes(event.key)) selectionController.column = undefined;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && shortcut === 'a') {
        event.preventDefault();
        selectAll();
        return;
    }
    if ((event.ctrlKey || event.metaKey) && shortcut === 'v') plainPaste = event.shiftKey;
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        menuMode.value = 'context';
        blockMenuId.value = undefined;
        gutterMenuId.value = undefined;
        menuContext.value = commands.context();
        updateCaret();
        const rect = activeFieldId.value
            ? editorRoot.value
                  ?.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(activeFieldId.value)}"]`)
                  ?.getBoundingClientRect()
            : (caret.value ?? selection.value[0]);
        if (rect) {
            menuAt.value = {
                left: Math.max(8, Math.min(innerWidth - 320, rect.left)),
                top: Math.max(8, Math.min(innerHeight - 128, rect.top + (rect.height ?? 16))),
            };
            await nextTick();
            focusContextMenu();
        }
        return;
    }
    if (event.key === 'Escape' && documentSelection.value) {
        event.preventDefault();
        const focus = documentSelection.value.focus;
        selectionController.region = undefined;
        setSelection(focus, focus);
        revealCaret(focus);
        return;
    }
    if (
        documentSelection.value &&
        !event.shiftKey &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
    ) {
        event.preventDefault();
        const ranges = selectionRanges(session.document, documentSelection.value);
        const first = ranges[0],
            last = ranges.at(-1)!;
        const end = ['ArrowRight', 'ArrowDown', 'End'].includes(event.key);
        const position = { blockId: end ? last.blockId : first.blockId, offset: end ? last.to : first.from };
        setSelection(position, position);
        return;
    }
    if (props.readonly) return;
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && ['Digit7', 'Digit8'].includes(event.code)) {
        event.preventDefault();
        await applyList(event.code === 'Digit7' ? 'orderedList' : 'bulletList');
        return;
    }
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey && activeBlock.value) {
        event.preventDefault();
        const result = tabTable(session.document, activeBlock.value, event.shiftKey);
        if (result) {
            await finishStructure(result);
            const target = tableContext(session.document, result.caret.blockId);
            const selected = target && selectNodeText(target.cell.node);
            if (selected) setSelection(selected.anchor, selected.focus, selected.scopeId);
        } else await indentSelection(event.shiftKey);
        return;
    }
    if (documentSelection.value && ['Backspace', 'Delete', 'Enter'].includes(event.key)) {
        event.preventDefault();
        await replaceDocumentSelection(event.key === 'Enter' ? '\n' : '');
        return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && ['z', 'y'].includes(shortcut)) {
        event.preventDefault();
        await history(shortcut === 'y' || event.shiftKey ? 'redo' : 'undo');
        return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && ['b', 'i', 'u'].includes(shortcut)) {
        event.preventDefault();
        await applyFormat({
            kind: 'toggle',
            mark: shortcut === 'b' ? 'bold' : shortcut === 'i' ? 'italic' : 'underline',
        });
        return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && shortcut === 'k') {
        event.preventDefault();
        refreshFormatting();
        await nextTick();
        await toolbar.value?.openLink?.();
        return;
    }
    if (!activeBlock.value && event.key === 'Enter' && !event.shiftKey && vacantPosition()) {
        event.preventDefault();
        const result = writeAtPosition(session.document, null, vacantPosition()!.target, (document, selected) =>
            splitTextBlock(document, {
                blockId: selected.focus.blockId,
                from: 0,
                to: 0,
                expectedRevision: document.revision,
            }),
        );
        if (result) await finishStructure(result);
        return;
    }
    const block = activeBlock.value ? findNode(session.document, activeBlock.value) : undefined;
    if (block && input.value) {
        const from = input.value.selectionStart,
            to = input.value.selectionEnd;
        if (event.key === 'Enter' && !event.shiftKey && ['paragraph', 'heading'].includes(block.kind)) {
            event.preventDefault();
            const edit = {
                blockId: block.id,
                from,
                to,
                expectedRevision: session.document.revision,
            };
            const result = splitListItem(session.document, edit) ?? splitTextBlock(session.document, edit);
            if (!(await commit(result.document))) return;
            storedMarks.value = storedMarks.value ?? marksAtCaret(block, from);
            if (block.kind === 'heading' && to === blockText(block).length)
                storedMarks.value = changeTextMarks(storedMarks.value, {
                    kind: 'style',
                    attributes: { fontSize: '14px' },
                });
            emit('change', session.document);
            await placeCaret(result.caret);
            return;
        }
        if (event.key === 'Backspace' && from === 0 && to === 0) {
            const result =
                joinPreviousTextBlock(session.document, block.id) ?? joinListItem(session.document, block.id);
            if (result) {
                event.preventDefault();
                if (!(await commit(result.document))) return;
                storedMarks.value = undefined;
                emit('change', session.document);
                await placeCaret(result.caret);
                return;
            }
        }
    }
    requestAnimationFrame(updateCaret);
}

async function pdf(): Promise<Uint8Array> {
    if (!scene.value || !kernel.value) throw new Error('The document is not ready');
    const displayed = scene.value;
    const renderer = kernel.value;
    const { writeScenePdf, createPdfOverlaySnapshot, pdfSourcePages } = await import('../../pdf/index.js');
    if (pdfSource.value) {
        const bytes = pdfSource.value.bytes();
        return createPdfOverlaySnapshot(
            bytes,
            displayed,
            renderer,
            () => session.document,
            await pdfSourcePages(bytes),
        );
    }
    return writeScenePdf(displayed, renderer, () => session.document, {
        title: props.title ?? labels.value.document,
    });
}

async function setContent(content: unknown): Promise<void> {
    inputQueue.reset();
    await inputQueue.idle();
    const base = session.document;
    const candidate = Object.freeze({ ...importDocument(content, base.id), revision: base.revision + 1 });
    try {
        await applyDocumentEdit(
            candidate,
            () => session.document,
            prepareCandidateScene,
            (prepared) => {
                session.reset(prepared.document);
                createdInputTargets.clear();
                replacedInputRanges = new WeakMap();
                inputSelections.clear();
                layoutController.remember(session.document, { document: session.document, scene: prepared.scene });
            },
            (prepared) => prepared.release(),
        );
    } catch (failure) {
        if (kernel.value && !disposed) {
            await kernel.value.prepare(session.document);
            kernel.value.clearUnused(new Set());
        }
        throw failure;
    }
    typingHistory.reset();
    mediaController?.abort();
    activeImageId.value = undefined;
    imagePanelOpen.value = false;
    activeFieldId.value = undefined;
    fieldPanelOpen.value = false;
    trackSession();
    pastSelections.length = 0;
    futureSelections.length = 0;
    clearTextInput();
    queuedSelection = null;
    formatState.value = documentTextStyle(session.document);
    codeState.value = false;
    menuAt.value = null;
    interactionError.value = '';
    documentSelection.value = null;
    selectingCells.value = false;
    selectionController.anchor = undefined;
    selectionController.region = undefined;
    storedMarks.value = undefined;
    storedPosition = undefined;
    inputMarks = undefined;
    applyingInput.value = false;
    caret.value = null;
    selection.value = [];
    touchHandles.value = [];
    touchSelection.value = false;
    await render();
}

async function replaceContent(content: unknown, notify = true, focusView = true): Promise<NativeDocument> {
    if (props.readonly || !kernel.value || !sceneCurrent.value || applyingInput.value || mediaBusy.value)
        throw new Error('The document cannot be replaced during another edit');
    const base = session.document;
    const document = Object.freeze({ ...importDocument(content, base.id), revision: base.revision + 1 });
    await kernel.value.prepare(document);
    const hydrated = hydratedScene(document, kernel.value);
    const prepared = hydrated.scene;
    if (session.document !== base) throw new Error('The document changed before replacement');
    activeFieldId.value = undefined;
    activeImageId.value = undefined;
    documentSelection.value = null;
    selection.value = [];
    caret.value = null;
    menuAt.value = null;
    if (!(await commit(hydrated.document))) throw new Error(labels.value.editRejected);
    scene.value = prepared;
    if (notify) emit('change', session.document);
    const line = prepared.pages.flatMap((page) => page.lines)[0];
    if (focusView && line) await placeCaret({ blockId: line.paragraphId, offset: 0 }, prepared);
    else {
        clearTextInput();
    }
    return session.document;
}

async function applyShared(document: NativeDocument, selected: NativeSelection | null): Promise<void> {
    if (!kernel.value || !sharedApplying.value) throw new Error('The editor is not locked for synchronization');
    const next = Object.freeze({ ...document, id: session.document.id, revision: session.document.revision + 1 });
    await kernel.value.prepare(next);
    if (disposed) throw new Error('The editor was closed during synchronization');
    const hydrated = hydratedScene(next, kernel.value);
    const prepared = hydrated.scene;
    session.reset(hydrated.document);
    trackSession();
    pastSelections.length = 0;
    futureSelections.length = 0;
    scene.value = prepared;
    const field = activeFieldId.value
        ? nativeFields(session.document).find((field) => field.id === activeFieldId.value)
        : undefined;
    const image = activeImageId.value
        ? nativeImages(session.document).find((image) => image.id === activeImageId.value)
        : undefined;
    if (activeFieldId.value && !nativeFields(session.document).some((field) => field.id === activeFieldId.value))
        activeFieldId.value = undefined;
    if (activeImageId.value && !nativeImages(session.document).some((image) => image.id === activeImageId.value))
        activeImageId.value = undefined;
    await nextTick();
    if (
        selected &&
        findNode(session.document, selected.anchor.blockId) &&
        findNode(session.document, selected.focus.blockId)
    ) {
        const cells = selected.cells && tableRectangle(session.document, selected.cells) ? selected.cells : undefined;
        const scope = selected.scopeId && findNode(session.document, selected.scopeId) ? selected.scopeId : undefined;
        setSelection(selected.anchor, selected.focus, scope, cells, sharedWasFocused);
        if (field?.blockId)
            setSelection(
                { blockId: field.blockId, offset: field.offset! },
                { blockId: field.blockId, offset: field.offset! + 1 },
                undefined,
                undefined,
                sharedWasFocused,
            );
        else if (image?.blockId)
            setSelection(
                { blockId: image.blockId, offset: image.offset! },
                { blockId: image.blockId, offset: image.offset! + 1 },
                undefined,
                undefined,
                sharedWasFocused,
            );
        activeFieldId.value = field?.id;
        activeImageId.value = image?.id;
        refreshFormatting();
        updateCaret();
    } else if (!activeFieldId.value && !activeImageId.value) {
        clearTextInput();
        caret.value = null;
        selection.value = [];
        documentSelection.value = null;
    }
}

async function editReview(document: NativeDocument, selected: NativeSelection | null): Promise<NativeDocument> {
    if (!kernel.value || !sharedApplying.value || props.readonly || !props.reviewPolicy)
        throw new Error('Review editing is unavailable');
    const before = session.document,
        next = Object.freeze({ ...document, id: before.id, revision: before.revision + 1 });
    await kernel.value.prepare(next);
    if (disposed || before !== session.document) throw new Error('The document changed during editing');
    const prepared = hydratedScene(next, kernel.value);
    if (!(await commit(next))) throw new Error(labels.value.editRejected);
    scene.value = prepared.scene;
    const block = selected && findNode(next, selected.focus.blockId);
    if (block && isTextBlock(block))
        await placeCaret(
            { blockId: block.id, offset: Math.min(selected!.focus.offset, blockText(block).length) },
            prepared.scene,
        );
    else {
        clearTextInput();
        documentSelection.value = null;
        caret.value = null;
        selection.value = [];
    }
    return session.document;
}

async function rebaseReview(
    transform: (document: NativeDocument) => NativeDocument,
    selected: NativeSelection | null,
): Promise<NativeDocument> {
    if (!kernel.value || !sharedApplying.value) throw new Error('The editor is not locked for synchronization');
    const before = session.document,
        candidate = Object.freeze({ ...transform(before), id: before.id, revision: before.revision + 1 });
    await kernel.value.prepare(candidate);
    if (disposed || before !== session.document) throw new Error('The document changed during synchronization');
    const prepared = hydratedScene(candidate, kernel.value);
    const kept = session.rebase((document) => (document.root === before.root ? candidate : transform(document)));
    const past = kept.past.map((index) => pastSelections[index]),
        future = kept.future.map((index) => futureSelections[index]);
    pastSelections.splice(0, pastSelections.length, ...past);
    futureSelections.splice(0, futureSelections.length, ...future);
    trackSession();
    scene.value = prepared.scene;
    const clamp = (position: NativeSelection['anchor']) => {
        const block = findNode(session.document, position.blockId);
        if (!block || !isTextBlock(block)) return null;
        const text = blockText(block),
            maximum = Math.min(position.offset, text.length);
        const boundaries = [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)].map(
            (part) => part.index,
        );
        return {
            blockId: block.id,
            offset: maximum === text.length ? maximum : (boundaries.findLast((at) => at <= maximum) ?? 0),
        };
    };
    const anchor = selected && clamp(selected.anchor),
        focus = selected && clamp(selected.focus);
    await nextTick();
    if (anchor && focus) {
        setSelection(anchor, focus, undefined, undefined, sharedWasFocused);
        updateCaret();
    } else {
        clearTextInput();
        documentSelection.value = null;
        caret.value = null;
        selection.value = [];
    }
    return session.document;
}

async function focusHistoryNode(id: string): Promise<void> {
    const line = scene.value?.pages
        .flatMap((page) => page.lines)
        .find(
            (line) =>
                line.paragraphId === id || nodePath(session.document, line.paragraphId).some((node) => node.id === id),
        );
    if (line) await placeCaret({ blockId: line.paragraphId, offset: 0 });
    else {
        const index = scene.value?.pages.findIndex((page) =>
            page.commands.some(
                (command) => (command.kind === 'field' || command.kind === 'image') && command.nodeId === id,
            ),
        );
        if (index !== undefined && index >= 0)
            pagesElement.value?.querySelector(`[data-page="${index + 1}"]`)?.scrollIntoView({ block: 'center' });
    }
}

async function preparePdf(): Promise<void> {
    await inputQueue.idle();
    if (!(await flushFieldDetails())) throw new Error('Save the field changes before exporting');
    if (!sceneCurrent.value) await render();
    await props.beforePdf?.();
}
async function pdfBytes(signal?: AbortSignal): Promise<Uint8Array> {
    const snapshot = session.document;
    let bytes: Uint8Array;
    try {
        bytes = props.fetchPdf ? new Uint8Array(await (await props.fetchPdf(snapshot)).arrayBuffer()) : await pdf();
    } catch (failure) {
        if (session.document !== snapshot) throw new Error(labels.value.exportChanged);
        throw failure;
    }
    signal?.throwIfAborted();
    if (session.document !== snapshot) throw new Error(labels.value.exportChanged);
    return bytes;
}
async function download(): Promise<void> {
    pdfBusy.value = true;
    interactionError.value = '';
    try {
        await preparePdf();
        const blob = new Blob([new Uint8Array(await pdfBytes())], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${props.title ?? labels.value.document}.pdf`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
        if (failure instanceof Error && failure.message === labels.value.exportChanged) {
            interactionError.value = labels.value.exportChanged;
            return;
        }
        interactionError.value = labels.value.exportFailed;
        emit('error', failure);
    } finally {
        pdfBusy.value = false;
    }
}

watch(
    () => props.content,
    (content, previous) => {
        if (content !== previous)
            void setContent(content).catch((failure) => {
                if (scene.value) {
                    interactionError.value = labels.value.editRejected;
                    return;
                }
                error.value = String(failure);
                emit('error', failure);
            });
    },
);
watch(responsiveWidth, () => {
    if (kernel.value) void render().then(updateCaret);
});
const editingOverlayFrame = computed<EditingOverlayFrame>(() => ({
    input: {
        label: labels.value.input,
        readonly: !!props.readonly || mediaBusy.value,
        direction: toolbarDirection.value,
        position: caret.value,
        command: slashTrigger.value
            ? { listId: commandPaletteId, activeId: commandPalette.value?.activeId }
            : undefined,
    },
    selection: error.value ? [] : selection.value,
    cells: !!documentSelection.value?.cells,
    find: error.value ? [] : find.boxes,
    peers: peerBoxes.value,
    reviews: reviewBoxes.value,
    templates: templateBoxes.value,
    handles: error.value ? [] : touchHandles.value,
    handleLabels: { start: labels.value.selectionStart, end: labels.value.selectionEnd },
    caret:
        inputFocused.value && !error.value && !props.readonly && !selectedField.value && !selectedImage.value
            ? caret.value
            : undefined,
    drop: blockDrag.value?.target
        ? {
              blockId: blockDrag.value.target,
              side: blockDrag.value.side!,
              left: blockDrag.value.left!,
              top: blockDrag.value.top!,
              width: blockDrag.value.width!,
          }
        : undefined,
}));
watch(editingOverlayFrame, (frame) => editingOverlay?.update(frame), { flush: 'post' });
const editorApi = {
    renderingKernel: () => kernel.value,
    print: requestPrint,
    ready,
    canInsertFields,
    insertPaletteField,
    variables: variablesForUi,
    onFieldAdded,
    revealField,
    fieldElement: (id: string) =>
        editorRoot.value?.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(id)}"]`) ?? undefined,
    selectedFieldId: activeFieldId,
    selectField: (id: string) => selectField(id, false),
    updateFieldDetails,
    flushFieldDetails,
    fieldEditsPending,
    fieldEditError,
    editFieldDetails: openField,
    removeField: async (id: string) => {
        if (!nativeFields(session.document).some((field) => field.id === id)) return;
        selectField(id);
        await deleteField();
    },
    copyField,
    focus: () => input.value?.focus({ preventScroll: true }),
    canSave: () =>
        !!kernel.value &&
        sceneCurrent.value &&
        !applyingInput.value &&
        !validatingEdits.value &&
        !queuedInputs.value &&
        !clipboardBusy.value &&
        !mediaBusy.value &&
        !fieldEditsPending.value,
    pendingEdits: computed(
        () =>
            pendingTextInputs.value > 0 ||
            validatingEdits.value > 0 ||
            applyingInput.value ||
            clipboardBusy.value ||
            mediaBusy.value ||
            fieldEditsPending.value,
    ),
    report,
    pdf,
    download,
    exporting: pdfBusy,
    document: () => session.document,
    getJSON: () =>
        exportDocument(persistClauseVariants(persistNativeIdentities(persistClauseNumbers(session.document)))),
    scene: () => scene.value,
    manifest: async () => (await import('../../pdf/index.js')).sceneManifest(scene.value!),
    undo: () => history('undo'),
    redo: () => history('redo'),
    setContent,
    replaceContent,
    focusHistoryNode,
    setViewZoom: changeZoom,
    refreshView: () => {
        measureView();
        scheduleCaretUpdate();
    },
    lockShared,
    unlockShared,
    applyShared,
    rebaseReview,
    editReview,
    openReviewField: () => openField(),
    prepareReview: async (document: NativeDocument) => {
        if (!kernel.value) throw new Error('The editor is not ready');
        await kernel.value.prepare(document);
        return hydratedScene(document, kernel.value).document;
    },
    prepareShared: async (document: NativeDocument) => {
        if (!kernel.value) throw new Error('The editor is not ready');
        await kernel.value.prepare(document);
    },
    undoLocal: () => history('undo', true),
    analysisSelection: () => {
        const selection = nativeSelection();
        if (!selection) return null;
        return { selection, text: selectedText(session.document, selection) };
    },
    sharedSelection: () =>
        applyingInput.value || sharedApplying.value || document.activeElement !== input.value
            ? null
            : nativeSelection(),
    forSave,
    focusReview: (selected: NativeSelection) => {
        if (!findNode(session.document, selected.anchor.blockId) || !findNode(session.document, selected.focus.blockId))
            return;
        setSelection(selected.anchor, selected.focus);
        updateCaret();
        revealSelection(selected);
    },
    selection: nativeSelection,
    selectAll,
    canUndo,
    canRedo,
    format: applyFormat,
    blockFormat: applyBlockFormat,
    list: applyList,
    insertTable: createTable,
};
defineExpose(editorApi);
onBeforeUnmount(() => {
    editingOverlay?.dispose();
    pdfController.abort();
    void pdfSource.value?.destroy().catch(() => {});
    printShortcut?.dispose();
    printer?.dispose();
    inputQueue.reset();
    readiness.dispose();
    resetTranslations();
    window.removeEventListener('pointerup', sharedPointerEnd);
    window.removeEventListener('pointercancel', sharedPointerEnd);
    window.removeEventListener('blur', sharedPointerEnd);
    viewObserver?.disconnect();
    cancelBlockDrag();
    window.removeEventListener('resize', measureView);
    window.removeEventListener('scroll', updateOutlinePosition, true);
    mediaController?.abort();
    disposed = true;
    clauseController?.abort();
    if (caretFrame !== undefined) cancelAnimationFrame(caretFrame);
    stopSelectionScroll();
    window.removeEventListener('pointerup', stopSelectionScroll);
    window.removeEventListener('pointercancel', stopSelectionScroll);
    window.removeEventListener('blur', stopSelectionScroll);
    window.removeEventListener('pointerdown', outsideMenu);
    window.removeEventListener('scroll', scheduleCaretUpdate, true);
    window.removeEventListener('resize', scheduleCaretUpdate);
    layoutController.dispose();
    if (releaseKernel) releaseKernel();
    else kernel.value?.destroy();
});
</script>

<template>
    <div
        ref="editorRoot"
        class="midad-editor"
        :data-ready-ms="readyMs"
        :data-layout-ms="shapeMs"
        :data-scene-revision="scene?.revision"
        @pointerdown.capture="sharedPointerStart"
        @pointerup.capture="sharedPointerEnd"
        @pointercancel.capture="sharedPointerEnd"
        :class="{ 'is-embedded': embedded, 'has-outline': outlineOpen }"
        :aria-busy="!error && (!sceneCurrent || clipboardBusy || mediaBusy || !!validatingEdits || !!queuedInputs)"
        :dir="locale === 'en' ? 'ltr' : 'rtl'"
        @dragover="dragFile"
        @drop="dropFile"
    >
        <slot
            name="before"
            :editor="editorApi"
        />
        <div
            v-if="!embedded && (reviewPolicy || (readonly && !workbench))"
            class="native-controls"
        >
            <slot name="toolbar" />
            <button
                v-if="!readonly"
                :disabled="!canUndo"
                type="button"
                @click="history('undo')"
            >
                {{ labels.undo }}
            </button>
            <button
                v-if="!readonly"
                :disabled="!canRedo"
                type="button"
                @click="history('redo')"
            >
                {{ labels.redo }}
            </button>
            <button
                v-if="!hideExport"
                :disabled="!sceneCurrent || pdfBusy || clipboardBusy"
                type="button"
                @click="download"
            >
                {{ pdfBusy ? labels.exporting : labels.exportPdf }}
            </button>
            <button
                v-if="!hideExport"
                type="button"
                :disabled="!sceneCurrent || printBusy || pdfBusy"
                @click="requestPrint"
            >
                {{ printBusy ? labels.printingPdf : labels.printPdf }}
            </button>
            <button
                v-if="!readonly && !reviewPolicy"
                type="button"
                :disabled="!sceneCurrent || mediaBusy || pageSetupBusy"
                @click="
                    pageSetupError = '';
                    pageSetupOpen = true;
                "
            >
                {{ labels.pageSetup }}
            </button>
            <button
                v-if="!readonly && !reviewPolicy"
                type="button"
                :disabled="!sceneCurrent || mediaBusy || bilingualBusy"
                @click="openBilingual"
            >
                {{ labels.bilingual }}
            </button>
            <button
                type="button"
                :disabled="!sceneCurrent || mediaBusy || clauseBusy"
                @click="openClauses"
            >
                {{ labels.clauses }}
            </button>
            <PagesPanelToggle
                data-outline-trigger
                :open="outlineOpen"
                :trigger="{ mode: 'text', count: outlineCount }"
                :disabled="!scene"
                @toggle="toggleOutline"
            />
            <span role="status">{{
                scene
                    ? sceneCurrent
                        ? `${scene.pages.length} ${scene.pages.length === 1 ? labels.page : labels.pages}`
                        : labels.updating
                    : labels.loading
            }}</span>
            <button
                type="button"
                :aria-label="labels.zoomOut"
                :disabled="!sceneCurrent || viewZoomFactor <= VIEW_ZOOM_MIN"
                @click="zoomBy(-1)"
            >
                −
            </button>
            <label class="native-zoom-control"
                >{{ labels.zoom
                }}<select
                    :value="zoomMode"
                    :aria-label="labels.zoom"
                    :disabled="!sceneCurrent"
                    @change="changeZoom(($event.target as HTMLSelectElement).value)"
                >
                    <option value="auto">{{ labels.zoomAuto }} ({{ Math.round(automaticZoom * 100) }}%)</option>
                    <option value="width">{{ labels.zoomWidth }}</option>
                    <option value="page">{{ labels.zoomPage }}</option>
                    <option
                        v-for="percent in zoomSteps"
                        :key="percent"
                        :value="String(percent)"
                    >
                        {{ percent }}%
                    </option>
                    <option
                        v-if="!['auto', 'width', 'page'].includes(zoomMode) && !zoomSteps.includes(Number(zoomMode))"
                        :value="zoomMode"
                    >
                        {{ zoomMode }}%
                    </option>
                </select></label
            >
            <button
                type="button"
                :aria-label="labels.zoomIn"
                :disabled="!sceneCurrent || viewZoomFactor >= VIEW_ZOOM_MAX"
                @click="zoomBy(1)"
            >
                +
            </button>
            <span
                v-if="mediaBusy && !imagePanelOpen && !fieldPanelOpen"
                role="status"
                >{{ labels.uploadingMedia }}</span
            >
        </div>
        <NativePageSetup
            v-if="pageSetupOpen && !readonly"
            :layout="pageLayout"
            :presentation="presentation"
            :show-presentation-controls="presentationControls !== false"
            :resolve-media="resolveMedia"
            :labels="labels"
            :busy="pageSetupBusy"
            :error="pageSetupError"
            @apply="
                (layout: PageLayout, presentation: NativePresentation) => applyPageSetup(layout, presentation, true)
            "
            @close="pageSetupOpen = false"
            @return-focus="toolbar?.focusPageControls?.()"
        />
        <NativeBilingualPanel
            v-if="bilingualOpen && !readonly"
            :initial="bilingualInitial"
            :initial-stage="commands.pending.value?.kind === 'bilingual' ? 'settings' : undefined"
            :can-translate="!!bilingualTranslator"
            :translation-status="translationStatus"
            :translation-message="translationMessage"
            @retry="retryTranslations"
            @preview="bilingualPreviewScope = $event"
            @popup="bilingualPopupId = $event"
            :anchor="bilingualAnchor"
            :revision="documentRevision"
            :direction="session.document.root.attributes?.dir === 'ltr' ? 'ltr' : 'rtl'"
            :split="bilingualSplit"
            :state="
                (kind: BilingualScope['kind']) =>
                    bilingualScopeState(bilingualCommandPreview().document, bilingualScope(kind))
            "
            :has-selection="bilingualHasSelection"
            :labels="labels"
            :locale="locale ?? 'ar'"
            :languages="bilingualLanguages ?? ['ar', 'en', 'ur', 'hi', 'bn', 'ml', 'fil', 'id', 'ne', 'am']"
            :busy="bilingualBusy"
            :error="bilingualError"
            :selected="!!nativeSelection()"
            :drop="bilingualDrop"
            @apply="applyBilingual"
            @close="closeBilingual"
        />
        <NativeClausePanel
            v-if="clausePanelOpen && !embedded"
            :document="editorDocument"
            :initial-id="clauseInitialId"
            :initial-tab="clauseInitialTab"
            :labels="labels"
            :locale="locale ?? 'ar'"
            :readonly="!!readonly || !!reviewPolicy"
            :busy="clauseBusy"
            :error="clauseError"
            :resolve-media="resolveMedia"
            :load-library="loadClauseLibrary"
            @close="closeClauses"
            @insert="insertClause"
            @edit="editClause"
            @properties="clauseProperties"
            @variant="clauseVariant"
            @remove="removeClause"
        />
        <NativeOutlinePanel
            v-if="outlineOpen"
            :groups="outlineGroups"
            :initialized="!!scene"
            :busy="!error && !paintFailures.size && !sceneCurrent"
            :has-cover="!!scene?.coverPages"
            :mobile="outlineMobile"
            :top="outlineTop"
            :activate="outlineActivate"
            @close="closeOutline"
            @heading="jumpOutline"
            @cover="jumpOutline()"
        />
        <slot
            name="editor-toolbar"
            :editor="editorApi"
        >
            <NativeToolbar
                :hide-objects="textOnly"
                :insert="insertion"
                :fixed-pages="!!loadPdf"
                :can-insert-objects="!!pdfSource && !readonly && sceneCurrent && !mediaBusy"
                v-if="chrome.NativeToolbar && (!readonly || workbench) && !reviewPolicy"
                ref="toolbar"
                :labels="labels"
                :active="
                    !readonly && sceneCurrent && (!!activeBlock || !!selectedField || !!vacantPosition()) && !mediaBusy
                "
                :embedded="embedded"
                :ready="!readonly && sceneCurrent && !mediaBusy"
                :can-undo="!readonly && canUndo"
                :can-redo="!readonly && canRedo"
                :hide-export="hideExport"
                :exporting="pdfBusy || clipboardBusy"
                :printing="printBusy"
                :page-setup-busy="pageSetupBusy || mediaBusy"
                :bilingual-busy="bilingualBusy || mediaBusy"
                :bilingual-working="translationStatus.pending > 0"
                :bilingual-failed="translationStatus.failed > 0 || translationStatus.tooLong > 0"
                :bilingual-message="translationMessage"
                :bilingual-open="bilingualOpen"
                :bilingual-split="bilingualSplit"
                :bilingual-popup-id="bilingualPopupId"
                :clauses-busy="clauseBusy"
                :page-count="scene?.pages.length"
                :outline-open="outlineOpen"
                :outline-count="outlineCount"
                :outline-ready="!!scene"
                :find-open="find.opened"
                :find-ready="readyMs !== null && !!scene && !error && !mediaBusy"
                @find="find.open"
                @outline="toggleOutline"
                :zoom-mode="zoomMode"
                :automatic-zoom="automaticZoom"
                :zoom-out-disabled="viewZoomFactor <= VIEW_ZOOM_MIN"
                :zoom-in-disabled="viewZoomFactor >= VIEW_ZOOM_MAX"
                :text-style="formatState"
                :block="toolbarBlock"
                :direction="toolbarDirection"
                :code="codeState"
                :list-kind="toolbarList"
                :in-table="toolbarTable"
                :table-locked="activeTableLocked"
                :selecting-cells="selectingCells"
                :can-merge="(selectedCells?.cells.length ?? 0) > 1"
                :can-split="canSplitCell"
                :has-field="!!selectedField"
                :field-align="toolbarFieldAlign"
                :has-image="!!selectedImage"
                :can-upload-image="!!uploadImage"
                @format="applyFormat"
                @block="applyBlockFormat"
                @focus="input?.focus({ preventScroll: true })"
                @list="applyList"
                @indent="indentSelection"
                @table="applyTable"
                @insert-table="createTable"
                @cells="toggleCellSelection"
                @merge="mergeCells"
                @split="splitCell"
                @insert-field="openField()"
                @edit-field="openField(activeFieldId)"
                @insert-image="openImage()"
                @edit-image="openImage(activeImageId)"
                @undo="history('undo')"
                @redo="history('redo')"
                @export="download"
                @print="requestPrint"
                @page-setup="
                    pageSetupError = '';
                    pageSetupOpen = true;
                "
                @bilingual="openBilingual"
                @clauses="openClauses"
                @zoom="changeZoom"
                @zoom-step="zoomBy"
            />
        </slot>
        <NativeTableControls
            v-if="scene && !readonly && !reviewPolicy && !error"
            :document="editorDocument"
            :scene="scene"
            :host="editorRoot"
            :active-block-id="activeBlock"
            :selection="tableControlSelection"
            :scale="viewScale"
            :busy="!sceneCurrent || mediaBusy || applyingInput || queuedInputs > 0 || sharedApplying"
            :apply="applyTableControl"
            @select="selectTableMenuCells"
            @focus="focusTableControls"
            @dismiss="dismissTableControls"
            @table="controlledTableId = $event"
            @error="interactionError = labels.editRejected"
        />
        <NativeFindPanel
            v-if="find.opened"
            v-model:query="find.query"
            v-model:case-sensitive="find.caseSensitive"
            v-model:whole-word="find.wholeWord"
            :labels="labels"
            :index="find.index"
            :total="find.total"
            :top="find.top"
            :focus-token="find.focusToken"
            :busy="find.busy"
            @move="find.move"
            @close="find.close"
        />
        <slot
            v-if="error"
            name="error"
            :error="error"
            :retry="paintFailures.size ? retryPaint : undefined"
            ><div
                role="alert"
                class="native-fail"
            >
                <p>{{ labels.error }}</p>
                <button
                    v-if="paintFailures.size"
                    type="button"
                    @click="retryPaint"
                >
                    {{ labels.retry }}
                </button>
            </div></slot
        >
        <p
            v-if="interactionError"
            role="alert"
            class="native-fail"
        >
            {{ interactionError }}
        </p>
        <p
            v-if="printBusy"
            role="status"
            class="native-status"
        >
            {{ labels.printingPdf }}
        </p>
        <p
            v-if="printError"
            role="alert"
            class="native-fail"
        >
            {{ printError }}
            <button
                type="button"
                @click="requestPrint"
            >
                {{ labels.retry }}
            </button>
        </p>
        <div
            v-if="!scene && !error"
            class="native-skeleton"
            aria-busy="true"
        >
            <span
                v-for="index in 8"
                :key="index"
            />
        </div>
        <div
            v-if="scene && kernel"
            ref="pagesElement"
            class="native-pages"
            :class="{ 'has-block-handles': !readonly }"
            @contextmenu="contextMenu"
        >
            <p
                v-for="replacement in fontReplacements.slice(0, 3)"
                :key="replacement.requested"
                role="status"
                data-native-font-replacement
                class="dark:border-border dark:bg-primary/10 dark:text-foreground max-w-full rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900"
            >
                {{
                    labels.fontReplacement
                        .replace(':requested', replacement.requested)
                        .replace(':actual', replacement.actual)
                }}
            </p>
            <p
                v-if="fontReplacements.length > 3"
                role="status"
                class="text-muted-foreground max-w-full text-xs"
            >
                {{ labels.fontReplacementMore.replace(':count', String(fontReplacements.length - 3)) }}
            </p>
            <NativePage
                v-for="(page, index) in scene.pages"
                :key="index"
                :page="page"
                :kernel="kernel"
                :index="index"
                :revision="scene.revision"
                :transparent="!!pdfSource && index >= (scene.coverPages ?? 0)"
                :background-ready="!pdfSource || index < (scene.coverPages ?? 0) || pdfPainted.has(index)"
                :background-failed="pdfFailures.has(index)"
                :scale="viewScale"
                :page-label="labels.page"
                :selecting-cells="selectingCells"
                :active-table-id="readonly || tableHandlesLocked ? undefined : tableHandlesId"
                :table-row-heights="tableRowHeights"
                :labels="labels"
                :participants="participants"
                :value-entry="!!externalFieldDetails && !reviewPolicy"
                :active-field-id="activeFieldId"
                :floating-field-ids="floatingFieldIds"
                :active-image-id="activeImageId"
                :floating-image-ids="floatingImageIds"
                :readonly="readonly"
                :show-field-placeholders="showFieldPlaceholders"
                :reviewing="!!reviewPolicy"
                :review-fields="!!reviewPolicy?.fields"
                :busy="mediaBusy || !sceneCurrent"
                :dragging-block-id="blockDrag?.id"
                :gutter-contexts="gutterContexts"
                :active-block-id="gutterActive?.page === index ? gutterActive.id : undefined"
                :locked-block-id="blockDrag?.id ?? blockMenuId ?? gutterMenuId"
                :block-direction="session.document.root.attributes?.dir === 'ltr' ? 'ltr' : 'rtl'"
                :history-highlights="historyHighlightNodes"
                :bilingual-preview="bilingualPreviewIds"
                @painted="painted"
                @state="(index: number, state: PageViewState) => readiness.update(index, state)"
                @failed="pageFailed"
                @point="selectPoint"
                @finish="stopSelectionScroll"
                @resize="resizeColumns"
                @resize-row="resizeRow"
                @field="selectField"
                @value-field="
                    (id: string, anchor: HTMLElement) => {
                        if (externalFieldDetails && !readonly && !reviewPolicy) emit('fieldValue', id, anchor);
                    }
                "
                @edit-field="openField"
                @position-field="positionField"
                @field-shortcut="key"
                @image="selectImage"
                @edit-image="openImage"
                @position-image="positionImage"
                @block-menu="openBlockMenu"
                @block-insert="openAddMenu"
                @block-drag="dragBlock"
                @block-drop="dropBlock"
                @block-cancel="cancelBlockDrag"
            >
                <template #background>
                    <div
                        v-if="pdfSource && index >= (scene.coverPages ?? 0)"
                        class="pointer-events-none absolute inset-0"
                        data-native-pdf-background
                    >
                        <NativePdfPage
                            :key="pdfRetries.get(index) ?? 0"
                            :source="pdfSource"
                            :page="pdfSource.pages[index - (scene.coverPages ?? 0)]"
                            :zoom="viewScale / POINT_TO_PIXEL"
                            :label="labels.page"
                            :retry="labels.retry"
                            :failure="labels.exportFailed"
                            @painted="
                                pdfPainted.add(index);
                                pdfFailures.delete(index);
                                painted(index);
                            "
                            @error="
                                (error: unknown) => {
                                    pdfPainted.delete(index);
                                    pdfFailures.add(index);
                                    pageFailed(index, error);
                                }
                            "
                        />
                    </div>
                </template>
            </NativePage>
        </div>
        <NativeImagePanel
            v-if="imagePanelOpen && !readonly"
            :image="selectedImage"
            :labels="labels"
            :resolve-media="resolveMedia"
            :page="imagePage"
            :page-count="scene?.pages.length ?? 1"
            :maximum-width="imageLimits.width"
            :maximum-height="imageLimits.height"
            :busy="mediaBusy"
            :floating-only="!!pdfSource"
            :error="imagePanelError"
            @save="saveImage"
            @remove="deleteImage"
            @close="closeImage"
        />
        <NativeFieldPanel
            v-if="fieldPanelOpen && !readonly"
            :labels="labels"
            :field="selectedField"
            :floating-only="!!pdfSource"
            :reviewing="!!reviewPolicy"
            :participants="participants ?? []"
            :direction="toolbarDirection"
            :error="fieldPanelError"
            :page="fieldPanelPage"
            :page-count="scene?.pages.length ?? 1"
            :busy="mediaBusy"
            :can-upload-attachment="!!uploadAttachment"
            :resolve-media="resolveMedia"
            @save="saveField"
            @remove="deleteField"
            @close="closeField"
        />
        <div
            ref="editingOverlayHost"
            class="contents"
        />
        <NativeCommandPopup
            v-if="chrome.NativeCommandPopup && slashTrigger && caret"
            ref="commandPalette"
            :id="commandPaletteId"
            :groups="commandGroups"
            :query="slashTrigger.query"
            :direction="locale === 'ar' ? 'rtl' : 'ltr'"
            :label="labels.commandMenu"
            :no-results="labels.noCommands"
            :anchor="caret"
            :host="editorRoot"
            @select="runSlashItem"
            @dismiss="commands.dismiss"
        />
        <NativeCommandContextMenu
            v-if="chrome.NativeCommandContextMenu && menuAt && !readonly && !reviewPolicy"
            ref="contextMenuView"
            :id="`${commandPaletteId}-context`"
            :groups="contextCommandGroups"
            :insert-only="menuMode === 'add'"
            :left="menuAt.left"
            :top="menuAt.top"
            :direction="locale === 'ar' ? 'rtl' : 'ltr'"
            :labels="labels"
            :selected="
                !!selectedField?.floating ||
                (!!nativeSelection() && !!selectedText(session.document, nativeSelection()!))
            "
            :busy="clipboardBusy"
            :block="
                menuMode === 'add'
                    ? undefined
                    : blockMenuId
                      ? selectedBlock
                      : selectedField || selectedImage
                        ? undefined
                        : selectedBlock
            "
            :block-only="!!blockMenuId"
            :href="formatState.href"
            :host="editorRoot"
            @select="contextMenuItem"
            @action="clipboardAction"
            @block="blockAction"
            @link="commandLinkAction"
            @shortcut="key"
            @close="menuAt && closeMenu($event)"
        />
        <NativeSelectionMenu
            v-else-if="chrome.NativeSelectionMenu && menuPosition"
            ref="selectionMenu"
            :labels="labels"
            :left="menuPosition.left"
            :top="menuPosition.top"
            :readonly="!!readonly"
            :selected="
                !!selectedField?.floating ||
                (!!nativeSelection() && !!selectedText(session.document, nativeSelection()!))
            "
            :busy="clipboardBusy"
            :block="reviewPolicy ? undefined : selectedBlock"
            :block-only="!!blockMenuId"
            :horizontal="touchSelection && !menuAt"
            @action="clipboardAction"
            @block="blockAction"
            @close="closeMenu"
            @shortcut="key"
            @size="measureMenu"
        />
    </div>
</template>
