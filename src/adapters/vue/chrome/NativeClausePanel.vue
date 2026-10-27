<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import type { MediaResolver } from '@saad5400/midad/assets';
import {
    activeClauseVariant,
    clausePreview,
    clauseTitle,
    clauseVariants,
    nativeClauses,
    type ClauseProperties,
    type ClauseVariantAction,
    type LibraryClause,
} from '@saad5400/midad/clauses';
import { type Json, type NativeDocument } from '@saad5400/midad/document';
import { isRecord } from '@saad5400/midad/fields';
import { fragmentIsEmpty } from '@saad5400/midad/interchange/fragment';
import type { NativeLabels } from '@saad5400/midad/labels';
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

const ui = useEditorUi();

const NativeEditor = useUiComponent('DocumentPreviewEditor');
const FragmentEditor = useUiComponent('FragmentEditor');
const props = defineProps<{
    document: NativeDocument;
    initialId?: string;
    initialTab?: 'library';
    labels: NativeLabels;
    locale: 'ar' | 'en';
    readonly: boolean;
    busy: boolean;
    error: string;
    resolveMedia?: MediaResolver;
    loadLibrary?: (signal?: AbortSignal) => Promise<readonly LibraryClause[]>;
}>();
const emit = defineEmits<{
    close: [];
    insert: [source?: LibraryClause];
    edit: [id: string];
    properties: [id: string, patch: ClauseProperties];
    variant: [id: string, action: ClauseVariantAction];
    remove: [id: string, unwrap: boolean];
}>();
const dialog = ref<HTMLDialogElement>();
const selected = ref(props.initialId ?? nativeClauses(props.document)[0]?.id ?? '');
const tab = ref(
    props.initialTab === 'library' && props.loadLibrary && !props.readonly
        ? 'library'
        : nativeClauses(props.document).length || props.readonly || !props.loadLibrary
          ? 'document'
          : 'library',
);
const clauses = computed(() => nativeClauses(props.document));
const clause = computed(() => clauses.value.find((node) => node.id === selected.value));
const variants = computed(() => (clause.value ? clauseVariants(props.document, clause.value) : []));
const chosen = ref('');
const description = ref('');
const library = shallowRef<readonly LibraryClause[]>([]);
const search = ref(''),
    loading = ref(false),
    loadError = ref(false);
const preview = ref(false),
    explanationOpen = ref(false),
    explanationBusy = ref(false);
const explanationEditor = ref<{ prepare: () => Promise<unknown> }>();
const explanationDraft = shallowRef<Json>();
const discardVariant = ref(false);
let mounted = true;
let libraryController: AbortController | undefined;
function label(value: Json): string {
    if (typeof value === 'string') return value;
    if (isRecord(value)) return String(value[props.locale] ?? Object.values(value)[0] ?? '');
    return '';
}
watch(
    [selected, () => clause.value?.attributes?.activeVariantId],
    () => {
        chosen.value = clause.value ? activeClauseVariant(clause.value) : '';
        preview.value = false;
        discardVariant.value = false;
        explanationOpen.value = false;
    },
    { immediate: true },
);
watch(
    chosen,
    () => {
        description.value = label(variants.value.find((variant) => variant.id === chosen.value)?.description ?? null);
        discardVariant.value = false;
    },
    { immediate: true },
);
watch(clauses, (nodes) => {
    if (!nodes.some((node) => node.id === selected.value)) selected.value = nodes[0]?.id ?? '';
});
const filtered = computed(() =>
    library.value.filter((clause) =>
        clause.title.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()),
    ),
);
const previewContent = computed(() =>
    clause.value ? clausePreview(props.document, clause.value.id, chosen.value) : null,
);
async function fetchLibrary(): Promise<void> {
    if (!props.loadLibrary || props.readonly) return;
    libraryController?.abort();
    const controller = new AbortController();
    libraryController = controller;
    loading.value = true;
    loadError.value = false;
    try {
        const data = await props.loadLibrary(controller.signal);
        if (!Array.isArray(data)) throw new Error('Invalid clause library response');
        if (mounted && !controller.signal.aborted) library.value = data;
    } catch {
        if (mounted && !controller.signal.aborted) loadError.value = true;
    } finally {
        if (mounted && libraryController === controller) loading.value = false;
    }
}
function property(key: 'ordered' | 'isTitleHidden' | 'optional', event: Event): void {
    if (clause.value) emit('properties', clause.value.id, { [key]: (event.target as HTMLInputElement).checked });
}
function decide(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (clause.value)
        emit('properties', clause.value.id, { optionalValue: value === 'pending' ? null : value === 'included' });
}
async function editExplanation(): Promise<void> {
    let value = clause.value?.attributes?.explanation;
    if (typeof value === 'string') {
        try {
            const decoded = JSON.parse(value);
            if (Array.isArray(decoded) || (isRecord(decoded) && decoded.type === 'doc')) value = decoded;
        } catch {
            /* Plain explanations remain readable. */
        }
    }
    explanationDraft.value =
        typeof value === 'string'
            ? { type: 'doc', content: [{ type: 'paragraph', content: value ? [{ type: 'text', text: value }] : [] }] }
            : Array.isArray(value)
              ? { type: 'doc', content: value }
              : (value ?? { type: 'doc', content: [{ type: 'paragraph' }] });
    explanationOpen.value = true;
    await nextTick();
}
async function saveExplanation(): Promise<void> {
    if (!clause.value || !explanationEditor.value) return;
    explanationBusy.value = true;
    try {
        const content = await explanationEditor.value.prepare();
        emit('properties', clause.value.id, { explanation: fragmentIsEmpty(content) ? null : (content as Json) });
        explanationOpen.value = false;
    } catch {
        explanationOpen.value = true;
    } finally {
        explanationBusy.value = false;
    }
}
function variant(action: ClauseVariantAction): void {
    if (clause.value) emit('variant', clause.value.id, action);
}
onMounted(() => {
    dialog.value?.showModal();
    void fetchLibrary();
});
onBeforeUnmount(() => {
    mounted = false;
    libraryController?.abort();
    dialog.value?.close();
});
</script>

