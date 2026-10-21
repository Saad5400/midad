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
import { DocumentSession, importDocument, exportDocument } from '@saad5400/midad';

const document = importDocument({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello · مرحبًا' }] }],
}, 'example');
const session = new DocumentSession(document);
const savedContent = exportDocument(session.document);
```

`NativeTextKernel`, `layoutDocument`, `paintPage` and `writeScenePdf` provide shaping, pagination, canvas and PDF rendering. Asset resolvers accept application-provided font and image bytes, allowing browser and server integrations without a specific backend. Bundled asset URLs are exposed through `@saad5400/midad/font-assets`.

`PagePointerController` in `@saad5400/midad/browser/page-pointer` owns mouse, pen and touch gesture state without a UI framework. Hosts supply element, scale and selection callbacks. Renderer fingerprints are derived from source and bundled font bytes during every build; no application build definition is required.

The engine includes rich text, lists, tables and merged cells, nested language columns, reusable document sections, embedded fields and images, undo/redo, navigation, collaboration primitives and PDF review geometry. Existing serialized format keys remain readable for compatibility; integrations should use the generic document API.

## Independence

Reusable layout, editing, rendering, interaction and UI behavior belong here. Host adapters provide persistence, permissions, asset access, domain libraries and external actions. CLM is the first consumer, not a runtime requirement. No CLM application code or private documents are included.

## License

Engine source: MIT. Third-party dependencies and bundled fonts retain their own licenses. Font notices, license texts and the corresponding Liberation source archive are included under `assets/fonts/`; CanvasKit notices are in `assets/LICENSE-canvaskit`. One unused font without clear redistribution terms was excluded from this repository.
