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

The package is not published to npm yet. Build locally and install the resulting tarball into your application.

## Engine API

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

`PagePointerController` in `@saad5400/midad/browser/input` owns mouse, pen and touch gesture state without a UI framework. Hosts supply element, scale and selection callbacks. Renderer fingerprints are derived from source and bundled font bytes during every build; no application build definition is required.

`PageView` in `@saad5400/midad/browser/view` owns a browser page's canvas, sizing, viewport observation, virtualization and repaint lifecycle. It can be mounted directly into an ordinary HTML element; no Vue or CLM component is needed. `ViewportReadiness` waits for current painted content in the actual visible viewport, including a restored scroll position on a later page.

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

`PageCanvasController` accepts `transparent: true` for overlay canvases. Its backing storage is bounded by both pixel area and an 8192-pixel maximum side while retaining logical page coordinates. Field geometry queries live separately from mutation commands, so PDF overlays do not load editing code.

`SelectionController` in `@saad5400/midad/browser/input` owns keyboard movement, preferred columns, bidirectional table-cell arrows and repeated scoped Select All. `initialTextCaret` uses rendered page lines, including source offsets in continued paragraphs, without changing the document or taking focus. Keyboard actions marked as composing should be left to the input method.

`writeAtPosition` in `/editing` creates a missing paragraph and applies the first content operation as one undoable revision. No-op and cancelled operations leave the original document untouched. `emptyWritingPosition` in `/browser` locates an empty cell, language column or page without changing stored content; it supplies geometry for a visible caret. Empty container layout reserves the same line space as an explicit empty paragraph.

`DocumentCommandController` in `/browser/commands` tracks slash triggers and deferred actions using host-provided document, selection and permission getters. Its bookmarks snapshot selections, marks and structural anchors; validation accepts unchanged targets after save acknowledgements and rejects changed queries or missing targets. Ending, replacing or resetting a deferred action aborts its `pending.signal`. Hosts commit confirmed content through `runDocumentCommand` in `/editing`; opening or cancelling a picker leaves the document unchanged.

`FragmentContentController` in `/interchange/fragment` adapts embedded rich content while preserving document objects, body arrays, JSON string envelopes, field identities and attachment references. Fragment view settings stay out of stored content. Hosts pass authoritative external changes to `accept`; a matching local acknowledgement keeps the current editing session and undo history. `fragmentIsEmpty` recognizes structural content as well as text. `fragmentPageHeight` in `/browser/view` sizes embedded page viewports from body geometry.

`insertCapabilities` in `/content/capabilities` describes insertion controls independently for fields, images, tables, clauses and language columns. Hosts can offer rich tables in an explanation editor while keeping document-specific insertion controls elsewhere.

`TypingHistory` in `/browser/input` supplies capture tokens for adjacent input events. Pass the token to `DocumentSession.commit`; its boolean return indicates a new undo step. Continuous typing or deletion shares an undo step within 500 ms. Reset the input controller and call `session.stopCapturing()` on pointer actions, navigation, focus changes or other boundaries. Composition, paste and selection replacement remain separate operations.

`composeCommandMenu` merges the built-in `documentCommandMenu` preset with application-provided groups and actions. It preserves callbacks and group order, applies group/item exclusions and availability rules, and rejects duplicate IDs within a group. Application-specific commands and network requests stay in host adapters; both controllers remain independent of a UI framework.

The engine includes rich text, lists, tables and merged cells, nested language columns, reusable document sections, embedded fields and images, undo/redo, navigation, collaboration primitives and PDF review geometry. Existing serialized format keys remain readable for compatibility; integrations should use the generic document API.

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
  client.ts    host transport coordination
  values.ts    shared attribute and byte encoding
  shared/      private CRDT store, tree writer, inline synchronization and decoder
interchange/
  clipboard.ts public copy/paste coordination
  clipboard/   private selection extraction, format codecs and insertion
content/
  clauses/     read-only queries and mutation commands in separate modules
```

Each module owns its state explicitly. Collaboration composes a shared store and writer; the decoder reads that store without depending on the writer or public lifecycle. Clipboard codecs do not depend on selection extraction or insertion. Browser input, views and menus can be consumed independently and do not import one another.

The document foundation owns read-only tree/text queries and has no renderer, browser or collaboration dependency. Field, clause and presentation queries are separate from mutation commands; font loading, media loading and PDF rendering read fields without importing the editing implementation. Typography builds on the document model, editing builds on those foundations, and content features build on editing. Rendering loads fonts and media for content; layout produces a shared scene; browser controls and PDF output consume that scene. Collaboration and interchange operate on documents and editing commands. Type-only references to scene geometry and shaped text do not load either renderer. Internal code imports implementation files directly rather than routing through unrelated public facades.

Layout has a private pipeline behind `/layout`:

- `text.ts`, `columns.ts` and `tables.ts` measure their own content into pagination bands. Columns and tables receive a typed child-measurement callback, so nested content does not introduce circular imports.
- `measurement.ts` dispatches node types and owns the per-kernel measurement cache. `context.ts` carries direction, available space and the resources used by a measurement.
- `bands.ts` owns splitting and track composition. `pages.ts` places measured bands on pages, resolves floating objects and adds covers, headers and page numbers.
- `finalize.ts` freezes scene output, merges adjacent interaction regions and orders table backgrounds. Canvas and PDF consume the resulting scene through their existing APIs.

`tests/Architecture.test.ts` enforces dependency direction, private layout and collaboration stages, independent browser areas, clipboard codec boundaries, resolvable local imports and an acyclic runtime graph. It also prevents implementation files from importing public barrels. `tests/PackageBoundary.test.ts` verifies package exports, compatibility aliases, bundled font URLs and clean deterministic builds. Tests are grouped by subsystem; `tests/fixtures/` holds shared rich-document and PDF geometry fixtures.

The package exposes an explicit export map. Implementation files such as `layout/measurement.ts` are private. Earlier flat entrypoints remain explicit compatibility aliases to the same implementations, allowing existing integrations to upgrade without duplicating the engine. New integrations should use the subsystem entrypoints above. Build output is cleared before compilation so moved or deleted modules cannot leak into a package.

## Independence

Reusable layout, editing, rendering, interaction and UI behavior belong here. Host adapters provide persistence, permissions, asset access, domain libraries and external actions. CLM is the first consumer, not a runtime requirement. No CLM application code or private documents are included.

## License

Engine source: MIT. Third-party dependencies and bundled fonts retain their own licenses. Font notices, license texts and the corresponding Liberation source archive are included under `assets/fonts/`; CanvasKit notices are in `assets/LICENSE-canvaskit`. One unused font without clear redistribution terms was excluded from this repository.
