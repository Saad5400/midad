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

`PagePointerController` in `@saad5400/midad/browser/page-pointer` owns mouse, pen and touch gesture state without a UI framework. Hosts supply element, scale and selection callbacks. Renderer fingerprints are derived from source and bundled font bytes during every build; no application build definition is required.

`PageView` in `@saad5400/midad/browser/page-view` owns a browser page's canvas, sizing, viewport observation, virtualization and repaint lifecycle. It can be mounted directly into an ordinary HTML element; no Vue or CLM component is needed. `ViewportReadiness` waits for current painted content in the actual visible viewport, including a restored scroll position on a later page.

```ts
import { PageView } from '@saad5400/midad/browser/page-view';

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

`SelectionController` in `@saad5400/midad/browser` owns keyboard movement, preferred columns, bidirectional table-cell arrows and repeated scoped Select All. `initialTextCaret` uses rendered page lines, including source offsets in continued paragraphs, without changing the document or taking focus. Keyboard actions marked as composing should be left to the input method.

`writeAtPosition` in `/editing` creates a missing paragraph and applies the first content operation as one undoable revision. No-op and cancelled operations leave the original document untouched. `emptyWritingPosition` in `/browser` locates an empty cell, language column or page without changing stored content; it supplies geometry for a visible caret. Empty container layout reserves the same line space as an explicit empty paragraph.

The engine includes rich text, lists, tables and merged cells, nested language columns, reusable document sections, embedded fields and images, undo/redo, navigation, collaboration primitives and PDF review geometry. Existing serialized format keys remain readable for compatibility; integrations should use the generic document API.

## Source organization

Source modules and their corresponding tests share these boundaries:

| Directory        | Responsibility                                                            | Package entrypoint                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `document/`      | Immutable model, JSON codec, identities and undo session                  | `/document`                                                                                                                                                  |
| `typography/`    | Text styles, direction, font registry and font assets                     | `/typography`                                                                                                                                                |
| `editing/`       | Text, selection, formatting, blocks, lists and table commands             | `/editing`                                                                                                                                                   |
| `content/`       | Fields, language columns, clauses, images and page settings               | `/content/fields`, `/content/bilingual`, `/content/clauses`, `/content/images`, `/content/page-layout`, `/content/presentation`, `/content/floating-anchors` |
| `rendering/`     | Text shaping, document font loading, media and canvas painting            | `/rendering`                                                                                                                                                 |
| `layout/`        | Scene contracts, hit testing, pagination bands, document flow and outline | `/layout`                                                                                                                                                    |
| `pdf/`           | Scene export, incremental filling, field appearances and review geometry  | `/pdf`                                                                                                                                                       |
| `browser/`       | Page lifecycle, viewport readiness, pointer and keyboard interactions     | `/browser`                                                                                                                                                   |
| `collaboration/` | Shared document state, synchronization and presence                       | `/collaboration`                                                                                                                                             |
| `interchange/`   | Clipboard, messages, history comparison and persistence coordination      | `/interchange`                                                                                                                                               |
| `compat/`        | Compatibility bridges for earlier package entrypoints                     | Existing aliases only                                                                                                                                        |

Entrypoints are prefixed with `@saad5400/midad`. Use scoped entrypoints to select a subsystem; the root remains a convenience API. Small browser controllers also retain individual entrypoints such as `/browser/page-pointer` and `/browser/page-view`.

The document foundation has no renderer, browser or collaboration dependency. Typography builds on the document model, editing builds on those foundations, and content features build on editing. Rendering loads fonts and media for content; layout produces a shared scene; browser controls and PDF output consume that scene. Collaboration and interchange operate on documents and editing commands. Type-only references to scene geometry and shaped text do not load either renderer. Internal code imports implementation files directly rather than routing through unrelated public facades.

`tests/Architecture.test.ts` enforces dependency direction, resolvable local imports and an acyclic runtime graph. `tests/PackageBoundary.test.ts` verifies package exports, compatibility aliases, bundled font URLs and clean deterministic builds. Tests are grouped by subsystem; `tests/fixtures/` holds shared rich-document and PDF geometry fixtures.

The package exposes an explicit export map. Implementation files such as `layout/flow.ts` are private. Earlier flat entrypoints remain explicit compatibility aliases to the same implementations, allowing existing integrations to upgrade without duplicating the engine. New integrations should use the subsystem entrypoints above. Build output is cleared before compilation so moved or deleted modules cannot leak into a package.

## Independence

Reusable layout, editing, rendering, interaction and UI behavior belong here. Host adapters provide persistence, permissions, asset access, domain libraries and external actions. CLM is the first consumer, not a runtime requirement. No CLM application code or private documents are included.

## License

Engine source: MIT. Third-party dependencies and bundled fonts retain their own licenses. Font notices, license texts and the corresponding Liberation source archive are included under `assets/fonts/`; CanvasKit notices are in `assets/LICENSE-canvaskit`. One unused font without clear redistribution terms was excluded from this repository.
