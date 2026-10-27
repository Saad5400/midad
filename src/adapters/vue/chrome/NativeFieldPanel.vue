<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import {
    getDefaultVariableDimensions,
    getDefaultVariableSettings,
    type VariableType,
} from '@saad5400/midad/field-schema';
import type { MediaResolver } from '@saad5400/midad/assets';
import type { Json } from '@saad5400/midad/document';
import {
    fieldSettings,
    IMAGE_FIELD_TYPES,
    NATIVE_FIELD_TYPES,
    type FieldDraft,
    type NativeField,
} from '@saad5400/midad/fields';
import type { NativeLabels } from '@saad5400/midad/labels';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';

const ui = useEditorUi();

const EDITOR_FONT_OPTIONS = ui.fonts ?? [];

const props = defineProps<{
    labels: NativeLabels;
    reviewing?: boolean;
    floatingOnly?: boolean;
    field?: NativeField;
    participants: readonly { id: string; name: string }[];
    direction: 'ltr' | 'rtl';
    error?: string;
    page: number;
    pageCount: number;
    busy?: boolean;
    canUploadAttachment?: boolean;
    resolveMedia?: MediaResolver;
}>();
const emit = defineEmits<{
    save: [draft: FieldDraft, floating: boolean, page?: number, file?: File];
    remove: [];
    close: [];
}>();
const attachment = ref<File>();
const attachmentHref = ref('');
const floating = ref(props.floatingOnly || props.field?.floating || false);
const targetPage = ref(props.page + 1);
const attrs = props.field?.attributes ?? {},
    type = String(attrs.type ?? 'text') as VariableType;
const defaults = getDefaultVariableDimensions(type);
const draft = reactive({
    type,
    name: String(attrs.name ?? ''),
    description: String(attrs.description ?? ''),
    value: String(attrs.value ?? ''),
    participant_id: String(attrs.participant_id ?? ''),
    width: Number(attrs.width ?? defaults.width),
    height: Number(attrs.height ?? defaults.height),
    settings: { ...getDefaultVariableSettings(type), direction: props.direction, ...fieldSettings(attrs) } as Record<
        string,
        Json
    >,
});
const options = ref<string>(Array.isArray(draft.settings.options) ? draft.settings.options.map(String).join('\n') : '');
const fontSize = ref<number | string>(parseFloat(String(draft.settings.fontSize)) || 14);
const choice = computed(() => ['choice', 'single', 'multi'].includes(draft.type));
const image = computed(() => IMAGE_FIELD_TYPES.has(draft.type) || draft.type === 'attachment');
const dialog = ref<HTMLDialogElement>();
const nameInput = ref<HTMLInputElement>();
const typeLabel = (type: string): keyof NativeLabels =>
    `field${type.charAt(0).toUpperCase()}${type.slice(1)}` as keyof NativeLabels;
function changeType(): void {
    attachment.value = undefined;
    Object.assign(draft, getDefaultVariableDimensions(draft.type));
    draft.settings = { ...getDefaultVariableSettings(draft.type), direction: props.direction };
    fontSize.value = parseFloat(String(draft.settings.fontSize)) || 14;
    draft.value = '';
}
function pickAttachment(event: Event): void {
    const input = event.target as HTMLInputElement;
    attachment.value = input.files?.[0];
    input.value = '';
}
function save(): void {
    emit(
        'save',
        {
            ...draft,
            settings: {
                ...draft.settings,
                ...(!image.value ? { fontSize: `${fontSize.value}px` } : {}),
                ...(choice.value
                    ? {
                          options: options.value
                              .split('\n')
                              .map((option) => option.trim())
                              .filter(Boolean),
                      }
                    : {}),
            },
        },
        floating.value,
        floating.value ? Number(targetPage.value) - 1 : undefined,
        attachment.value,
    );
}
onMounted(async () => {
    dialog.value?.showModal();
    nameInput.value?.focus();
    if (attrs.type === 'attachment' && typeof attrs.value === 'string' && attrs.value && props.resolveMedia)
        attachmentHref.value = await props.resolveMedia(attrs.value);
});
onBeforeUnmount(() => dialog.value?.close());
</script>

