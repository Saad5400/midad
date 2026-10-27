import { DocumentSession, findNode, importDocument } from '@saad5400/midad/document';
import {
    blockText,
    formatText,
    joinPreviousTextBlock,
    replaceInlineText,
    splitTextBlock,
    textBlocks,
    textDifference,
} from '@saad5400/midad/editing';
import { hitTest, layoutDocument } from '@saad5400/midad/layout';
import { NativeTextKernel } from '@saad5400/midad/rendering';
import { writeScenePdf } from '@saad5400/midad/pdf';
import { NativeNavigation } from '@saad5400/midad/browser/input';
import { EditingOverlayView, PageView, searchRectangles, caretViewportRect } from '@saad5400/midad/browser/view';

const pages = document.querySelector('main');
const status = document.querySelector('#status');
const buttons = Object.fromEntries([...document.querySelectorAll('button')].map((button) => [button.id, button]));
const session = new DocumentSession(
    importDocument(
        {
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 1 },
                    content: [{ type: 'text', text: 'Write with Midad · اكتب بمداد' }],
                },
                {
                    type: 'paragraph',
                    content: [
                        {
                            type: 'text',
                            text: 'Click the page and type. Select text for bold. Enter starts a paragraph; Undo restores your changes.',
                        },
                    ],
                },
                {
                    type: 'paragraph',
                    attrs: { dir: 'rtl' },
                    content: [
                        {
                            type: 'text',
                            text: 'هذا مثال مستقل دون أي إطار عمل. يستخدم المحرر وملف PDF المشهد نفسه لترتيب الكلمات والصفحات.',
                        },
                    ],
                },
            ],
        },
        'vanilla-example',
    ),
);
let kernel, scene, navigation, selection, overlay;
let views = [],
    hosts = [],
    pending = Promise.resolve(),
    generation = 0,
    composing = false;
