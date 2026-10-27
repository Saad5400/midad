<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import type { MediaResolver } from '@saad5400/midad/assets';
import { importClmDocument } from '@saad5400/midad/document';
import {
    compareHistory,
    type HistoryChange,
    type HistoryPage,
    type HistorySnapshot,
    type HistoryVersion,
} from '@saad5400/midad/history';
import type { NativeTextKernel } from '@saad5400/midad/kernel';
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import NativeHistoryVersionList from './NativeHistoryVersionList.vue';
import { nativeHistoryLabels } from './history-labels.js';

const ui = useEditorUi();
const Button = useUiComponent('Button');
const Dialog = useUiComponent('Dialog');
const DialogHeader = useUiComponent('DialogHeader');
const DialogScrollContent = useUiComponent('DialogScrollContent');
const DialogTitle = useUiComponent('DialogTitle');
const Select = useUiComponent('Select');
const SelectContent = useUiComponent('SelectContent');
const SelectItem2 = useUiComponent('SelectItem2');
const SelectTrigger2 = useUiComponent('SelectTrigger2');
const RestoreVersionDialog = useUiComponent('RestoreVersionDialog');

const NativeEditor = useUiComponent('DocumentPreviewEditor');
const props = defineProps<{
    locale: 'ar' | 'en';
    resolveMedia?: MediaResolver;
    sharedKernel?: NativeTextKernel;
    load: (page: number) => Promise<HistoryPage>;
    snapshot: (number: number) => Promise<HistorySnapshot>;
    restore: (snapshot: HistorySnapshot) => Promise<void>;
    canRestore: boolean;
    refreshKey?: number;
    initialVersion?: number;
    initialComparison?: number;
}>();
const emit = defineEmits<{ close: [] }>();
const labels = computed(() => nativeHistoryLabels[props.locale]);
const opener = document.activeElement as HTMLElement | null;
const versions = shallowRef<readonly HistoryVersion[]>([]),
    head = ref<number | null>(null),
    nextPage = ref<number | null>(null);
const loading = ref(false),
    loadingMore = ref(false),
    loadingSnapshot = ref(false),
    restoring = ref(false);
const loadError = ref(false),
    previewError = ref(false),
    restoreError = ref(false),
    confirmOpen = ref(false);
const selected = ref<number>(),
    comparing = ref<number | ''>('');
const automaticComparison = ref(true);
const before = shallowRef<HistorySnapshot>(),
    after = shallowRef<HistorySnapshot>();
const beforeEditor = ref<import('../index.js').DocumentEditorApi>();
const previewLayout = ref('both'),
    previewZoom = ref('auto');
const afterEditor = ref<import('../index.js').DocumentEditorApi>();
let mounted = true,
    request = 0;
