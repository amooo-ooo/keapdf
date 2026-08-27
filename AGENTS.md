# AGENTS.md — PDF Editor

A browser-native PDF editor built with **Svelte 5**, **TypeScript**, **Tailwind CSS v4**,
and the **PDFium** WebAssembly engine. All PDF parsing, rendering, and mutation
happens client-side — no server round-trips.

---

## Environment Setup

- **Runtime**: [Bun](https://bun.sh/) is the package manager and script runner.
  The lockfile is `bun.lock`. Never use `npm`, `yarn`, or `pnpm`.
- **Install dependencies**: `bun install`
- **Dev server**: `bun run dev` (Vite on `http://localhost:3000`, auto-opens browser)
- **Type-check**: `bunx svelte-check` (runs `svelte-check`)
- **Production build**: `bun run build` (runs `svelte-check && vite build`)
- **Preview build**: `bun run preview`
- **Deploy**: `bun run deploy` (builds then deploys to Cloudflare Pages via Wrangler)
- There is **no test framework** configured yet. When tests are added, prefer
  Vitest with Bun as the runner. Follow TDD: write the failing test first,
  then implement to green.

## Commands

| Command              | Description                                           |
|----------------------|-------------------------------------------------------|
| `bun install`        | Install all dependencies                              |
| `bun run dev`        | Start Vite dev server on port 3000                    |
| `bun run build`      | Type-check with `svelte-check`, then `vite build`     |
| `bun run preview`    | Preview production build locally                      |
| `bun run deploy`     | Build and deploy to Cloudflare Pages                  |
| `bunx svelte-check`  | Run TypeScript and Svelte diagnostics                 |

---

## Technology Stack

| Layer          | Technology                                        | Version / Notes                     |
|----------------|---------------------------------------------------|-------------------------------------|
| Framework      | Svelte 5                                          | Runes (`$state`, `$derived`, `$effect`), Snippets API |
| Language       | TypeScript                                        | `target: ES2022`, strict mode       |
| Styling        | Tailwind CSS v4 + `tw-animate-css`                | OKLCH color tokens, `@theme inline` |
| UI Kit         | shadcn-svelte (Rhea style)                        | `bits-ui`, `tailwind-variants`      |
| Icons          | Lucide Svelte                                     | Tree-shakeable SVG icons            |
| Bundler        | Vite 5                                            | Svelte plugin + Tailwind plugin     |
| PDF Engine     | `@embedpdf/pdfium` (PDFium WASM)                  | Client-side rendering and mutation  |
| PDF Lib        | `pdf-lib`                                         | AcroForm fields, page transforms    |
| Layout         | `paneforge`                                       | Resizable split-pane panels         |
| Fonts          | Inter Variable (self-hosted woff2)                | Preloaded in `index.html`           |
| Deployment     | Cloudflare Pages (Wrangler)                       | SPA fallback, static assets         |
| Package Mgr    | Bun                                               | `bun.lock` committed                |

---

## Repository Structure

```
pdf-editor/
├── index.html                     # HTML entry — preloads WASM + Inter font
├── package.json                   # Dependencies and scripts
├── bun.lock                       # Bun lockfile (committed)
├── vite.config.ts                 # Vite config: aliases, chunk splitting, WASM
├── svelte.config.js               # Svelte preprocessor (vitePreprocess)
├── tsconfig.json                  # TS strict mode, path aliases ($lib)
├── components.json                # shadcn-svelte component registry config
├── wrangler.toml                  # Cloudflare Pages deployment config
├── public/
│   ├── pdfium.wasm                # PDFium WebAssembly binary (~4.6 MB)
│   ├── sample.pdf                 # Default sample document
│   ├── favicon.svg                # App favicon
│   ├── icons.svg                  # Shared SVG sprite sheet
│   ├── fonts/
│   │   ├── InterVariable.woff2
│   │   └── InterVariable-Italic.woff2
│   └── cursors/                   # Custom SVG cursor set
│       ├── Arrow.svg, Pointer.svg, Grab.svg, Grabbed.svg, ...
│       ├── Resize/                # Directional resize cursors
│       └── Rotate/                # Corner rotation cursors
└── src/
    ├── main.ts                    # App bootstrap — mounts Svelte root
    ├── App.svelte                 # Root component — wires stores, services, layout
    ├── app.css                    # Tailwind entry, design tokens, component classes
    ├── vite-env.d.ts              # Vite client type reference
    │
    ├── core/                      # Low-level PDFium WASM interop
    │   ├── pdfium-engine.ts       # Singleton WASM engine, memory management
    │   ├── pdfium-helpers.ts      # UTF-16LE encoding, matrix ops, font metrics
    │   └── types.ts               # Core domain types (spans, render options, etc.)
    │
    ├── services/                  # Business logic and PDF operations
    │   ├── pdf-editor.ts          # Workspace manager, canvas-to-PDF baking
    │   ├── font-loader.ts         # Dynamic Google Fonts loader
    │   └── pdf/                   # PDF document facade
    │       ├── pdf-document.ts    # Document-level ops, LRU page cache, save
    │       ├── pdf-page.ts        # Per-page rendering, extraction, drawing
    │       ├── font-charset-index.ts  # Font glyph availability index
    │       ├── utils.ts           # Color parsing, transform matrix builder
    │       └── operations/        # Atomic low-level PDFium operations
    │           ├── types.ts       # DrawOptions, ShapeOptions, TextOptions, etc.
    │           ├── document-ops.ts    # Merge, split, reorder, delete, blank page
    │           ├── page-ops.ts        # Render, rotate, flatten, export blob
    │           ├── text-edit-ops.ts   # Text extraction, replace, reflow, delete
    │           ├── metadata-ops.ts    # Annotations, bookmarks, metadata, signatures
    │           ├── draw-text.ts       # Draw text with standard fonts
    │           ├── draw-shapes.ts     # Rectangle, circle, line, arrow, path
    │           ├── draw-image.ts      # Embed bitmap images
    │           ├── draw-form-field.ts # Form field placeholder rendering
    │           └── add-annotations.ts # Highlight and ink annotations
    │
    ├── stores/                    # Reactive state management (Svelte 5 runes)
    │   ├── editor.svelte.ts       # EditorStore — document, nav, UI panel state
    │   ├── editor-actions.ts      # EditorActions — all document/workspace mutations
    │   ├── canvas.svelte.ts       # CanvasStore — overlay elements, selection, drag
    │   ├── canvas-actions.ts      # CanvasActions — create/update/delete elements
    │   ├── canvas-types.ts        # CanvasElement union, DragState, defaults
    │   ├── history.svelte.ts      # HistoryStore — undo/redo state stacks, debouncing
    │   ├── history-types.ts       # HistorySnapshot, FileHistoryState, snapshot options
    │   ├── selection.svelte.ts    # SelectionStore — multi-select with Ctrl/Shift
    │   └── types.ts               # EditorTool, LeftPanelMode, InlineEditState
    │
    ├── components/                # UI components (feature-grouped)
    │   ├── canvas/                # Viewport and page rendering
    │   │   ├── Canvas.svelte          # Scrollable viewport, zoom, drag-and-drop
    │   │   ├── PdfPageView.svelte     # Single page: canvas render + text layer + overlays
    │   │   ├── CanvasElement.svelte    # Draggable/resizable overlay element
    │   │   ├── CanvasElementLayer.svelte  # Per-page element container
    │   │   ├── SelectionOverlay.svelte    # Figma-style selection box + handles
    │   │   └── FloatingPageIndicator.svelte  # Scroll-position page badge
    │   │
    │   ├── layout/                # App shell and panel structure
    │   │   ├── EditorShell.svelte     # CSS Grid shell with snippet slots
    │   │   ├── NavRail.svelte         # Left icon navigation rail
    │   │   ├── LeftPanel.svelte       # Collapsible left sidebar (workspace/tools)
    │   │   └── RightPanel.svelte      # Collapsible right sidebar (properties)
    │   │
    │   ├── panels/                # Sidebar panel content
    │   │   ├── PageOrganizerPanel.svelte   # Drag-reorder page thumbnails
    │   │   ├── ComponentsPanel.svelte      # Drag-to-canvas element palette
    │   │   ├── AnnotatePanel.svelte        # Drawing and annotation tools
    │   │   ├── ToolsPanel.svelte           # Document-level tools (merge, split, etc.)
    │   │   ├── SettingsPanel.svelte        # Document metadata and settings
    │   │   ├── DocumentMetadataPanel.svelte # PDF metadata display
    │   │   ├── PageThumbnail.svelte        # Individual page thumbnail card
    │   │   ├── PageThumbnailStrip.svelte   # Horizontal thumbnail strip
    │   │   ├── TextPropertiesPanel.svelte  # Text span property editor
    │   │   ├── ElementPropertiesPanel.svelte  # Canvas element property router
    │   │   ├── PagePropertiesPanel.svelte  # Page-level property display
    │   │   ├── element-properties/        # Element property sub-panels
    │   │   │   ├── ActionsSection.svelte
    │   │   │   ├── FormFieldSection.svelte
    │   │   │   ├── ImageSection.svelte
    │   │   │   ├── PositionSizeSection.svelte
    │   │   │   ├── ShapeSection.svelte
    │   │   │   ├── TextSection.svelte
    │   │   │   └── TransformSection.svelte
    │   │   ├── page-properties/           # Page property sub-panels
    │   │   │   ├── ActionsSection.svelte
    │   │   │   ├── ImpositionSection.svelte
    │   │   │   └── TransformSection.svelte
    │   │   └── text-properties/           # Text span property sub-panels
    │   │       ├── ActionsSection.svelte
    │   │       ├── ContentSection.svelte
    │   │       └── TypographySection.svelte
    │   │
    │   ├── common/                # Shared reusable components
    │   │   ├── DraggableListItem.svelte
    │   │   ├── PageThumbnailImage.svelte
    │   │   └── SidebarSection.svelte
    │   │
    │   └── dialogs/               # Modal dialogs
    │       ├── SplitPagesDialog.svelte
    │       ├── ExportImagesDialog.svelte
    │       └── ToolMockupDialog.svelte
    │
    ├── lib/                       # shadcn-svelte primitives
    │   ├── utils.ts               # cn() helper (clsx + tailwind-merge)
    │   ├── hooks/
    │   │   └── use-drag.svelte.ts # Generic drag interaction hook
    │   └── components/ui/         # shadcn-svelte component library
    │       ├── badge/
    │       ├── button/
    │       ├── dialog/
    │       ├── dropdown-menu/
    │       ├── input/
    │       ├── label/
    │       ├── resizable/
    │       ├── scroll-area/
    │       ├── select/
    │       ├── separator/
    │       ├── slider/
    │       ├── tabs/
    │       ├── toggle/
    │       ├── toggle-group/
    │       └── tooltip/
    │
    ├── utils/                     # Pure utility functions
    │   ├── geometry.ts            # Rect math, screen-to-page coords, resize logic
    │   ├── keyboard-shortcuts.ts  # Global keyboard shortcut handler
    │   └── download-utils.ts      # Blob/byte download triggers
    │
    └── styles/
        └── main.css               # Legacy base styles (being migrated to app.css)
```

---

## Architecture

### Layered Architecture

The codebase follows a strict layered architecture. Dependencies flow
downward only — upper layers import from lower layers, never the reverse.

```
┌──────────────────────────────────────────────┐
│  Components (*.svelte)                       │  UI / Presentation
│    canvas/ | layout/ | panels/ | dialogs/    │
├──────────────────────────────────────────────┤
│  Stores (*.svelte.ts, *-actions.ts)          │  State Management
│    EditorStore | CanvasStore | SelectionStore │
│    EditorActions | CanvasActions             │
├──────────────────────────────────────────────┤
│  Services                                    │  Business Logic
│    PdfEditorService | FontLoader             │
│    PdfDocument | PdfPage                     │
├──────────────────────────────────────────────┤
│  Core                                        │  WASM Interop
│    PdfiumEngine | pdfium-helpers | types.ts  │
└──────────────────────────────────────────────┘
```

### Key Design Patterns

1. **Singleton Engine**: `PdfiumEngine` is a process-wide singleton
   (`PdfiumEngine.getInstance()`). Only one WASM instance exists.

2. **Context Provider**: Stores and actions are instantiated in `App.svelte`
   and distributed via Svelte `setContext`/`getContext`. Every store exports a
   `provide*()` function (called once at root) and a `use*()` function
   (called in any descendant).

3. **Store / Actions Split**: Reactive state lives in `*Store` classes
   (using `$state` and `$derived`). All mutations that involve side effects
   (async I/O, service calls) live in corresponding `*Actions` classes.

4. **Facade Pattern**: `PdfDocument` and `PdfPage` are high-level facades over
   raw PDFium FFI calls. Low-level operations are isolated in
   `services/pdf/operations/`.

5. **RAII Resource Management**: WASM page handles are managed via
   `withPageHandle()` / `withTextPageHandle()` helpers that guarantee
   `FPDF_ClosePage` in a `finally` block. `WasmBuffer` objects expose a
   `dispose()` method.

6. **LRU Page Cache**: `PdfDocument` limits active WASM page handles to 10
   (`MAX_CACHED_PAGES`). Excess handles are flushed and closed automatically.

7. **Hybrid PDF Serialization**: PDFium handles rendering and drawing;
   `pdf-lib` is dynamically imported for AcroForm widget creation and
   page-level transformation matrices during save.

8. **Non-Reactive Binary Storage**: Large `ArrayBuffer` payloads are stored
   in a plain `Map` (`fileBufferStore`) outside Svelte's reactive proxy
   to prevent deep-proxy overhead.

9. **Snapshot-Based Undo / Redo**: `HistoryStore` manages per-file stacks of
   immutable `HistorySnapshot` records with a maximum depth of 50. Snapshots
   preserve the binary PDF buffer (copied only on destructive WASM mutations,
   referenced otherwise for efficiency), canvas overlay elements, page
   transforms, and hidden span IDs. Continuous interactions (sliders, drags)
   are coalesced via `recordDebounced`. Restores cleanly synchronize Svelte
   reactive state and PDFium WASM engine handles. Standard shortcuts (`Ctrl+Z`,
   `Ctrl+Shift+Z`, `Ctrl+Y`) and panel header controls provide seamless DX.

### Data Flow

```
User Action
  → Component event handler
    → EditorActions / CanvasActions method
      → PdfEditorService / PdfDocument / PdfPage
        → PDFium WASM FFI (via pdfium-helpers)
          → Store mutation ($state update)
            → Svelte reactivity re-renders components
```

---

## Coding Standards

### General Rules

- **TypeScript strict mode**: `strict`, `noUnusedLocals`,
  `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`.
- **ES Modules only**: `"type": "module"` in `package.json`.
  Use `import`/`export`, never `require()`.
- **No Unicode in comments**: Use ASCII-only characters in comments and
  documentation strings.
- **DRY (Don't Repeat Yourself)**: Extract shared logic into helpers. If you
  see the same 3+ lines in two places, refactor into a utility.
- **Single responsibility**: Each file should have one clear purpose.
  Prefer many small files over few large ones.
- **No `any` types**: Use explicit types or `unknown` with type guards.
- **No `console.log` in production code**: Use `console.error` or
  `console.warn` for genuine error conditions only.

### JSDoc — Google Style

All exported functions, classes, interfaces, and non-trivial methods must have
JSDoc comments in [Google style](https://google.github.io/styleguide/tsguide.html#jsdoc).

```typescript
/**
 * Encodes a JavaScript string as UTF-16LE into WASM heap memory.
 *
 * Caller must invoke `dispose()` when the buffer is no longer needed.
 *
 * @param engine The PDFium engine instance.
 * @param text The string to encode.
 * @return The allocated WASM buffer wrapper.
 */
export function encodeUtf16Le(engine: PdfiumEngine, text: string): WasmBuffer {
```

Rules:
- Use `@param` and `@return` tags (not `@returns`).
- Write descriptions in imperative mood ("Encode..." not "Encodes...").
- Do not use Unicode characters (arrows, bullets, em-dashes) in JSDoc.
- Keep interface property docs as single-line `/** ... */` comments:
  ```typescript
  /** The horizontal position coordinate. */
  x: number;
  ```
- Comment why, not what. The code explains what; comments explain non-obvious
  reasoning.

### Naming Conventions

| Entity                    | Convention         | Example                         |
|---------------------------|--------------------|---------------------------------|
| Files (TypeScript)        | `kebab-case.ts`    | `pdf-document.ts`               |
| Files (Svelte)            | `PascalCase.svelte`| `PdfPageView.svelte`            |
| Files (Svelte rune stores)| `kebab-case.svelte.ts` | `editor.svelte.ts`          |
| Classes                   | `PascalCase`       | `PdfEditorService`              |
| Interfaces / Types        | `PascalCase`       | `EditableTextSpan`              |
| Functions                 | `camelCase`        | `buildTransformMatrix`          |
| Constants                 | `UPPER_SNAKE_CASE` | `MAX_CACHED_PAGES`              |
| CSS classes (custom)      | `kebab-case`       | `canvas-element-layer`          |
| CSS classes (Tailwind)    | Tailwind utilities | `flex items-center gap-2`       |
| Svelte context keys       | `Symbol('name')`   | `Symbol('editor-store')`        |
| Store providers            | `provide*` / `use*`| `provideEditorStore()` / `useEditorStore()` |

### File Organization

- **One export per concern**. A file may export multiple related items
  (e.g., a type and its factory), but avoid catch-all barrel files.
- **Import order** (enforce manually):
  1. Svelte imports (`svelte`, `svelte/reactivity`)
  2. Third-party libraries (`@embedpdf/pdfium`, `pdf-lib`, `lucide-svelte`)
  3. Internal `$lib` imports
  4. Relative project imports (core, services, stores, utils)
  5. Type-only imports last (use `import type`)

### Svelte 5 Conventions

- **Runes over legacy**: Use `$state()`, `$derived()`, `$effect()`,
  `$props()`. Never use legacy `let` exports, `$:`, or `onDestroy`.
- **Class-based stores**: State stores are classes with `$state` fields and
  `$derived` getters. Example:
  ```typescript
  export class EditorStore {
    zoom = $state(1.0);
    get zoomPercent(): number { return Math.round(this.zoom * 100); }
  }
  ```
- **Context injection**: Use `setContext` / `getContext` with `Symbol` keys.
  Never use module-level singletons for reactive state (except
  `SelectionStore` which is intentionally global).
- **Snippets over slots**: Use Svelte 5 Snippets (`{#snippet name()}`)
  for component composition instead of `<slot>`.
- **`$state(null)` for DOM refs**: Bind element references using
  `let el: HTMLElement | null = $state(null)` with `bind:this`.

---

## Styling Conventions

### Tailwind CSS v4

This project uses **Tailwind CSS v4** with the Vite plugin (`@tailwindcss/vite`).
Configuration is in `src/app.css`, not a `tailwind.config` file.

- **Design tokens**: Defined in `:root` and `.dark` using OKLCH color space.
  Referenced via `@theme inline` block.
- **Custom cursors**: All cursor types are mapped to CSS custom properties
  (`--cursor-default`, `--cursor-pointer`, etc.) pointing to SVG assets in
  `public/cursors/`.
- **Font**: Inter Variable (self-hosted), declared as `--font-sans`.
- **Radius scale**: Derived from `--radius: 0.25rem` base token.

### Component Styling

- **shadcn-svelte components** (`$lib/components/ui/`): Use `cn()` utility
  from `$lib/utils.ts` (combines `clsx` + `tailwind-merge`). Do not modify
  these files directly — regenerate via `shadcn-svelte` CLI when updating.
- **Custom component classes**: Defined in `app.css` under `@layer components`.
  Reuse these over ad-hoc Tailwind strings:
  - `.panel-container`, `.panel-header`, `.panel-title`, `.panel-content`
  - `.field-group`, `.field-label`, `.field-input`
  - `.btn-action`
  - `.sidebar-section`, `.sidebar-section-header`, `.sidebar-section-title`
  - `.figma-text-box`, `.figma-handle`, `.inline-editor-input`
  - `.canvas-element`, `.canvas-selection-box`, `.canvas-resize-handle`
- **Layout classes**: `.editor-shell` uses CSS Grid with named areas
  (`nav`, `workspace`). Child zones use `.editor-shell-*` classes.
- **Legacy styles**: `src/styles/main.css` contains older layout-only CSS.
  Prefer `app.css` for new styles. Do not add to `main.css`.

### Color System

All colors use the OKLCH color space anchored to the official Olive palette (hue ~106.5 - 107.4 deg).
Light mode and dark mode tokens are defined in `src/app.css` and mapped via `@theme inline`.
The selection and interaction bounding box color is `#0D99FF` (Figma blue), used for bounding
boxes and resize handles.

Dark mode is toggled via a `.dark` class on `<html>`, detected from
`prefers-color-scheme` in `index.html`.

---

## PDF Operations — `src/services/pdf/operations/`

All low-level PDFium FFI calls are isolated in this directory. Each file is a
focused module covering one domain:

| File                  | Responsibility                                     |
|-----------------------|----------------------------------------------------|
| `types.ts`            | Shared option interfaces (DrawOptions, etc.)        |
| `document-ops.ts`     | Document-level: merge, split, reorder, delete pages |
| `page-ops.ts`         | Page-level: render, rotate, flatten, export blob    |
| `text-edit-ops.ts`    | Text extraction, in-place replace, reflow, delete   |
| `metadata-ops.ts`     | Annotations, bookmarks, metadata, signatures        |
| `draw-text.ts`        | Draw text using standard PDF fonts                  |
| `draw-shapes.ts`      | Rectangle, circle, line, arrow, polyline path       |
| `draw-image.ts`       | Embed bitmap images into pages                      |
| `draw-form-field.ts`  | Form field placeholder rendering                    |
| `add-annotations.ts`  | Highlight and ink annotation creation                |

### Conventions for Operations

- Every function takes `(engine: PdfiumEngine, ...)` as the first argument.
- Functions that need a page handle should use `withPageHandle()` or accept
  an already-opened handle.
- WASM memory allocations must be freed in `finally` blocks or via
  `WasmBuffer.dispose()`.
- Color values are passed as CSS strings and converted to RGBA 0-255
  integers via `parseColor()`.
- Coordinate system: PDF uses bottom-left origin. DOM uses top-left origin.
  Use `pageHeight - y - height` to convert Y coordinates.
- Transform matrices use `buildTransformMatrix()` from `services/pdf/utils.ts`
  which handles rotation, flip, and coordinate inversion.

---

## State Management

### EditorStore (`stores/editor.svelte.ts`)

Central reactive state for the editor UI:
- Document lifecycle (`isInitialized`, `isDocumentLoaded`, `pageCount`)
- Navigation (`currentPageIndex`, `zoom`, `scrollFraction`)
- Interaction mode (`activeTool`, `selectedSpan`, `inlineEdit`)
- UI panels (`leftPanelMode`, `leftPanelCollapsed`, `rightPanelCollapsed`)
- Page transforms (`pageTransforms` — rotation, scaleX, scaleY per page)
- Workspace (`workspaceFiles`, `activeWorkspaceFileId`)

### EditorActions (`stores/editor-actions.ts`)

All side-effectful operations: file I/O, PDF engine calls, export, navigation,
inline editing, workspace management. This is the largest file (~970 lines)
and the primary orchestrator of user actions.

### CanvasStore (`stores/canvas.svelte.ts`)

Overlay element state: elements array, selected element ID, drag state,
hovered element. Derived: `selectedElement`, `elementsByPage`.

### CanvasActions (`stores/canvas-actions.ts`)

Element CRUD, drag/resize/rotate logic, element placement from sidebar.

### SelectionStore (`stores/selection.svelte.ts`)

Multi-select support with Ctrl+click (toggle) and Shift+click (range).
Uses `SvelteSet` for reactive membership checks. Intentionally a global
singleton (not context-provided).

---

## Component Hierarchy

```
App.svelte
├── TooltipProvider
├── EditorShell.svelte                    (CSS Grid shell)
│   ├── {#snippet navRail}
│   │   └── NavRail.svelte                (Icon sidebar)
│   ├── {#snippet leftPanel}
│   │   └── LeftPanel.svelte              (Tabbed content panel)
│   │       ├── PageOrganizerPanel
│   │       ├── ComponentsPanel
│   │       ├── AnnotatePanel
│   │       ├── ToolsPanel
│   │       └── SettingsPanel
│   ├── {#snippet canvas}
│   │   └── Canvas.svelte                 (Scrollable viewport)
│   │       └── PdfPageView.svelte        (Per-page, repeated)
│   │           ├── <canvas> (rendered PDF)
│   │           ├── Text layer (selectable text spans)
│   │           ├── SelectionOverlay
│   │           ├── CanvasElementLayer
│   │           │   └── CanvasElement.svelte (repeated per element)
│   │           └── FloatingPageIndicator
│   └── {#snippet rightPanel}
│       └── RightPanel.svelte             (Properties inspector)
│           ├── TextPropertiesPanel
│           ├── ElementPropertiesPanel
│           │   ├── PositionSizeSection
│           │   ├── TransformSection
│           │   ├── TextSection / ImageSection / ShapeSection / FormFieldSection
│           │   └── ActionsSection
│           └── PagePropertiesPanel
│               ├── TransformSection
│               ├── ImpositionSection
│               └── ActionsSection
├── SplitPagesDialog
├── ExportImagesDialog
└── ToolMockupDialog
```

---

## WASM Engine — PDFium

### Initialization Flow

1. `App.svelte` calls `actions.initializeEngine()` on mount.
2. `PdfiumEngine.initialize()` fetches `/pdfium.wasm` (~4.6 MB, preloaded
   via `<link rel="preload">`).
3. WASM is instantiated via `@embedpdf/pdfium`'s `init()`.
4. `PDFiumExt_Init()` enables extension APIs.
5. A sample PDF is auto-loaded.

### Memory Management

- **Document buffer**: Allocated via `malloc`, copied from JS `ArrayBuffer`
  to WASM `HEAPU8`. Freed on document close.
- **Temporary buffers**: Created via `engine.allocateMemory()`, freed via
  `engine.freeMemory()` or `WasmBuffer.dispose()`.
- **Page handles**: Opened via `FPDF_LoadPage`, closed via `FPDF_ClosePage`.
  Managed by `PdfDocument`'s LRU cache.
- **Bitmap buffers**: Created via `FPDFBitmap_Create`, must be destroyed
  via `FPDFBitmap_Destroy`.

### Coordinate Systems

- **PDF coordinates**: Origin at bottom-left, Y increases upward.
  Units are points (1/72 inch).
- **DOM coordinates**: Origin at top-left, Y increases downward.
  Units are CSS pixels.
- **Conversion**: `domY = pageHeightPts - pdfY - elementHeight`
- **Screen to page**: Use `screenToPageCoords()` from `utils/geometry.ts`.
  Accounts for zoom level and page transforms (rotation, scale).

---

## Build Configuration

### Vite (`vite.config.ts`)

- **Path alias**: `$lib` maps to `./src/lib`
- **Dev server**: Port 3000, auto-open
- **Chunk splitting**: Vendor chunks for `@embedpdf/pdfium`, `pdf-lib`,
  `lucide-svelte`, and scoped packages
- **WASM handling**: `@embedpdf/pdfium` excluded from dependency optimization;
  WASM files included as assets
- **Output**: `dist/` directory

### TypeScript (`tsconfig.json`)

- **Target**: ES2022
- **Module resolution**: Bundler mode
- **Path aliases**: `$lib` → `./src/lib`, `$lib/*` → `./src/lib/*`
- **Strict checks**: All strict flags enabled

### Deployment (`wrangler.toml`)

- **Platform**: Cloudflare Pages (static assets)
- **SPA routing**: `not_found_handling = "single-page-application"`
- **Asset directory**: `./dist`

---

## Keyboard Shortcuts

| Shortcut          | Action                         |
|-------------------|--------------------------------|
| `Ctrl+O`          | Open PDF file                  |
| `Ctrl+S`          | Export/Save PDF                |
| `Ctrl+=` / `Ctrl+-` | Zoom in / out               |
| `Ctrl+0`          | Reset zoom to 100%             |
| `Escape`          | Cancel inline edit or clear selection |
| `Delete`/`Backspace` | Delete selected span        |
| `PageUp`/`PageDown` | Navigate pages               |

Keyboard shortcuts are defined in `utils/keyboard-shortcuts.ts` and
registered globally on `window` via `onMount` in `App.svelte`.

---

## Principles

### DRY (Don't Repeat Yourself)

- Shared PDF coordinate math lives in `services/pdf/utils.ts`.
- Shared geometry (resize, clamp, screen-to-page) lives in `utils/geometry.ts`.
- Shared WASM boilerplate lives in `core/pdfium-helpers.ts`.
- Component utility classes live in `app.css` under `@layer components`.
- Do not duplicate logic — extract, import, reuse.

### TDD (Test-Driven Development)

No test framework is configured yet. When adding tests:
- Use **Vitest** (already compatible with Vite).
- Place test files adjacent to source: `foo.test.ts` next to `foo.ts`.
- Write the test first, watch it fail, then implement.
- Pure utility functions (`geometry.ts`, `download-utils.ts`,
  `parseColor()`, `buildTransformMatrix()`) are ideal first test targets.

### Performance

- **Lazy rendering**: Pages render only when visible in the viewport
  (intersection-based).
- **DPR-aware rendering**: Canvas renders at `devicePixelRatio` with a
  max pixel area cap of 4,000,000 to prevent memory crashes.
- **Non-reactive binary storage**: PDF `ArrayBuffer` payloads are stored
  in a plain `Map`, not in `$state`, to avoid Svelte's deep proxy overhead.
- **Bounded page handles**: LRU cache limits open WASM page handles to 10.
- **WASM preloading**: `pdfium.wasm` is preloaded via `<link rel="preload">`
  in `index.html` for faster startup.
- **Chunk splitting**: Heavy dependencies are split into separate vendor
  chunks for better caching.

---

## Common Workflows

### Adding a New PDF Operation

1. Create a new file in `src/services/pdf/operations/` (e.g., `watermark-ops.ts`).
2. Export pure functions that take `(engine: PdfiumEngine, ...)`.
3. Use `withPageHandle()` for page-scoped work.
4. Add a facade method in `PdfPage` or `PdfDocument`.
5. Wire the action in `EditorActions` or `CanvasActions`.

### Adding a New Canvas Element Type

1. Add the kind to `CanvasElementKind` union in `stores/canvas-types.ts`.
2. Define the element interface extending `CanvasElementBase`.
3. Add it to the `CanvasElement` discriminated union.
4. Set default dimensions in `ELEMENT_DEFAULTS`.
5. Handle rendering in `CanvasElement.svelte`.
6. Add the drawing operation in `services/pdf/operations/`.
7. Wire it in `PdfEditorService.applyCanvasElementsToPdf()`.

### Adding a New Panel

1. Create `src/components/panels/MyPanel.svelte`.
2. Add the mode to `LeftPanelMode` in `stores/types.ts`.
3. Add the tab in `NavRail.svelte`.
4. Add the panel branch in `LeftPanel.svelte`.

### Adding a New shadcn Component

```bash
bunx shadcn-svelte@latest add <component-name>
```

Components are installed into `src/lib/components/ui/<name>/`.

---

## Things to Know

- **No SSR**: This is a pure client-side SPA. No server-side rendering.
- **No router**: Single-page app with no URL routing. All navigation is
  in-app state.
- **No backend**: All PDF operations happen in the browser via WASM.
- **`pdf-lib` is dynamically imported**: Only loaded when saving with
  page transforms or AcroForm fields to keep the initial bundle small.
- **Font subset awareness**: `FontCharsetIndex` tracks which characters are
  available in each embedded font. Text edits that stay within the existing
  character set are done in-place to preserve font fidelity. Edits requiring
  new characters fall back to standard PDF fonts.
- **`main.css` is legacy**: Older styles that predate the Tailwind migration.
  Do not add new styles there. Use `app.css` instead.
- **Test PDFs in root**: Files like `test-*.pdf` and `test_*.ts` in the
  project root are ad-hoc development artifacts, not part of the build.
