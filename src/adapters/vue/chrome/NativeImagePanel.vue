<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import type { MediaResolver } from '@saad5400/midad/assets';
import type { ImageDraft, NativeImage } from '@saad5400/midad/images';
import type { NativeLabels } from '@saad5400/midad/labels';
import { readImageFile } from '@saad5400/midad/raster-image';
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue';

const ui = useEditorUi();

const VuePictureCropper = useUiComponent('PictureCropper');

const props = defineProps<{
    image?: NativeImage;
    floatingOnly?: boolean;
    labels: NativeLabels;
    resolveMedia?: MediaResolver;
    page: number;
    pageCount: number;
    maximumWidth: number;
    maximumHeight: number;
    busy: boolean;
    error?: string;
}>();
const emit = defineEmits<{
    save: [draft: ImageDraft, file: File | undefined, floating: boolean, page: number];
    close: [];
    remove: [];
}>();
const attrs = props.image?.attributes ?? {};
const draft = reactive({
    src: String(attrs.src ?? ''),
    attachmentId: typeof attrs.attachmentId === 'string' ? attrs.attachmentId : undefined,
    alt: String(attrs.alt ?? ''),
    title: String(attrs.title ?? ''),
    width: Number(attrs.width ?? 0),
    height: Number(attrs.height ?? 0),
});
const floating = ref(props.floatingOnly || props.image?.floating || false),
    targetPage = ref(props.page + 1);
const file = shallowRef<File>(),
    preview = ref(''),
    localError = ref(''),
    loading = ref(false);
const cropping = ref(false),
    keepAspect = ref(attrs.keepAspect !== false),
    dialog = ref<HTMLDialogElement>();
const aspect = ref(draft.width && draft.height ? draft.width / draft.height : 1);
const locked = computed(() => attrs.locked === true);
let objectUrl: string | undefined;
let mounted = true;
function fit(width: number, height: number): void {
    const limit = Math.min(1, props.maximumWidth / width, props.maximumHeight / height);
    draft.width = Math.round(width * limit * 100) / 100;
    draft.height = Math.round(height * limit * 100) / 100;
    aspect.value = width / height;
}
async function choose(selected: File, preserve = false): Promise<void> {
    loading.value = true;
    localError.value = '';
    try {
        const decoded = await readImageFile(selected);
        if (!mounted) return;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        file.value = decoded.file;
        objectUrl = URL.createObjectURL(decoded.file);
        preview.value = objectUrl;
        const width = preserve && draft.width ? draft.width : decoded.width;
        fit(width, (width * decoded.height) / decoded.width);
        if (!draft.alt) draft.alt = selected.name;
        cropping.value = false;
    } catch {
        localError.value = props.labels.invalidImage;
    } finally {
        loading.value = false;
    }
}
function pick(event: Event): void {
    const input = event.target as HTMLInputElement,
        selected = input.files?.[0];
    if (selected) void choose(selected, !!props.image);
    input.value = '';
}
function dimension(event: Event, key: 'width' | 'height'): void {
    const value = Number((event.target as HTMLInputElement).value);
    draft[key] = value;
    if (keepAspect.value)
        draft[key === 'width' ? 'height' : 'width'] =
            Math.round((key === 'width' ? value / aspect.value : value * aspect.value) * 100) / 100;
}
async function applyCrop(): Promise<void> {
    const cropper = ui.imageCropper?.();
    if (!cropper) return;
    loading.value = true;
    try {
        const cropped = await cropper.getFile();
        if (cropped) await choose(cropped, true);
        else localError.value = props.labels.invalidImage;
    } catch {
        localError.value = props.labels.invalidImage;
    } finally {
        loading.value = false;
    }
}
function rotate(angle: number): void {
    const cropper = ui.imageCropper?.();
    if (!cropper) return;
    cropper.clear();
    cropper.rotate(angle);
    const container = cropper.getContainerData(),
        rotated = cropper.getCanvasData();
    cropper.zoomTo(Math.min(container.width / rotated.naturalWidth, container.height / rotated.naturalHeight));
    cropper.crop();
    const canvas = cropper.getCanvasData();
    cropper.setCropBoxData({ left: canvas.left, top: canvas.top, width: canvas.width, height: canvas.height });
}
onMounted(async () => {
    dialog.value?.showModal();
    if (draft.src) {
        try {
            const resolved = await (props.resolveMedia?.(draft.src) ?? draft.src);
            if (!file.value) preview.value = resolved;
        } catch {
            localError.value = props.labels.invalidImage;
        }
    }
});
onBeforeUnmount(() => {
    mounted = false;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    dialog.value?.close();
});
</script>