let failedPage = 1;
const comparison = computed<{ changes: readonly HistoryChange[]; error: boolean }>(() => {
    if (!before.value || !after.value) return { changes: [], error: false };
    try {
        return {
            changes: compareHistory(
                importClmDocument(before.value.content, 'history'),
                importClmDocument(after.value.content, 'history'),
            ),
            error: false,
        };
    } catch {
        return { changes: [], error: true };
    }
});
const beforeHighlights = computed(() =>
    comparison.value.changes.flatMap((change) => (change.before ? [{ id: change.before.id, kind: change.kind }] : [])),
);
const afterHighlights = computed(() =>
    comparison.value.changes.flatMap((change) => (change.after ? [{ id: change.after.id, kind: change.kind }] : [])),
);
async function fetchVersions(page = 1): Promise<void> {
    if (loading.value || loadingMore.value) return;
    if (page === 1) loading.value = true;
    else loadingMore.value = true;
    loadError.value = false;
    try {
        const result = await props.load(page);
        if (!mounted) return;
        const merged = [...result.data, ...versions.value];
        versions.value = merged
            .filter((version, index) => merged.findIndex((other) => other.number === version.number) === index)
            .sort((a, b) => b.number - a.number);
        head.value = result.head_number;
        nextPage.value = result.next_page;
        if (page === 1 && versions.value.length && !selected.value) {
            if (props.initialVersion) {
                selected.value = props.initialVersion;
                const index = versions.value.findIndex((item) => item.number === props.initialVersion);
                comparing.value =
                    props.initialComparison ?? (index >= 0 ? versions.value[index + 1]?.number : undefined) ?? '';
                await fetchComparison();
            } else await select(versions.value[0]);
        }
    } catch {
        if (mounted) {
            failedPage = page;
            loadError.value = true;
        }
    } finally {
        if (mounted) {
            loading.value = false;
            loadingMore.value = false;
        }
    }
}
async function select(version: HistoryVersion): Promise<void> {
    selected.value = version.number;
    automaticComparison.value = true;
    const index = versions.value.findIndex((item) => item.number === version.number);
    comparing.value = versions.value[index + 1]?.number ?? '';
    await fetchComparison();
}
async function fetchComparison(): Promise<void> {
    if (!selected.value || restoring.value) return;
    const run = ++request;
    loadingSnapshot.value = true;
    previewError.value = false;
    restoreError.value = false;
    confirmOpen.value = false;
    before.value = undefined;
    after.value = undefined;
    try {
        const selectedVersion = await props.snapshot(selected.value);
        if (!mounted || run !== request) return;
        const previous = automaticComparison.value ? selectedVersion.previous_number : undefined;
        const comparisonNumber = previous === undefined ? comparing.value : (previous ?? '');
        const comparedVersion = comparisonNumber ? await props.snapshot(comparisonNumber) : undefined;
        if (!mounted || run !== request) return;
        importClmDocument(selectedVersion.content, 'history');
        if (comparedVersion) importClmDocument(comparedVersion.content, 'history');
        after.value = selectedVersion;
        before.value = comparedVersion;
        comparing.value = comparisonNumber;
        const metadata = [selectedVersion, ...(comparedVersion ? [comparedVersion] : [])].map((version) => ({
            number: version.number,
            created_at: version.created_at,
            user: version.user,
            message: version.message,
            restored_from_number: version.restored_from_number,
        }));
        const merged = [...versions.value, ...metadata];
        versions.value = merged
            .filter((version, index) => merged.findIndex((item) => item.number === version.number) === index)
            .sort((a, b) => b.number - a.number);
    } catch {
        if (mounted && run === request) previewError.value = true;
    } finally {
        if (mounted && run === request) loadingSnapshot.value = false;
    }
}
async function restoreVersion(): Promise<void> {
    if (!after.value || !props.canRestore || restoring.value) return;
    restoring.value = true;
    restoreError.value = false;
    try {
        await props.restore(after.value);
        if (mounted) emit('close');
    } catch {
        if (mounted) restoreError.value = true;
    } finally {
        if (mounted) restoring.value = false;
    }
}
function inspect(change: HistoryChange): void {
    if (change.before) void beforeEditor.value?.focusHistoryNode(change.before.id);
    if (change.after) void afterEditor.value?.focusHistoryNode(change.after.id);
}
function zoomPreview(): void {
    void beforeEditor.value?.setViewZoom(previewZoom.value);
    void afterEditor.value?.setViewZoom(previewZoom.value);
}
function unitLabel(kind?: string): string {
    const ar: Record<string, string> = {
        paragraph: 'فقرة',
        heading: 'عنوان',
        clauseTitle: 'عنوان بند',
        clause: 'بند',
        variable: 'حقل',
        image: 'صورة',
        table: 'جدول',
        tableCell: 'خلية جدول',
        tableHeader: 'عنوان جدول',
        parallelRow: 'أعمدة اللغات',
        doc: 'إعدادات المستند',
        bulletList: 'قائمة نقطية',
        orderedList: 'قائمة مرقمة',
        horizontalRule: 'فاصل',
        blockquote: 'اقتباس',
        codeBlock: 'فقرة برمجية',
    };
    const en: Record<string, string> = {
        paragraph: 'Paragraph',
        heading: 'Heading',
        clauseTitle: 'Clause title',
        clause: 'Clause',
        variable: 'Field',
        image: 'Image',
        table: 'Table',
        tableCell: 'Table cell',
        tableHeader: 'Table heading',
        parallelRow: 'Language columns',
        doc: 'Document settings',
        bulletList: 'Bulleted list',
        orderedList: 'Numbered list',
        horizontalRule: 'Divider',
        blockquote: 'Quote',
        codeBlock: 'Code paragraph',
    };
    return (props.locale === 'en' ? en : ar)[kind ?? ''] ?? labels.value.structure;
}
onMounted(() => {
    void fetchVersions();
});
watch(
    () => props.refreshKey,
    () => {
        if (!restoring.value) void fetchVersions();
    },
);
onBeforeUnmount(() => {
    mounted = false;
    request++;
});
</script>