<template>
    <dialog
        ref="dialog"
        class="native-field-dialog native-clause-dialog"
        :aria-label="labels.clauses"
        @cancel.prevent="emit('close')"
    >
        <div class="native-clause-content">
            <header>
                <h2>{{ labels.clauses }}</h2>
                <button type="button" @click="emit('close')">
                    {{ labels.close }}
                </button>
            </header>
            <nav :aria-label="labels.clauses">
                <button type="button" :aria-pressed="tab === 'document'" @click="tab = 'document'">
                    {{ labels.documentClauses }}</button
                ><button
                    v-if="loadLibrary && !readonly"
                    type="button"
                    :aria-pressed="tab === 'library'"
                    @click="tab = 'library'"
                >
                    {{ labels.clauseLibrary }}</button
                ><button v-if="!readonly" type="button" :disabled="busy" @click="emit('insert')">
                    {{ labels.newClause }}
                </button>
            </nav>
            <section v-if="tab === 'library'" class="native-clause-library">
                <label
                    >{{ labels.searchClauses }}<input v-model="search" type="search" :aria-label="labels.searchClauses"
                /></label>
                <div v-if="loading" class="native-skeleton" aria-busy="true">
                    <span v-for="index in 4" :key="index" />
                </div>
                <p v-else-if="loadError" role="alert">
                    {{ labels.clauseLoadError }}
                    <button type="button" @click="fetchLibrary">
                        {{ labels.retry }}
                    </button>
                </p>
                <p v-else-if="!filtered.length">{{ labels.noClauses }}</p>
                <article v-for="item in loading ? [] : filtered" :key="item.uuid" class="native-clause-card">
                    <h3>{{ item.title }}</h3>
                    <span>{{ item.variants.length }} {{ labels.clauseVariants }}</span
                    ><button type="button" :disabled="busy || readonly" @click="emit('insert', item)">
                        {{ labels.insertClause }}
                    </button>
                </article>
            </section>
            <section v-else class="native-clause-settings">
                <label
                    >{{ labels.documentClauses
                    }}<select v-model="selected" :aria-label="labels.documentClauses">
                        <option v-for="(item, index) in clauses" :key="item.id" :value="item.id">
                            {{ clauseTitle(item) || `${labels.clause} ${index + 1}` }}
                        </option>
                    </select></label
                >
                <p v-if="!clause">{{ labels.noDocumentClauses }}</p>
                <template v-if="clause">
                    <fieldset :disabled="busy || readonly" class="native-clause-flags">
                        <label
                            ><input
                                type="checkbox"
                                :checked="clause.attributes?.ordered !== false"
                                @change="property('ordered', $event)"
                            />{{ labels.numberClause }}</label
                        >
                        <label
                            ><input
                                type="checkbox"
                                :checked="clause.attributes?.isTitleHidden === true"
                                @change="property('isTitleHidden', $event)"
                            />{{ labels.hideClauseTitle }}</label
                        >
                        <label
                            ><input
                                type="checkbox"
                                :checked="clause.attributes?.optional === true"
                                @change="property('optional', $event)"
                            />{{ labels.optionalClause }}</label
                        >
                        <label v-if="clause.attributes?.optional === true"
                            >{{ labels.optionalDecision
                            }}<select
                                :aria-label="labels.optionalDecision"
                                :value="
                                    clause.attributes.optionalValue === true
                                        ? 'included'
                                        : [false, 'false', '0'].includes(
                                                clause.attributes.optionalValue as boolean | string,
                                            )
                                          ? 'excluded'
                                          : 'pending'
                                "
                                @change="decide"
                            >
                                <option value="pending">{{ labels.clausePending }}</option>
                                <option value="included">{{ labels.clauseIncluded }}</option>
                                <option value="excluded">{{ labels.clauseExcluded }}</option>
                            </select></label
                        >
                    </fieldset>
                    <label
                        >{{ labels.clauseVariants
                        }}<select v-model="chosen" :aria-label="labels.clauseVariants">
                            <option v-for="(item, index) in variants" :key="item.id" :value="item.id">
                                {{ label(item.description) || `${labels.clauseVariant} ${index + 1}`
                                }}{{ item.isDefault ? ` (${labels.defaultVariant})` : '' }}
                            </option>
                        </select></label
                    >
                    <div class="native-clause-actions">
                        <button type="button" @click="preview = !preview">
                            {{ labels.previewClause }}</button
                        ><button
                            v-if="!readonly"
                            type="button"
                            :disabled="busy || chosen === activeClauseVariant(clause)"
                            @click="variant({ kind: 'select', id: chosen })"
                        >
                            {{ labels.useVariant }}</button
                        ><button v-if="!readonly" type="button" :disabled="busy" @click="variant({ kind: 'add' })">
                            {{ labels.addVariant }}
                        </button>
                    </div>
                    <div v-if="preview && previewContent" class="native-clause-preview">
                        <NativeEditor
                            :key="`${selected}-${chosen}`"
                            :content="previewContent"
                            :document-id="`clause-preview-${selected}`"
                            :locale="locale"
                            :resolve-media="resolveMedia"
                            readonly
                            embedded
                        />
                    </div>
                    <fieldset v-if="!readonly" :disabled="busy" class="native-clause-variant-tools">
                        <label
                            >{{ labels.variantDescription
                            }}<input v-model="description" :aria-label="labels.variantDescription"
                        /></label>
                        <div class="native-clause-actions">
                            <button
                                type="button"
                                @click="variant({ kind: 'describe', id: chosen, description, locale })"
                            >
                                {{ labels.saveDescription }}</button
                            ><button
                                type="button"
                                :disabled="variants[0]?.id === chosen"
                                @click="variant({ kind: 'move', id: chosen, delta: -1 })"
                            >
                                {{ labels.moveVariantUp }}</button
                            ><button
                                type="button"
                                :disabled="variants.at(-1)?.id === chosen"
                                @click="variant({ kind: 'move', id: chosen, delta: 1 })"
                            >
                                {{ labels.moveVariantDown }}
                            </button>
                        </div>
                        <label v-if="variants.length > 1"
                            ><input v-model="discardVariant" type="checkbox" />{{ labels.confirmRemoveVariant }}</label
                        ><button
                            v-if="variants.length > 1"
                            type="button"
                            :disabled="!discardVariant"
                            @click="variant({ kind: 'remove', id: chosen })"
                        >
                            {{ labels.removeVariant }}
                        </button>
                    </fieldset>
                    <button type="button" @click="editExplanation">
                        {{ readonly ? labels.viewExplanation : labels.editExplanation }}
                    </button>
                    <div v-if="explanationOpen && explanationDraft" class="native-clause-explanation">
                        <FragmentEditor
                            ref="explanationEditor"
                            :model-value="explanationDraft"
                            :insert="{ fields: false, images: false, clauses: false, bilingual: false }"
                            :locale="locale"
                            :resolve-media="resolveMedia"
                            :readonly="readonly"
                            @update:model-value="explanationDraft = $event as Json"
                            @busy="explanationBusy = $event"
                        />
                        <div class="native-clause-actions">
                            <button
                                v-if="!readonly"
                                type="button"
                                :disabled="busy || explanationBusy"
                                @click="saveExplanation"
                            >
                                {{ labels.saveExplanation }}</button
                            ><button type="button" @click="explanationOpen = false">
                                {{ labels.cancel }}
                            </button>
                        </div>
                    </div>
                    <footer v-if="!readonly">
                        <button
                            type="button"
                            :disabled="busy || clause.attributes?.optionalValue === false"
                            @click="emit('edit', clause.id)"
                        >
                            {{ labels.editClauseText }}</button
                        ><button type="button" :disabled="busy" @click="emit('remove', clause.id, true)">
                            {{ labels.unwrapClause }}</button
                        ><button type="button" :disabled="busy" @click="emit('remove', clause.id, false)">
                            {{ labels.removeClause }}
                        </button>
                    </footer>
                </template>
            </section>
            <p v-if="error" role="alert">
                {{ error }}
            </p>
        </div>
    </dialog>
</template>
