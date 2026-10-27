import type { CanvasKit } from 'canvaskit-wasm';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue';
import { FindShortcut } from '../../browser/input/index.js';
import { searchRectangles } from '../../browser/view/index.js';
import type { NativeDocument } from '../../document/index.js';
import { DocumentSearch, matchSelection, type TextMatch } from '../../editing/index.js';
import type { NativeSelection } from '../../editing/selection.js';
import type { DocumentScene } from '../../layout/index.js';

interface FindHost {
    root: Ref<HTMLElement | undefined>;
    pages: Ref<HTMLElement | undefined>;
    document: Ref<NativeDocument>;
    scene: Ref<DocumentScene | undefined>;
    ready: Ref<boolean>;
    available: () => boolean;
    scale: Ref<number>;
    canvasKit: () => CanvasKit | undefined;
    selectedText: () => string;
    select: (selection: NativeSelection) => void;
    focus: () => void;
}

export function useNativeFind(host: FindHost) {
    const opened = ref(false),
        query = ref(''),
        caseSensitive = ref(false),
        wholeWord = ref(false);
    const index = ref(-1),
        total = ref(0),
        top = ref(0);
    const focusToken = ref(0);
    const busy = computed(() => opened.value && !host.ready.value);
    const boxes = shallowRef<Array<{ left: number; top: number; width: number; height: number; active: boolean }>>([]);
    const search = new DocumentSearch();
    let shortcut: FindShortcut | undefined,
        frame: number | undefined,
        reveal = false,
        disposed = false;

    function updateBoxes(): void {
        boxes.value = [];
        if (!opened.value || !host.ready.value || !host.scene.value || !host.canvasKit()) return;
        const tools = [
            ...(host.root.value?.querySelectorAll<HTMLElement>('.native-format-toolbar, .native-controls') ?? []),
        ];
        top.value = Math.max(
            0,
            ...tools.map((tool) => (parseFloat(getComputedStyle(tool).top) || 0) + tool.offsetHeight),
        );
        const viewport = host.pages.value?.getBoundingClientRect();
        if (!viewport) return;
        const bar = host.root.value?.querySelector('.native-find-panel')?.getBoundingClientRect();
        const visible = new Map<number, DOMRect>();
        for (const element of host.pages.value?.querySelectorAll<HTMLElement>('.native-page') ?? []) {
            const bounds = element.getBoundingClientRect();
            if (bounds.bottom > 0 && bounds.top < innerHeight) visible.set(Number(element.dataset.page) - 1, bounds);
        }
        boxes.value = searchRectangles(
            host.scene.value,
            search.matches,
            host.canvasKit()!,
            new Set(visible.keys()),
        ).flatMap((rect) => {
            const bounds = visible.get(rect.pageIndex)!;
            const x = bounds.left + rect.x * host.scale.value,
                y = bounds.top + rect.y * host.scale.value;
            const left = Math.max(x, 0, viewport.left),
                upper = Math.max(y, 0, viewport.top, bar?.bottom ?? 0);
            const right = Math.min(x + rect.width * host.scale.value, innerWidth, viewport.right);
            const bottom = Math.min(y + rect.height * host.scale.value, innerHeight, viewport.bottom);
            return right > left && bottom > upper
                ? [
                      {
                          left,
                          top: upper,
                          width: right - left,
                          height: bottom - upper,
                          active: rect.matchIndex === search.index,
                      },
                  ]
                : [];
        });
    }
    function schedule(): void {
        if (!opened.value || frame !== undefined || disposed) return;
        frame = requestAnimationFrame(() => {
            frame = undefined;
            updateBoxes();
        });
    }
    async function select(match?: TextMatch): Promise<void> {
        await nextTick();
        if (!disposed && opened.value && match === search.current && host.ready.value && match)
            host.select(matchSelection(match));
        schedule();
    }
    function refresh(navigate = false): void {
        if (!opened.value) return;
        reveal ||= navigate;
        if (!host.ready.value || !host.scene.value) {
            boxes.value = [];
            return;
        }
        const blockIds = new Set(host.scene.value.pages.flatMap((page) => page.lines.map((line) => line.paragraphId)));
        search.update(host.document.value, query.value, {
            caseSensitive: caseSensitive.value,
            wholeWord: wholeWord.value,
            blockIds,
        });
        index.value = search.index;
        total.value = search.matches.length;
        if (reveal) {
            reveal = false;
            void select(search.current);
        }
        schedule();
    }
    function open(): void {
        const selected = host.ready.value ? host.selectedText() : '';
        if (selected && selected.length <= 1000 && !/[\n\uFFFC]/.test(selected)) query.value = selected;
        opened.value = true;
        focusToken.value++;
        refresh(true);
    }
    function move(direction: -1 | 1): void {
        if (!host.ready.value) {
            reveal = true;
            return;
        }
        const match = search.move(direction);
        index.value = search.index;
        void select(match);
    }
    function close(): void {
        opened.value = false;
        reveal = false;
        boxes.value = [];
        host.focus();
    }
    watch([query, caseSensitive, wholeWord], () => refresh(true));
    watch([host.document, host.scene, host.ready], () => refresh());
    watch(host.scale, schedule);
    onMounted(() => {
        if (host.root.value)
            shortcut = new FindShortcut(
                host.root.value,
                open,
                () => host.available() && !host.root.value?.querySelector('dialog[open]'),
            );
        window.addEventListener('scroll', schedule, true);
        window.addEventListener('resize', schedule);
    });
    onBeforeUnmount(() => {
        disposed = true;
        shortcut?.dispose();
        if (frame !== undefined) cancelAnimationFrame(frame);
        window.removeEventListener('scroll', schedule, true);
        window.removeEventListener('resize', schedule);
    });
    return { opened, query, caseSensitive, wholeWord, index, total, top, boxes, focusToken, busy, open, move, close };
}