<template>
    <dialog
        ref="dialog"
        class="native-field-dialog"
        :aria-label="field ? labels.editField : labels.insertField"
        @cancel.prevent="emit('close')"
    >
        <form @submit.prevent="save" @keydown.esc.prevent.stop="emit('close')">
            <fieldset :disabled="busy" class="native-image-fields">
                <h2>{{ field ? labels.editField : labels.insertField }}</h2>
                <label
                    >{{ labels.fieldType
                    }}<select
                        v-model="draft.type"
                        :disabled="!!field && !reviewing"
                        :aria-label="labels.fieldType"
                        @change="changeType"
                    >
                        <option v-for="type in NATIVE_FIELD_TYPES" :key="type" :value="type">
                            {{ labels[typeLabel(type)] }}
                        </option>
                    </select></label
                >
                <label
                    >{{ labels.fieldName
                    }}<input
                        ref="nameInput"
                        v-model="draft.name"
                        required
                        maxlength="255"
                        :aria-label="labels.fieldName"
                /></label>
                <label v-if="!reviewing"
                    >{{ labels.fieldDescription
                    }}<textarea v-model="draft.description" maxlength="255" :aria-label="labels.fieldDescription" />
                </label>
                <label
                    >{{ labels.fieldParticipant
                    }}<select
                        v-model="draft.participant_id"
                        :aria-label="labels.fieldParticipant"
                        @change="attachment = undefined"
                    >
                        <option value="">{{ labels.fieldAuthor }}</option>
                        <option v-for="participant in participants" :key="participant.id" :value="participant.id">
                            {{ participant.name }}
                        </option>
                    </select></label
                >
                <label v-if="!reviewing && !floatingOnly" class="native-field-checkbox"
                    ><input v-model="floating" type="checkbox" />{{ labels.fieldFloating }}</label
                >
                <label v-if="floating && !reviewing"
                    >{{ labels.fieldPage
                    }}<input
                        v-model.number="targetPage"
                        type="number"
                        min="1"
                        :max="pageCount"
                        required
                        :aria-label="labels.fieldPage"
                /></label>
                <label v-if="!reviewing" class="native-field-checkbox"
                    ><input v-model="draft.settings.required" type="checkbox" />{{ labels.fieldRequired }}</label
                >
                <label
                    >{{ labels.fieldWidth
                    }}<input
                        v-model.number="draft.width"
                        type="number"
                        min="1"
                        max="2000"
                        step="0.5"
                        required
                        :aria-label="labels.fieldWidth"
                /></label>
                <label
                    >{{ labels.fieldHeight
                    }}<input
                        v-model.number="draft.height"
                        type="number"
                        min="1"
                        max="2000"
                        step="0.5"
                        required
                        :aria-label="labels.fieldHeight"
                /></label>
                <template v-if="!image">
                    <label
                        >{{ labels.fieldValue
                        }}<textarea
                            v-model="draft.value"
                            :disabled="!!draft.participant_id"
                            :aria-label="labels.fieldValue"
                        />
                    </label>
                    <template v-if="!reviewing">
                        <label
                            >{{ labels.fontFamily
                            }}<select v-model="draft.settings.fontFamily" :aria-label="labels.fontFamily">
                                <option v-for="font in EDITOR_FONT_OPTIONS" :key="font.value" :value="font.value">
                                    {{ font.label }}
                                </option>
                            </select></label
                        >
                        <label
                            >{{ labels.fontSize
                            }}<input
                                v-model.number="fontSize"
                                type="number"
                                min="1"
                                max="400"
                                required
                                :aria-label="labels.fontSize"
                        /></label>
                        <label
                            >{{ labels.textColor
                            }}<input v-model="draft.settings.color" type="color" :aria-label="labels.textColor"
                        /></label>
                        <label
                            >{{ labels.direction
                            }}<select v-model="draft.settings.direction" :aria-label="labels.direction">
                                <option value="rtl">{{ labels.rtl }}</option>
                                <option value="ltr">{{ labels.ltr }}</option>
                            </select></label
                        >
                        <label
                            >{{ labels.align
                            }}<select v-model="draft.settings.textAlign" :aria-label="labels.align">
                                <option value="start">
                                    {{ draft.settings.direction === 'rtl' ? labels.right : labels.left }}
                                </option>
                                <option value="center">{{ labels.center }}</option>
                                <option value="end">
                                    {{ draft.settings.direction === 'rtl' ? labels.left : labels.right }}
                                </option>
                                <option value="justify">{{ labels.justify }}</option>
                            </select></label
                        >
                        <label class="native-field-checkbox"
                            ><input
                                v-model="draft.settings.fontWeight"
                                type="checkbox"
                                true-value="bold"
                                false-value="normal"
                            />{{ labels.bold }}</label
                        >
                        <label class="native-field-checkbox"
                            ><input
                                v-model="draft.settings.fontStyle"
                                type="checkbox"
                                true-value="italic"
                                false-value="normal"
                            />{{ labels.italic }}</label
                        >
                        <label class="native-field-checkbox"
                            ><input
                                v-model="draft.settings.textDecoration"
                                type="checkbox"
                                true-value="underline"
                                false-value="none"
                            />{{ labels.underline }}</label
                        >
                    </template>
                </template>
                <template v-if="draft.type === 'attachment'">
                    <label v-if="canUploadAttachment"
                        >{{ labels.attachmentFile
                        }}<span class="native-file-picker"
                            ><input
                                type="file"
                                :disabled="!!draft.participant_id"
                                :aria-label="labels.attachmentFile"
                                @change="pickAttachment"
                            /><span>{{ labels.chooseFile }}</span
                            ><span>{{ attachment?.name ?? labels.noFileSelected }}</span></span
                        ></label
                    >
                    <p v-if="attachment || draft.settings.filename" :aria-label="labels.attachmentName">
                        {{ attachment?.name ?? draft.settings.filename }}
                    </p>
                    <a v-if="attachmentHref && !attachment" :href="attachmentHref" target="_blank" rel="noopener">{{
                        labels.attachmentName
                    }}</a>
                </template>
                <label v-if="draft.type === 'text'" class="native-field-checkbox"
                    ><input v-model="draft.settings.multiline" type="checkbox" />{{ labels.fieldMultiline }}</label
                >
                <template v-if="choice">
                    <label
                        >{{ labels.fieldOptions
                        }}<textarea
                            v-model="options"
                            :required="!draft.settings.allowOther"
                            :aria-label="labels.fieldOptions"
                        />
                    </label>
                    <label class="native-field-checkbox"
                        ><input v-model="draft.settings.allowOther" type="checkbox" />{{
                            labels.fieldAllowOther
                        }}</label
                    >
                </template>
                <template v-if="draft.type === 'date'">
                    <label
                        >{{ labels.fieldCalendar
                        }}<select v-model="draft.settings.calendarType" :aria-label="labels.fieldCalendar">
                            <option value="gregorian">{{ labels.fieldGregorian }}</option>
                            <option value="hijri">{{ labels.fieldHijri }}</option>
                        </select></label
                    >
                    <label
                        >{{ labels.fieldDateFormat
                        }}<select v-model="draft.settings.dateFormat" :aria-label="labels.fieldDateFormat">
                            <option
                                v-for="format in ['dd/mm/yyyy', 'mm/dd/yyyy', 'yyyy-mm-dd']"
                                :key="format"
                                :value="format"
                            >
                                {{ format }}
                            </option>
                        </select></label
                    >
                </template>
            </fieldset>
            <p v-if="busy" role="status">
                {{ labels.uploadingMedia }}
            </p>
            <p v-if="error" role="alert">
                {{ error }}
            </p>
            <footer>
                <button type="submit" :disabled="busy">
                    {{ labels.fieldSave }}</button
                ><button v-if="field" type="button" :disabled="busy" @click="emit('remove')">
                    {{ labels.removeField }}</button
                ><button type="button" @click="emit('close')">
                    {{ labels.cancel }}
                </button>
            </footer>
        </form>
    </dialog>
</template>
