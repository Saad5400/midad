# Midad · مداد

A general-purpose rich document editor engine for the web, with Arabic and bidirectional text, shared canvas layout and PDF output. Midad means “ink”.

Midad is a standalone TypeScript package with no framework, application server, database or company service dependency. Applications own storage, authentication, authorization and external workflows. The engine owns the document, editing operations, text shaping, pagination and rendering.

## Status

Early development. The engine is extracted and tested independently. Reusable browser UI and interaction controllers are still being extracted from the first integration. A complete embeddable editor UI is not released yet.

Canvas and PDF use the same shaped glyphs and page scene. Tests compare the actual PDF glyph identities, positions, dimensions and page counts, including tightly filled pages and nested rich tables. These checks do not establish correctness for every possible document. The target is exact layout and main operations below five seconds.

## Build and test

Node.js 22 or newer:

```sh
npm ci
npm test
npm pack
```

With Poppler's `pdftocairo` available on `PATH`, run `npm run test:pdf-raster` for independent PDF rendering at 288 DPI. It builds the current source, exports fresh PDFs and compares them with fresh editor canvases; existing artifact images are never used as expected results. Missing Poppler fails this command. Poppler is a test tool, not an editor runtime dependency.

The raster checks cover marked Arabic, tight page boundaries, mixed bilingual tables, colored paint and scaled transparent images. Text coordinates and colors are checked directly in the PDF; visible glyph cores must overlap the other raster's antialiased edges within one pixel (0.25 pt). Non-text paint compares local colors with the same spatial limit and accounts for edge blending. Deliberately missing marks and a page number moved by one point must fail. These tolerances account for different rasterizers; this is not a claim of identical antialiasing, complete production-corpus coverage or universal fidelity.