let scale = 1;
const reportError = (error) => {
    console.error(error);
    status.textContent = error.message;
};
const activeBlock = () => selection && findNode(session.document, selection.blockId);
const range = () => ({
    blockId: selection.blockId,
    from: overlay.input.selectionStart,
    to: overlay.input.selectionEnd,
    expectedRevision: session.document.revision,
});
function enqueue(work) {
    const request = ++generation;
    pending = pending
        .then(async () => {
            await work();
            await render(request);
        })
        .catch(reportError);
    return pending;
}
function setSelection(blockId, from, to = from) {
    selection = { blockId, from, to };
    overlay.input.value = blockText(findNode(session.document, blockId));
    overlay.input.setSelectionRange(from, to);
    updateOverlay();
}
function viewportRect(pageIndex, box) {
    const rect = hosts[pageIndex].getBoundingClientRect();
    return {
        left: rect.left + box.x * scale,
        top: rect.top + box.y * scale,
        width: box.width * scale,
        height: box.height * scale,
    };
}
function updateOverlay() {
    if (!overlay || !navigation || !activeBlock()) return;
    selection.from = overlay.input.selectionStart;
    selection.to = overlay.input.selectionEnd;
    const offset = overlay.input.selectionDirection === 'backward' ? selection.from : selection.to;
    const position = caretViewportRect(
        navigation,
        { blockId: selection.blockId, offset },
        (pageIndex) => hosts[pageIndex]?.getBoundingClientRect(),
        scale,
    );
    const rectangles = searchRectangles(
        scene,
        [{ blockId: selection.blockId, from: selection.from, to: selection.to }],
        kernel.ck,
    ).map((box) => viewportRect(box.pageIndex, box));
    overlay.update({
        input: {
            label: 'Edit document text',
            readonly: false,
            direction: activeBlock().attributes?.dir === 'rtl' ? 'rtl' : 'ltr',
            position,
        },
        selection: rectangles,
        find: [],
        peers: [],
        reviews: [],
        templates: [],
        handles: [],
        handleLabels: { start: 'Selection start', end: 'Selection end' },
        caret: document.activeElement === overlay.input ? position : null,
    });
}
async function render(request = generation) {
    await kernel.prepare(session.document);
    scene = layoutDocument(session.document, kernel);
    navigation = new NativeNavigation(session.document, scene, kernel.ck);
    scale = Math.min(1.25, Math.max(0.25, (window.innerWidth - 32) / scene.pages[0].width));
    while (views.length > scene.pages.length) {
        views.pop().dispose();
        hosts.pop().remove();
    }
    scene.pages.forEach((page, index) => {
        const frame = { kernel, page, revision: scene.revision, scale, label: `Page ${index + 1}` };
        if (views[index]) views[index].update(frame);
        else {
            const host = document.createElement('section');
            host.className = 'page';
            pages.append(host);
            hosts.push(host);
            views.push(new PageView(host, frame, { state() {}, painted() {}, error: reportError }));
            host.addEventListener('pointerdown', (event) => {
                if (composing || event.button !== 0) return;
                event.preventDefault();
                const rect = host.getBoundingClientRect();
                const hit = hitTest(
                    scene,
                    index,
                    (event.clientX - rect.left) / scale,
                    (event.clientY - rect.top) / scale,
                );
                if (!hit) return;
                setSelection(hit.blockId, hit.blockOffset);
                overlay.input.focus({ preventScroll: true });
                updateOverlay();
            });
        }
    });
    if (request === generation) {
        if (!activeBlock()) {
            const block = textBlocks(session.document.root)[0];
            selection = { blockId: block.id, from: 0, to: 0 };
        }
        setSelection(selection.blockId, selection.from, selection.to);
    }
    buttons.undo.disabled = !session.canUndo;
    buttons.redo.disabled = !session.canRedo;
    buttons.bold.disabled = buttons.pdf.disabled = false;
    status.textContent = `${scene.pages.length} page${scene.pages.length === 1 ? '' : 's'} · Click a paragraph to edit · Canvas and PDF share one layout`;
}
function input(event) {
    composing = event.isComposing;
    if (composing || !selection) return;
    const snapshot = {
        ...selection,
        value: overlay.input.value,
        from: overlay.input.selectionStart,
        to: overlay.input.selectionEnd,
    };
    enqueue(() => {
        const previous = blockText(findNode(session.document, snapshot.blockId));
        const difference = textDifference(previous, snapshot.value);
        session.commit(
            replaceInlineText(session.document, {
                blockId: snapshot.blockId,
                ...difference,
                expectedRevision: session.document.revision,
            }),
        );
        selection = snapshot;
    });
}
function key(event) {
    if (event.isComposing || !selection) return;
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        buttons[event.shiftKey ? 'redo' : 'undo'].click();
        return;
    }
    if (command && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        buttons.bold.click();
        return;
    }
    if (event.key === 'Enter') {
        event.preventDefault();
        const edit = range();
        enqueue(() => {
            const result = splitTextBlock(session.document, { ...edit, expectedRevision: session.document.revision });
            session.commit(result.document);
            selection = { blockId: result.caret.blockId, from: result.caret.offset, to: result.caret.offset };
        });
    } else if (event.key === 'Backspace' && overlay.input.selectionStart === 0 && overlay.input.selectionEnd === 0) {
        event.preventDefault();
        const id = selection.blockId;
        enqueue(() => {
            const result = joinPreviousTextBlock(session.document, id);
            if (result) {
                session.commit(result.document);
                selection = { blockId: result.caret.blockId, from: result.caret.offset, to: result.caret.offset };
            }
        });
    } else if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const caret = navigation.vertical(
            { blockId: selection.blockId, offset: overlay.input.selectionEnd },
            event.key === 'ArrowUp' ? -1 : 1,
            'downstream',
        );
        if (caret) setSelection(caret.caret.blockId, caret.caret.offset);
    }
}
async function start() {
    kernel = await NativeTextKernel.create();
    overlay = new EditingOverlayView(
        document.body,
        {
            input: { label: 'Edit document text', readonly: true, direction: 'ltr' },
            selection: [],
            find: [],
            peers: [],
            reviews: [],
            templates: [],
            handles: [],
            handleLabels: { start: 'Selection start', end: 'Selection end' },
        },
        {
            focus: updateOverlay,
            blur: updateOverlay,
            input,
            beforeInput(event) {
                if (event.type === 'compositionstart') composing = true;
            },
            key,
            select: updateOverlay,
            copy() {},
            paste() {},
            handleStart() {},
            handleMove() {},
            handleEnd() {},
        },
    );
    for (const button of Object.values(buttons))
        button.addEventListener('pointerdown', (event) => event.preventDefault());
    buttons.undo.onclick = () => enqueue(() => session.undo());
    buttons.redo.onclick = () => enqueue(() => session.redo());
    buttons.bold.onclick = () => {
        const selected = range();
        if (selected.from !== selected.to)
            enqueue(() =>
                session.commit(
                    formatText(
                        session.document,
                        { ...selected, expectedRevision: session.document.revision },
                        { kind: 'toggle', mark: 'bold' },
                    ),
                ),
            );
    };
    buttons.pdf.onclick = async () => {
        buttons.pdf.disabled = true;
        try {
            await pending;
            const bytes = await writeScenePdf(scene, kernel, () => session.document);
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'midad-example.pdf';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 30000);
        } catch (error) {
            reportError(error);
        } finally {
            buttons.pdf.disabled = false;
        }
    };
    window.addEventListener('pagehide', () => {
        views.forEach((view) => view.dispose());
        overlay.dispose();
        kernel.destroy();
    });
    window.addEventListener('scroll', updateOverlay, true);
    window.addEventListener('resize', () => enqueue(() => undefined));
    await render();
}
start().catch(reportError);