<template>
    <Dialog
        :open="true"
        @update:open="
            (value: any) => {
                if (!value && !restoring) emit('close');
            }
        "
    >
        <DialogScrollContent
            class="my-3 w-[97vw] max-w-[1600px] gap-0 overflow-hidden rounded-xl sm:max-w-[1600px]"
            :aria-label="labels.history"
            :aria-describedby="undefined"
            @close-auto-focus.prevent="
                () => {
                    if (opener?.isConnected) opener.focus({ preventScroll: true });
                }
            "
        >
            <DialogHeader :close-disabled="restoring" class="sticky top-0 z-20">
                <DialogTitle>{{ labels.history }}</DialogTitle>
            </DialogHeader>
            <div
                class="midad-editor bg-card! max-h-[85dvh] overflow-auto p-4 md:p-6"
                :dir="locale === 'ar' ? 'rtl' : 'ltr'"
            >
                <p v-if="loadError" role="alert" class="text-destructive flex items-center gap-3">
                    {{ labels.loadError
                    }}<Button variant="outline" size="sm" @click="fetchVersions(failedPage)">{{ labels.retry }}</Button>
                </p>
                <div v-if="loading" class="native-skeleton" aria-busy="true">
                    <span v-for="index in 5" :key="index" />
                </div>
                <p v-if="!loading && !loadError && !versions.length">{{ labels.empty }}</p>
                <div v-if="versions.length" class="native-history-layout">
                    <nav :aria-label="labels.history">
                        <NativeHistoryVersionList
                            :versions="versions"
                            :selected="selected"
                            :busy="restoring"
                            :more="loadingMore"
                            :next-page="nextPage"
                            :locale="locale"
                            @select="select"
                            @load-more="
                                () => {
                                    if (nextPage) fetchVersions(nextPage);
                                }
                            "
                        />
                    </nav>
                    <section class="native-history-detail">
                        <div class="grid gap-2 text-sm">
                            <label>{{ labels.compare }}</label>
                            <Select
                                :model-value="comparing ? String(comparing) : 'none'"
                                :disabled="loadingSnapshot || restoring"
                                @update:model-value="
                                    (value: any) => {
                                        automaticComparison = false;
                                        comparing = value === 'none' ? '' : Number(value);
                                        fetchComparison();
                                    }
                                "
                            >
                                <SelectTrigger2 :aria-label="labels.compare" variant="bordered"
                                    ><span>{{
                                        comparing ? `${labels.version} ${comparing}` : labels.none
                                    }}</span></SelectTrigger2
                                >
                                <SelectContent>
                                    <SelectItem2 value="none">{{ labels.none }}</SelectItem2>
                                    <SelectItem2
                                        v-for="version in versions.filter((item) => item.number !== selected)"
                                        :key="version.number"
                                        :value="String(version.number)"
                                        >{{ labels.version }} {{ version.number }}</SelectItem2
                                    >
                                </SelectContent>
                            </Select>
                        </div>
                        <div v-if="loadingSnapshot" class="native-skeleton" aria-busy="true">
                            <span v-for="index in 5" :key="index" />
                        </div>
                        <p v-if="previewError || comparison.error" role="alert">
                            {{ labels.previewError }}
                            <Button type="button" @click="fetchComparison">
                                {{ labels.retry }}
                            </Button>
                        </p>
                        <template v-if="after && !loadingSnapshot">
                            <section
                                v-if="before && !comparison.error"
                                class="native-history-changes"
                                :aria-label="labels.changes"
                            >
                                <h3>{{ labels.changes }} ({{ comparison.changes.length }})</h3>
                                <p v-if="!comparison.changes.length">{{ labels.noChanges }}</p>
                                <ol v-else>
                                    <li
                                        v-for="(change, index) in comparison.changes"
                                        :key="index"
                                        :data-history-kind="change.kind"
                                    >
                                        <Button
                                            type="button"
                                            :aria-label="`${labels.inspect} ${index + 1}`"
                                            @click="inspect(change)"
                                        >
                                            {{ labels[change.kind] }} ·
                                            {{ unitLabel(change.after?.kind ?? change.before?.kind) }}
                                        </Button>
                                        <p v-if="change.text.length" dir="auto">
                                            <template v-for="(part, partIndex) in change.text" :key="partIndex"
                                                ><ins v-if="part.kind === 'added'">{{ part.text }}</ins
                                                ><del v-else-if="part.kind === 'removed'">{{ part.text }}</del
                                                ><span v-else>{{ part.text }}</span></template
                                            >
                                        </p>
                                        <p v-if="change.formatting">{{ labels.formatting }}</p>
                                        <p v-else-if="!change.text.length">{{ labels.structure }}</p>
                                    </li>
                                </ol>
                            </section>
                            <div class="native-history-preview-controls">
                                <div v-if="before" class="grid min-w-48 gap-2 text-sm">
                                    <label>{{ labels.layout }}</label>
                                    <Select v-model="previewLayout">
                                        <SelectTrigger2 :aria-label="labels.layout" variant="bordered"
                                            ><span>{{
                                                previewLayout === 'both'
                                                    ? labels.both
                                                    : previewLayout === 'after'
                                                      ? labels.selectedOnly
                                                      : labels.previousOnly
                                            }}</span></SelectTrigger2
                                        >
                                        <SelectContent
                                            ><SelectItem2 value="both">{{ labels.both }}</SelectItem2
                                            ><SelectItem2 value="after">{{ labels.selectedOnly }}</SelectItem2
                                            ><SelectItem2 value="before">{{
                                                labels.previousOnly
                                            }}</SelectItem2></SelectContent
                                        >
                                    </Select>
                                </div>
                                <div class="grid min-w-36 gap-2 text-sm">
                                    <label>{{ labels.zoom }}</label>
                                    <Select v-model="previewZoom" @update:model-value="zoomPreview">
                                        <SelectTrigger2 :aria-label="labels.zoom" variant="bordered"
                                            ><span>{{
                                                previewZoom === 'auto' ? labels.fit : `${previewZoom}%`
                                            }}</span></SelectTrigger2
                                        >
                                        <SelectContent
                                            ><SelectItem2 value="auto">{{ labels.fit }}</SelectItem2
                                            ><SelectItem2
                                                v-for="percent in [50, 75, 100, 150, 200]"
                                                :key="percent"
                                                :value="String(percent)"
                                                >{{ percent }}%</SelectItem2
                                            ></SelectContent
                                        >
                                    </Select>
                                </div>
                            </div>
                            <div
                                class="native-history-previews"
                                :class="{ 'has-comparison': before && previewLayout === 'both' }"
                            >
                                <section v-if="before" v-show="previewLayout !== 'after'">
                                    <h3>{{ labels.before }} · {{ labels.version }} {{ before.number }}</h3>
                                    <NativeEditor
                                        :key="before.number"
                                        ref="beforeEditor"
                                        :content="before.content"
                                        document-id="history"
                                        :locale="locale"
                                        :resolve-media="resolveMedia"
                                        :shared-kernel="sharedKernel"
                                        :history-highlights="beforeHighlights"
                                        readonly
                                        embedded
                                        @error="previewError = true"
                                        @ready="zoomPreview"
                                    />
                                </section>
                                <section v-show="!before || previewLayout !== 'before'">
                                    <h3>{{ labels.after }} · {{ labels.version }} {{ after.number }}</h3>
                                    <NativeEditor
                                        :key="after.number"
                                        ref="afterEditor"
                                        :content="after.content"
                                        document-id="history"
                                        :locale="locale"
                                        :resolve-media="resolveMedia"
                                        :shared-kernel="sharedKernel"
                                        :history-highlights="afterHighlights"
                                        readonly
                                        embedded
                                        @error="previewError = true"
                                        @ready="zoomPreview"
                                    />
                                </section>
                            </div>
                            <footer
                                v-if="canRestore && after.number !== head"
                                class="border-border flex justify-end border-t pt-4"
                            >
                                <RestoreVersionDialog
                                    v-model:open="confirmOpen"
                                    :selected-commit="after"
                                    :commit-number="after.number"
                                    :disabled="previewError || comparison.error"
                                    :processing="restoring"
                                    :error="restoreError ? labels.restoreError : undefined"
                                    @restore="restoreVersion"
                                />
                            </footer>
                            <p
                                v-if="restoreError && (!confirmOpen || !canRestore)"
                                role="alert"
                                class="text-destructive text-sm"
                            >
                                {{ labels.restoreError }}
                            </p>
                        </template>
                    </section>
                </div>
            </div>
        </DialogScrollContent>
    </Dialog>
</template>