The package is not published to npm yet. Versioned tarballs are attached to [GitHub releases](https://github.com/Saad5400/midad/releases); install a release artifact URL or build and install a local tarball. Applications do not need to commit the binary package to their source repository.

## Per-page setup

Flow documents can override page settings without changing the document defaults:

```ts
import { setPageLayout, clearPageLayout, pageLayoutForPage } from '@saad5400/midad/content/page-layout';

const changed = setPageLayout(document, 2, { orientation: 'landscape' });
const styled = setPageLayout(changed, 3, {
    size: 'letter',
    margins: { left: 48 },
    background: { color: '#f4f7fb' },
    footer: false,
});
const settings = pageLayoutForPage(styled, 3);
const inherited = clearPageLayout(styled, 3);
```

Page numbers are one-based physical pages, including a cover. Overrides inherit document defaults and merge sparse margin changes. Paper sizes are `a3`, `a4`, `a5`, `letter`, `legal`, or custom `{ width, height }` in points; margins use CSS pixels. Backgrounds accept a color and an image `src` with `cover`, `contain`, or `stretch` fitting. The host supplies image access through its existing resolver.

The shared layout reflows continuing text, lists, tables and parallel columns at page geometry changes while keeping document caret/search/review offsets. Canvas and PDF consume the same page boxes and background commands. Existing imported-PDF page geometry remains protected; changing its page size, orientation or source background is not implemented by these flow-page settings yet.

## Engine API

Version 0.9 replaces the mutable `kernel.fontHash` property with `kernel.fontHashFor(document)`. Prepare each document before laying it out; its fingerprint remains valid when another document prepares or exports with the same kernel. `prepareFonts(document)` prepares only fonts, and `fontFingerprint(document)` asynchronously fingerprints an already loaded profile. A new combination of fonts requires preparation even if those font files were loaded for other documents. Host scene caches must compare against the document-specific fingerprint.

When retaining multiple interactive layouts on one kernel, retain their shaped paragraphs with `kernel.retainParagraphs(...)` and release that lease when the layout is discarded. Font assets remain immutable for the kernel's lifetime; create another kernel to use different font bytes. Disposing a kernel waits for all pending preparation branches to settle before freeing native resources, including when one font or image fails.

```ts
import { DocumentSession, importDocument, exportDocument } from '@saad5400/midad/document';

const document = importDocument(
    {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello · مرحبًا' }] }],
    },
    'example',
);
const session = new DocumentSession(document);
const savedContent = exportDocument(session.document);
```

`NativeTextKernel`, `layoutDocument`, `paintPage` and `writeScenePdf` provide shaping, pagination, canvas and PDF rendering. Asset resolvers accept application-provided font and image bytes, allowing browser and server integrations without a specific backend. Bundled asset URLs are exposed through `@saad5400/midad/typography`.

For imported PDFs, derive the fixed source surface before editing overlays:

```ts
import { layoutDocumentSurface } from '@saad5400/midad/layout';
import { createPdfOverlaySnapshot, pdfSourcePages } from '@saad5400/midad/pdf';

const pages = await pdfSourcePages(originalPdfBytes);
await kernel.prepare(document);
const scene = layoutDocumentSurface(document, kernel, { kind: 'pdf', pages });
const snapshot = await createPdfOverlaySnapshot(originalPdfBytes, scene, kernel, () => document, pages);
```

The surface validates the document's protected `pdfPage` sequence against source pages, including mixed sizes, cropping, rotation and PDF scaling. Existing floating field/image commands and shared-document undo/redo work without text paragraphs. Covers, cover objects and letterheads share the canvas/PDF scene while imported body page sizes remain fixed. Snapshots retain original content streams, font/image resources, fields and annotations, and validate overlay transforms against the actual source. They rewrite the PDF file container and do not preserve digital signatures. Custom overlay registration and complete host authoring UI remain in progress.

Use `writePdfOverlayDocument` with the same arguments to retain editable native fields and their document/font identity. `fillNativePdf` then appends values and vector appearances without changing preceding bytes, including on rotated/cropped/scaled pages. `pdfSourceFieldBoxes(scene, pages)` supplies both editor bounds and raw PDF rectangles/page rotation for existing export adapters. Pass native field IDs as the optional second argument of `pdfSourcePages` during preflight to catch field-name conflicts and unresolved original form appearances. Sources marked `NeedAppearances`, or text/choice widgets missing normal appearance streams, require appearance preparation before native fields can be added; the writer refuses to silently freeze stale values.

`preparePdfSourceForms(bytes, openReader)` prepares pending original form appearances through a host-supplied PDF reader, such as PDF.js. It verifies that canonical values, field flags and page geometry are unchanged, and always disposes the reader. Appearance fonts must resolve in the PDF itself; missing standard-font resources are supplied, and unresolved fonts are rejected instead of relying on viewer fallback. Resolved sources return the same byte object without opening a reader. Cache a changed result as a separate immutable source before displaying it or recording its identity. The host retains control of reader assets and transport; Midad adds no PDF.js runtime dependency. Values that the source font cannot encode still raise an error instead of being replaced or dropped.

`PdfDocumentController` in `/browser/view` owns a framework-independent PDF reader session: loading/first-paint readiness, cancellation, source disposal, page geometry, current-page tracking, zoom anchors, navigation, full-text copy and download URLs. `PDF_READER_LABELS` provides Arabic/English reader labels. Hosts supply a PDF parser/source adapter and the rendered page elements; the controller has no Vue, CLM, route or PDF.js dependency. It owns each opened source until replacement/disposal. Call `painted(page, generation)` with the generation captured by that page renderer, and `pageError` for rendering failures. `open()` resolves only when the current page is painted or the five-second attempt fails; a source provider that ignores cancellation cannot leave the caller waiting indefinitely.

```ts
import { PdfDocumentController } from '@saad5400/midad/browser/view';

const reader = new PdfDocumentController({
    load: (signal) => fetchPdfBytes(signal),
    open: (bytes, signal) => openPdfSourceAdapter(bytes, signal),
    viewport: () => viewportElement,
    pagesElement: () => pageContainer,
    afterLayout: () => waitForViewUpdate(),
    changed: (state) => renderReader(state, (page) => reader.painted(page, state.generation)),
});

// renderReader calls its callback only after the page has actually painted.
await reader.open();
await reader.setMode('width');
reader.navigate(2);
reader.dispose();
```

The functions/elements in this binding example are supplied by the host. The source adapter implements `PdfDocumentSource` (`pages`, `bytes`, `plainText`, `destroy`); existing PDF engines can be used without coupling the controller to their worker or authentication setup. This API is the reusable controller layer, not a complete HTML editor or a built-in PDF decoder. The full embeddable editor UI is still being extracted.

`PdfPrintController` in `/browser/view` prints validated, complete PDF bytes through a same-origin PDF frame. Hosts supply the PDF producer, a stable identity that changes with the PDF, readiness and optional callbacks for flushing edits, busy state and errors. It rejects stale responses, coalesces preparation requests, preserves editing focus and aborts stalled preparation after five seconds. The default 60 MiB byte limit is configurable. Each request refreshes its producer by default, since server-owned appearances can change without an editor revision. The optional `reuse` predicate is only for immutable bytes whose identity covers every change. Dispose the controller when its host unmounts to release pending work and owned frame/blob resources. Browsers may retain the loaded frame until a later print request or disposal when they do not emit `afterprint`.

`PrintShortcut` in `/browser/input` connects Ctrl/Cmd+P to a host callback. It chooses the focused visible editor, remembers interaction when focus moves to host controls and excludes hidden/inert editors. Its input binding is independent of PDF transport. Both controllers are framework-independent and must be disposed. Explicit print actions and keyboard handling do not override the browser's native Print menu or arbitrary `window.print()` calls; those paths and full browser/device acceptance remain in progress. A host that displays field overlays must provide the complete PDF with those overlays rather than printing only its original background.

`PagePointerController` in `@saad5400/midad/browser/input` owns mouse, pen and touch gesture state without a UI framework. Hosts supply element, scale and selection callbacks. Renderer fingerprints are derived from source and bundled font bytes during every build; no application build definition is required.

`PageView` in `@saad5400/midad/browser/view` owns a browser page's canvas, sizing, viewport observation, virtualization and repaint lifecycle. It can be mounted directly into an ordinary HTML element; no Vue or CLM component is needed. `ViewportReadiness` waits for current painted content in the actual visible viewport, including a restored scroll position on a later page.

`EditingOverlayView` from `/browser/view` mounts the actual textarea, caret, text/cell selections, touch selection handles, search/review/template highlights, collaborator cursors and block-drop indicator. Its frame contains viewport-relative CSS-pixel rectangles and localized input/handle labels. Bind its synchronous input, composition, keyboard, clipboard, selection and pointer callbacks to your editing controller; `view.input` exposes the stable textarea for text and selection updates. `update(frame)` preserves the focused input, ongoing composition and keyed touch handles. The command input links its listbox and active item through ARIA; closing the palette clears those links. Default styles are included and can use `--midad-caret-color` / `--midad-selection-color`. Call `dispose()` on unmount. This UI view does not own document transactions or persistence; the full editor and toolbar are still being extracted.

`TableResizeView` from the same entrypoint mounts the actual column/row resize controls with their default styles into a positioned page container. Pass the page's `cells`, `rows`, stored row heights, active `tableId`, labels and the page's scale (CSS pixels per scene point). Its `resize` and `resizeRow` callbacks receive scene-point values for the document commands. It supports mouse/pen/touch capture, physical RTL keyboard arrows, minimum column widths, row-height limits, Home for automatic row height and Escape/capture-loss cancellation. `update(frame)` preserves control focus while refreshing immutable scene snapshots; changed geometry cancels an unfinished drag. Call `dispose()` on unmount. Customize the highlight with `--midad-resize-fill` / `--midad-resize-color`. This is a reusable UI control, not the full embeddable editor UI.

Document typography is optional and explicit: `attrs.typography.fontFamily` chooses a bundled family for unmarked document text and page numbers; local font marks keep their own family. Unconfigured documents retain the existing Arial behavior. `initializeDocumentTypography` from `/content/typography` initializes only a blank writing document with Tajawal, preserving its revision and existing settings. `setDocumentTypography` changes/reset defaults through a normal document revision. The same defaults drive measurement, font fingerprints, selection-style queries, PDF output and message HTML. This keeps existing/frozen sources unchanged while allowing new Arabic/Latin documents to avoid per-word fallback.

`DocumentLayoutController` in `/browser/view` owns shared layout preparation, flow-anchor hydration, cached layout identity and native paragraph retention. Supply the current kernel and optional flow/PDF surface getters; `validate` can bind that surface to an authorized source. `prepare(document)` returns a layout with a `release()` lease. `remember(source, prepared)` retains one staged edit, while `display(document, scene)` retains the displayed scene. Release the preparation lease after adoption or rejection; dispose the controller before destroying the kernel. Borrowed views can call `kernel.retain()` and release that lease on unmount; destruction waits for the final borrower and rejects new borrowers once closing. Layout leases preserve the active document’s measurement cache while another view shares the renderer. Cache reuse checks document identity, kernel, fonts and physical writing geometry, so changing an embedded editor's width or PDF page boxes cannot reuse an incompatible scene. At most one staged and one displayed scene are retained. Cached layouts are borrowed; use the preparation lease when keeping one across asynchronous work. Displaying an independently measured scene preserves staged model hydration until that prepared scene is adopted. Host selection, transactions, persistence and controls remain separate. `layout(document, kernel)` also supports a separately owned export kernel without putting it in the display cache.

```ts
import { PageView } from '@saad5400/midad/browser/view';

const view = new PageView(
    hostElement,
    {
        kernel,
        page: scene.pages[0],
        revision: scene.revision,
        scale: 1,
        label: 'Page 1',
    },
    {
        state: (state) => {
            /* update host controls if needed */
        },
        painted: () => {},
        error: (error) => console.error(error),
    },
);
// Pass a new frame after document changes; dispose when the host unmounts.
view.update({ kernel, page: scene.pages[0], revision: scene.revision, scale: 1 });
view.dispose();
```

`layoutPdfOverlays` in `/layout/pdf-overlays` projects document fields and floating images onto externally rendered PDF page boxes. It preserves each source page's size and uses the shared field shaper and painter for values. Normalized positions use their own page dimensions; older absolute pixel positions account for varying page heights and page gaps. Original PDF bytes stay with the host's PDF reader. `objectRegions` in `/layout` supplies the same nested clipping geometry to editable targets and read-only field labels.

`createPdfOverlaySnapshot` in `/pdf` creates a derived print copy from source PDF bytes and an overlay scene. Pass the source reader's unscaled viewport dimensions and six-component PDF-to-viewport transform for each page; this retains placement across rotation, cropping and PDF user units. It retains the original page geometry, form values and annotations, adding the scene above existing annotation appearances. The input bytes remain unchanged. The result is a newly serialized print copy, not an incremental signed revision. Revision and font checks reject stale scenes before returning bytes.

`FrozenFieldSession.previewDocument()` retains one immutable pending document until values change, then advances its revision. Prepare that document with the text kernel before requesting `pendingScene(kernel)`. The scene places the same local field appearances at their frozen page coordinates and includes only pending values; already baked source values remain in the background PDF. Hosts can pass it to `createPdfOverlaySnapshot`, wait for current field preparation, and use the session's latest preview document to reject stale print work. This does not submit fields or modify the stored source.

`PageCanvasController` accepts `transparent: true` for overlay canvases. Its backing storage is bounded by both pixel area and an 8192-pixel maximum side while retaining logical page coordinates. Field geometry queries live separately from mutation commands, so PDF overlays do not load editing code.

`SelectionController` in `@saad5400/midad/browser/input` owns keyboard movement, preferred columns, bidirectional table-cell arrows and repeated scoped Select All. `initialTextCaret` uses rendered page lines, including source offsets in continued paragraphs, without changing the document or taking focus. Keyboard actions marked as composing should be left to the input method.

`writeAtPosition` in `/editing` creates a missing paragraph and applies the first content operation as one undoable revision. No-op and cancelled operations leave the original document untouched. `emptyWritingPosition` in `/browser` locates an empty cell, language column or page without changing stored content; it supplies geometry for a visible caret. Empty container layout reserves the same line space as an explicit empty paragraph.

`DocumentCommandController` in `/browser/commands` tracks slash triggers and deferred actions using host-provided document, selection and permission getters. Its bookmarks snapshot selections, marks and structural anchors; validation accepts unchanged targets after save acknowledgements and rejects changed queries or missing targets. Ending, replacing or resetting a deferred action aborts its `pending.signal`. Hosts commit confirmed content through `runDocumentCommand` in `/editing`; opening or cancelling a picker leaves the document unchanged.

`FragmentContentController` in `/interchange/fragment` adapts embedded rich content while preserving document objects, body arrays, JSON string envelopes, field identities and attachment references. Fragment view settings stay out of stored content. Hosts pass authoritative external changes to `accept`; a matching local acknowledgement keeps the current editing session and undo history. `DocumentContentController` uses the same acknowledgement handling for full documents, retaining edited page settings and document metadata. It seeds a writable paragraph for empty input and always publishes a full document, preserving JSON string envelopes. `fragmentIsEmpty` recognizes structural content as well as text. `fragmentPageHeight` in `/browser/view` sizes embedded page viewports from body geometry.

`insertCapabilities` in `/content/capabilities` describes insertion controls independently for fields, images, tables, clauses and language columns. Hosts can offer rich tables in an explanation editor while keeping document-specific insertion controls elsewhere.

`applyDocumentEdit` in `/document` prepares a candidate before accepting it. Pass the candidate, a current-document getter, a preparation callback and a synchronous acceptance callback. Identity/revision checks run before preparation and immediately before acceptance; failures leave the session untouched. `DocumentEditError.code` distinguishes `INVALID_DOCUMENT_EDIT` from `STALE_DOCUMENT_EDIT`. An optional fifth callback releases prepared resources after acceptance, stale rejection or an acceptance error. Preparation owns cleanup if it throws before returning resources. Keep session/history changes in the synchronous acceptance callback; notify persistence afterward.

`InputQueue` in `/browser/input` preserves the order of captured input and keyboard actions while preparation is asynchronous. Rejected tasks do not prevent later tasks from running. `idle()` waits for the currently queued work. `reset()` skips queued tasks from the previous generation; an already running task still needs the host's disposal and current-document checks.

`NativeTextKernel.retainParagraphs` keeps displayed or staged shaped paragraphs alive while another document is measured. It returns an idempotent release function. Hosts retain the current scene and transfer ownership to its replacement before releasing the old scene. `clearUnused` respects outstanding leases; destroying the kernel releases all native resources even when a lease remains.

`TypingHistory` in `/browser/input` supplies capture tokens for adjacent input events. Pass the token to `DocumentSession.commit`; its boolean return indicates a new undo step. Continuous typing or deletion shares an undo step within 500 ms. Reset the input controller and call `session.stopCapturing()` on pointer actions, navigation, focus changes or other boundaries. Composition, paste and selection replacement remain separate operations.

`composeCommandMenu` merges the built-in `documentCommandMenu` preset with application-provided groups and actions. It preserves callbacks and group order, applies group/item exclusions and availability rules, and rejects duplicate IDs within a group. Application-specific commands and network requests stay in host adapters; both controllers remain independent of a UI framework.

`findText` and `DocumentSearch` in `/editing` search literal text across rich runs and nested blocks, preserve UTF-16 selection offsets, support case and whole-word options, and navigate matches with wrapping. Hosts can pass rendered block IDs to scope results to visible document content. `matchSelection` turns a result into a native selection. `searchRectangles` in `/browser/view` maps matches onto page geometry; pass visible page indices to avoid painting offscreen results. `FindShortcut` in `/browser/input` routes Ctrl/Cmd+F to the focused available editor and releases its listener on disposal. These APIs do not change document content or PDF output.

`NativeSyncClient` in `/collaboration` pauses automatic retries after a rejected draft or malformed sync reply while retaining the local document and undo history. `flush()` explicitly retries the retained request; background focus/reconnect handlers should use `flush(false)`. A corrected rejected draft creates a new request, while retrying unchanged content retains its request ID so an accepted save is not duplicated. Hosts should expose retry and draft-backup actions for error states.

`SharedNativeDocument.publish` and `receive` validate changes in an isolated model before committing to the existing live `Y.Doc` and undo manager. Rejected changes preserve the live state, history, author identity and observers. Unresolved updates stay quarantined until their dependencies produce a valid document; a local edit discards unresolved validation data, and subsequent vector-based synchronization can resend missing peer changes. The validation copy is reused and disposed with the document. `fromState` requires a complete, supported snapshot. Direct mutation through the exposed `ydoc` bypasses these guards.

The engine includes rich text, lists, tables and merged cells, nested language columns, reusable document sections, embedded fields and images, undo/redo, navigation, collaboration primitives and PDF review geometry. Existing serialized format keys remain readable for compatibility; integrations should use the generic document API.

Layout contract 3 paginates oversized merged-cell groups using the remaining physical page space, including nested tables/columns and top/middle/bottom alignment. Continued borders stay closed, and feasible table/language columns respect shaped-glyph minimum widths. Requested column proportions remain unchanged when the content fits. Resizing hosts should pass the current `SceneCell` as the optional sixth argument to `resizeTableColumns`, so edits use the displayed edges and minimum widths. Live editor sessions need a refresh when adopting a changed rendering contract; frozen PDF bytes remain authoritative.

Layout contract 4 adds table-row minimum heights through `setTableRowHeight(document, tableId, rowId, heightPx)`. Pass `null` for automatic height. Rows expand to fit their content and paginate when necessary. `ScenePage.tableRows` supplies immutable physical fragments, logical row IDs/indexes and final-fragment markers for mouse, touch and keyboard controls. HTML clipboard output retains row heights. Existing contract-3 scene goldens remain unchanged.

Table UI behavior is renderer-independent. `tableControlMenu` describes action groups/states, `applyTableControlAction` produces immutable edits and caret targets, and `tableControlFrame`/`tableHandleBoxes` project controls from the paginated scene. Hosts supply labels, icons and themed components. `SurfaceFocusIntent` cancels deferred focus restoration after a newer interaction. These APIs are available through the existing browser command, view and input entrypoints and require no Vue or application services.

The PDF writer reuses compatible opaque text setup and exact binary-grid text moves. Font switches retain absolute anchors for consistent raster placement. Reading dictionaries keep every source span, text value and bounding box; Unicode boundary indexes are shared between shaping and review mapping.

Independent raster checks still flag color differences at some translucent table intersections. Covered glyph positions, vector colors/opacities and live canvas content are verified separately; these results do not establish universal raster parity.

## Node task runtime

`@saad5400/midad/node` provides a Node.js 22 worker pool and private Unix-socket transport. Hosts supply their task handler, asset authorization and runtime identity. Browser entrypoints do not load these Node APIs.

A worker module registers a handler after any startup preparation:

```ts
import { serveTaskWorker } from '@saad5400/midad/node';

serveTaskWorker(async (payload) => handleTask(payload));
```

Start the pool and socket in a private directory owned by the service user:

```ts
import { TaskPool, TaskService, callTaskService } from '@saad5400/midad/node';

const pool = new TaskPool({ worker: new URL('./worker.mjs', import.meta.url), workers: 2 });
const service = await TaskService.open({ path: socketPath, identity: runtimeIdentity, pool });
const result = await callTaskService({
    path: socketPath,
    identity: runtimeIdentity,
    affinity: documentId,
    payload: task,
    budgetMs: 5000,
});
await service.close();
await pool.close();
```

The host defines `handleTask`, `socketPath`, `runtimeIdentity`, `documentId` and `task`. Requests use JSON values with a four-byte big-endian length prefix and protocol version 1. The socket has mode 0600; its parent directory must be private and owned by the service user. Existing socket-path files are preserved and cause startup to fail. Close the service before its pool; graceful shutdown releases the socket for an explicit restart.

Deadlines include queue time. Cancelling or timing out active work terminates and replaces its worker, preventing late task execution; cancelling queued work preserves the active worker. Handled application failures keep the worker, while crashes and invalid responses replace it. Queues, queued bytes, clients and input/output frame sizes are bounded. `affinity` prefers an idle worker that last handled the same key while other available workers can continue serving work. Workers recycle after a configurable number of jobs. `resourceLimits` controls V8 heap limits; applications must size and verify their renderer's additional native/WASM memory.

`TaskError.code` distinguishes application failures, unavailable workers, overload, cancellation, deadlines and runtime-identity mismatches. A host should retain unsaved input when the runtime is unavailable. These primitives do not provide application authentication, persistence or a collaboration broadcast broker.

## Source organization

Source modules and their corresponding tests share these boundaries:

| Directory        | Responsibility                                                           | Package entrypoint                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `document/`      | Immutable model, JSON codec, identities and undo session                 | `/document`                                                                                                                                                  |
| `typography/`    | Text styles, direction, font registry and font assets                    | `/typography`                                                                                                                                                |
| `editing/`       | Text, selection, formatting, blocks, lists and table commands            | `/editing`                                                                                                                                                   |
| `content/`       | Fields, language columns, clauses, images and page settings              | `/content/fields`, `/content/bilingual`, `/content/clauses`, `/content/images`, `/content/page-layout`, `/content/presentation`, `/content/floating-anchors` |
| `rendering/`     | Text shaping, document font loading, media and canvas painting           | `/rendering`                                                                                                                                                 |
| `layout/`        | Scene contracts, block measurement, pagination, hit testing and outline  | `/layout`                                                                                                                                                    |
| `pdf/`           | Scene export, incremental filling, field appearances and review geometry | `/pdf`                                                                                                                                                       |
| `browser/`       | Independent input, page views and command menu controllers               | `/browser/input`, `/browser/view`, `/browser/commands`                                                                                                       |
| `collaboration/` | Shared document state, synchronization and presence                      | `/collaboration`                                                                                                                                             |
| `interchange/`   | Clipboard, messages, history comparison and persistence coordination     | `/interchange`                                                                                                                                               |
| `compat/`        | Compatibility bridges for earlier package entrypoints                    | Existing aliases only                                                                                                                                        |

Entrypoints are prefixed with `@saad5400/midad`. Start with the subsystem you need; the root is a convenience API. Earlier individual paths remain compatibility aliases.

The larger subsystems have private implementation boundaries:

```text
browser/
  input/       mouse, touch, keyboard, selection, focus and autoscroll
  view/        canvas lifecycle, page virtualization and viewport
  commands/    menu composition, slash triggers, placeholders and deferred actions
collaboration/
  document.ts  public document lifecycle, transactions, undo and relative carets
  client.ts    synchronization, acknowledgements, conflicts and editor transactions
  sync/        protocol contracts, request deadlines, relative selections and presence
  values.ts    shared attribute and byte encoding
  shared/      private CRDT store, tree writer, inline synchronization and decoder
interchange/
  clipboard.ts public copy/paste coordination
  clipboard/   private selection extraction, format codecs and insertion
rendering/
  kernel.ts    public resource lifecycle, preparation and shape cache
  text/        font resources, shaping algorithm and shaped-text contracts
content/
  clauses/     read-only queries and mutation commands in separate modules
```

The rendering kernel coordinates resource lifetime and caches shaped paragraphs. `text/fonts.ts` owns native typefaces, the font collection and fingerprints; `text/shaping.ts` converts styled spans into shared glyph geometry; `text/model.ts` defines that geometry without loading CanvasKit. Layout imports only those contracts and receives its kernel from the caller. Numerical rounding lives in `typography/metrics.ts`, so importing pagination or the canvas painter does not load the text engine, PDF writer or collaboration runtime.

`layout/table-flow.ts` resolves oversized row-span groups against the available physical page space and preserves their nested flow, cell alignment and continuation geometry.

The sync client coordinates document synchronization and acknowledgement state. `sync/contracts.ts` defines the host protocol, `sync/requests.ts` owns deadlines and transport failures, `sync/selection.ts` captures and restores relative selections, and `sync/presence.ts` owns its peer cache, identity, heartbeat and disposal. These private modules never import the client coordinator. Existing public kernel and sync entrypoints re-export their original contracts for compatibility.

`SharedNativeDocument` uses `SHARED_DOCUMENT_SCHEMA` for ephemeral live state. Protocol 3 preserves joined text histories and paragraph-end affinity, and rejects incompatible binary states; the document JSON format is unchanged. Hosts must recover pending edits before reseeding a live session from saved JSON during a protocol upgrade.

Each module owns its state explicitly. Collaboration composes a shared store and writer; the decoder reads that store without depending on the writer or public lifecycle. Clipboard codecs do not depend on selection extraction or insertion. Browser input, views and menus can be consumed independently and do not import one another.

The document foundation owns read-only tree/text queries and has no renderer, browser or collaboration dependency. Field, clause and presentation queries are separate from mutation commands; font loading, media loading and PDF rendering read fields without importing the editing implementation. Typography builds on the document model, editing builds on those foundations, and content features build on editing. Rendering loads fonts and media for content; layout produces a shared scene; browser controls and PDF output consume that scene. Collaboration and interchange operate on documents and editing commands. Type-only references to scene geometry and shaped text do not load either renderer. Internal code imports implementation files directly rather than routing through unrelated public facades.

Layout has a private pipeline behind `/layout`:

- `text.ts`, `columns.ts` and `tables.ts` measure their own content into pagination bands. Columns and tables receive a typed child-measurement callback, so nested content does not introduce circular imports.
- `measurement.ts` dispatches node types and owns the per-kernel measurement cache. `context.ts` carries direction, available space and the resources used by a measurement.
- `bands.ts` owns splitting and track composition. `pages.ts` places measured bands on pages, resolves floating objects and adds covers, headers and page numbers.
- `finalize.ts` freezes scene output, merges adjacent interaction regions and orders table backgrounds. Canvas and PDF consume the resulting scene through their existing APIs.

`tests/Architecture.test.ts` enforces dependency direction, private layout, text-rendering and collaboration stages, renderer-free layout loading, independent browser areas, clipboard codec boundaries, resolvable local imports and an acyclic runtime graph. It also prevents implementation files from importing public barrels. `tests/PackageBoundary.test.ts` verifies package exports, compatibility aliases, bundled font URLs and clean deterministic builds. Tests are grouped by subsystem; `tests/fixtures/` holds shared rich-document and PDF geometry fixtures.

The package exposes an explicit export map. Implementation files such as `layout/measurement.ts` are private. Earlier flat entrypoints remain explicit compatibility aliases to the same implementations, allowing existing integrations to upgrade without duplicating the engine. New integrations should use the subsystem entrypoints above. Build output is cleared before compilation so moved or deleted modules cannot leak into a package.

## Independence

Reusable layout, editing, rendering, interaction and UI behavior belong here. Host adapters provide persistence, permissions, asset access, domain libraries and external actions. CLM is the first consumer, not a runtime requirement. No CLM application code or private documents are included.

## License

Engine source: MIT. Third-party dependencies and bundled fonts retain their own licenses. Font notices, license texts and the corresponding Liberation source archive are included under `assets/fonts/`; CanvasKit notices are in `assets/LICENSE-canvaskit`. One unused font without clear redistribution terms was excluded from this repository.

`LAYOUT_COMPATIBILITY_ID` and `LAYOUT_VERSION` in `/version` identify the rendering contract. The default `NATIVE_RENDERER_VERSION` uses that compatibility ID; `RENDERER_BUILD_VERSION` identifies the full SDK source/dependency build for diagnostics. UI, search, collaboration-only and package-version changes preserve layout compatibility when the rendered scenes, assets and rendering dependencies are unchanged. Hosts must version their own layout transformations and include their rendering dependencies and custom font/WASM inputs in their compatibility ID. The Node-only `/build` entrypoint provides `dependencyIdentity` for resolved dependency graphs.

Rendering changes require review of `midad.layoutVersion` and the reference scenes in `tests/fixtures/layout-golden.json`. Regenerate deliberately with `UPDATE_LAYOUT_GOLDEN=1 npx vitest run tests/rendering/LayoutCompatibility.test.ts`, review the full scene differences, then rebuild. The fixture digest is part of the compatibility ID, so changing a baseline changes compatibility even if a version increment is accidentally omitted. `npm pack` runs the reference-scene test and refuses unaccepted drift; CI cannot regenerate its own goldens. These fixtures guard a representative corpus and do not replace independent PDF raster verification or schema/protocol migrations.

The compatibility corpus stores frozen input documents as well as scene hashes. Routine test-helper changes and new coverage elsewhere do not change the declared rendering contract. Keep these reference inputs fixed when reviewing renderer drift; extend independent regression/raster tests for new coverage.

The layout fingerprint also covers the executable dependency closure of `midad.layoutEntries` (layout, shaping, canvas painting, document codecs and PDF output). Type-only imports, comments, UI/search/collaboration modules and generated version definitions are excluded. Rendering dependencies are resolved from the packages used by that closure. The Node-only `renderingIdentity` helper uses the existing TypeScript build dependency to identify host adapter code; it is not loaded by the browser or normal rendering runtime.