<template>
    <dialog
        ref="dialog"
        class="native-field-dialog native-image-dialog"
        :aria-label="image ? labels.editImage : labels.insertImage"
        @cancel.prevent="emit('close')"
    >
        <form
            @submit.prevent="emit('save', { ...draft, keepAspect }, file, floating, targetPage - 1)"
            @keydown.esc.prevent.stop="emit('close')"
        >
            <h2>{{ image ? labels.editImage : labels.insertImage }}</h2>
            <fieldset :disabled="busy || loading" class="native-image-fields">
                <label
                    >{{ labels.imageFile
                    }}<span class="native-file-picker"
                        ><input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/svg+xml"
                            :required="!preview"
                            :disabled="locked"
                            :aria-label="labels.imageFile"
                            @change="pick"
                        /><span>{{ labels.chooseFile }}</span
                        ><span>{{ file?.name ?? labels.noFileSelected }}</span></span
                    ></label
                >
                <label
                    >{{ labels.imageAlt }}<input v-model="draft.alt" maxlength="1000" :aria-label="labels.imageAlt"
                /></label>
                <label
                    >{{ labels.imageTitle
                    }}<input v-model="draft.title" maxlength="1000" :aria-label="labels.imageTitle"
                /></label>
                <label
                    >{{ labels.imageWidth
                    }}<input
                        :value="draft.width || ''"
                        type="number"
                        min="1"
                        max="2000"
                        step="any"
                        required
                        :disabled="locked"
                        :aria-label="labels.imageWidth"
                        @input="dimension($event, 'width')"
                /></label>
                <label
                    >{{ labels.imageHeight
                    }}<input
                        :value="draft.height || ''"
                        type="number"
                        min="1"
                        max="2000"
                        step="any"
                        required
                        :disabled="locked"
                        :aria-label="labels.imageHeight"
                        @input="dimension($event, 'height')"
                /></label>
                <label class="native-field-checkbox"
                    ><input v-model="keepAspect" type="checkbox" :disabled="locked" />{{ labels.keepAspect }}</label
                >
                <label v-if="!floatingOnly" class="native-field-checkbox"
                    ><input v-model="floating" type="checkbox" :disabled="locked" />{{ labels.imageFloating }}</label
                >
                <label v-if="floating"
                    >{{ labels.imagePage
                    }}<input
                        v-model.number="targetPage"
                        type="number"
                        min="1"
                        :max="pageCount"
                        required
                        :disabled="locked"
                        :aria-label="labels.imagePage"
                /></label>
                <div v-if="preview" class="native-image-preview">
                    <VuePictureCropper
                        v-if="cropping"
                        :img="preview"
                        :box-style="{ width: '100%', height: '320px' }"
                        :options="{ viewMode: 1, dragMode: 'crop', autoCropArea: 1, background: false }"
                    />
                    <img v-else :src="preview" :alt="draft.alt" />
                </div>
                <div v-if="preview && !locked" class="native-image-actions">
                    <button v-if="!cropping" type="button" @click="cropping = true">
                        {{ labels.cropImage }}
                    </button>
                    <template v-else>
                        <button type="button" @click="rotate(-90)">
                            {{ labels.rotateLeft }}
                        </button>
                        <button type="button" @click="rotate(90)">
                            {{ labels.rotateRight }}
                        </button>
                        <button type="button" @click="ui.imageCropper?.()?.reset()">
                            {{ labels.resetImage }}
                        </button>
                        <button type="button" @click="applyCrop">
                            {{ labels.applyCrop }}
                        </button>
                        <button type="button" @click="cropping = false">
                            {{ labels.cancel }}
                        </button>
                    </template>
                </div>
            </fieldset>
            <p v-if="localError || error" role="alert">
                {{ localError || error }}
            </p>
            <p v-if="busy || loading" role="status">
                {{ busy ? labels.uploadingMedia : labels.preparingImage }}
            </p>
            <footer>
                <button type="submit" :disabled="busy || loading || !preview || cropping || !!localError">
                    {{ labels.saveImage }}
                </button>
                <button v-if="image" type="button" :disabled="busy || locked" @click="emit('remove')">
                    {{ labels.deleteImage }}
                </button>
                <button type="button" @click="emit('close')">
                    {{ labels.cancel }}
                </button>
            </footer>
        </form>
    </dialog>
</template>
