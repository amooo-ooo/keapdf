# Kea PDF

[![Licence: AGPL v3](https://img.shields.io/badge/Licence-AGPL%20v3-blue.svg)](LICENSE)
[![Built with Svelte 5](https://img.shields.io/badge/Svelte-5-orange.svg)](https://svelte.dev/)
[![Engine: PDFium WASM](https://img.shields.io/badge/Engine-PDFium%20WASM-green.svg)](https://pdfium.googlesource.com/pdfium/)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-f472b6.svg)](https://bun.sh/)

A high-performance, browser-native PDF editor built with Svelte 5, TypeScript, Tailwind CSS v4, and Google PDFium compiled to WebAssembly. All parsing, rendering, text editing, drawing, layout imposition, cryptographic signing, and document mutations execute entirely client-side with zero server round-trips.

For the exhaustive 600-line architecture manual and technical specification, see [CONTEXT.md](CONTEXT.md). For the complete catalogue of low-level PDF operations and interactive canvas tools, see [TOOLS.md](TOOLS.md).

## Features

- **In-Place Native Text Editing**: Edit existing PDF text directly while preserving embedded font subsets, layout metrics, and character styling.
- **4-Pass Spatial Paragraph Detector**: Clusters raw PDF glyphs into semantic paragraphs with orientation normalisation, word assembly, line assembly, and block clustering.
- **Typographic Advance Tolerance Reflow**: Line breaks use an advance width buffer (`Math.max(4, fontSize * 0.35)`) to prevent premature line wrapping on trailing words, with automatic vertical shifting of downstream content.
- **Interactive Canvas Overlays**: Extensible element registry system supporting rich text, images, vector shapes, AcroForm fields, freehand ink paths, and sticky notes.
- **Direct Manipulation Controls**: 8-handle directional scaling with unrotated vector projection, aspect ratio locks, centre-origin polar rotation with 5-degree magnetic snapping, and horizontal/vertical mirroring.
- **Canvas-to-PDF Baking**: The burn pipeline serialises overlay elements directly into PDFium content streams as native vector paths, bitmap objects, and standard PDF annotations.
- **Layout Imposition Engine**: Client-side multi-page N-up printing, saddle-stitch booklet folding with mathematical folio pairing, continuous single-page canvas, posterise multi-sheet tiling, and cut-and-stack imposition.
- **Cryptographic Digital Signatures**: ISO 32000 Section 12.8 detached PKCS#7 signing, SHA-256 byte-range calculation, client-side RSA 2048/4096-bit self-signed certificate generation, PKCS#12 bundle support, and signature verification with tamper detection.
- **E-Signature Studio**: Create signatures via canvas drawing with quadratic Bezier curve smoothing, cursive keyboard entry (6 handwriting fonts), or image upload with dynamic background luminance thresholding.
- **Document Sanitisation**: Scrub 11 sensitive object categories: Info metadata, XMP streams, file attachments, JavaScript actions, form fields, outlines, annotations, external hyperlinks, PieceInfo private data, thumbnails, and structural tag trees.
- **Autonomous AI Agent Interface (W3C WebMCP)**: Implements the W3C Web Model Context Protocol draft specification with a Semantic Document Graph (SDG), stable session IDs, NFC normalisation, byte-level anchor verification, single-writer write lock (`SdgLock`), sliding-window rate limiter (30 mutations/min), staged proposal store, and 53 atomic tools under the `pdf.*` namespace.
- **Invertible Command Architecture**: Undo and redo history with 1000ms continuous merge coalescing, transactional compound rollback, and per-document history stacks.
- **Multi-File Workspace**: Tabbed multi-document management with unproxied binary buffer storage (`fileBufferStore`), full-screen page organiser grid, and split/extract tools.
- **Modular Exporters**: Dynamically registered export targets for standard PDF, flattened PDF (`FPDFPage_Flatten`), high-DPI raster images (PNG/JPEG with ZIP export), and plain text extraction.
- **Extensible Plugin System**: Layer 5 public API (`api.elements`, `api.tools`, `api.panels`, `api.exporters`, `api.commands`, `api.events`) with scoped lifecycle management and automatic resource teardown.

## URL Parameter Routing & Industry Benchmark Suites

The editor supports direct document loading via URL query parameters and hash fragments. It connects to real-world benchmark PDF documents used by major engines (Mozilla PDF.js, Adobe Acrobat, Hopding pdf-lib) to capture parser, AcroForm, typography, vector, and memory errors across complex edge cases.

To eliminate frontend bundle bloat, zero test PDF binaries are packaged in the client distribution. Documents stream on demand from verified, CORS-permissive repositories with automatic fallbacks to client-side procedural generators when offline.

### Supported Parameters

| Parameter | Syntax Example | Description |
|---|---|---|
| `demo` | `?demo=forms` or `?demo=160f` | Opens a curated industry benchmark suite or preset by ID or alias |
| `demo` (direct) | `?demo=https://example.com/doc.pdf` | Streams an external PDF URL directly via the demo parameter |
| `url` | `?url=https://example.com/doc.pdf` | Fetches and opens a public PDF from a CORS-enabled HTTPS endpoint |
| `pdf` | `?pdf=https://example.com/doc.pdf` | Alias for `url` parameter |
| `file` | `?file=https://example.com/doc.pdf` | Alias for `url` parameter |
| Hash fragment | `#demo=tracemonkey` or `#url=https://...` | Hash-based routing for static single-page application hosts |

### Curated Benchmark Document Presets

| Preset ID | Aliases | Origin Suite | Benchmark Document | Technical Focus & Capabilities |
|---|---|---|---|---|
| `iso-32000-forms` | `forms`, `160f`, `acroform`, `dod` | Mozilla PDF.js / Arizona | `160F-2019.pdf` (328 kB) | 30+ interactive AcroForm widgets, comb boxes, calculation grids, checkmarks, appearance streams |
| `typography-stress` | `typography`, `tracemonkey`, `pldi`, `fonts` | Mozilla PDF.js (PLDI '09) | `compressed.tracemonkey-pldi-09.pdf` (1.01 MB) | 14 pages of dense 2-column text, Type 1/TrueType subset fonts, math symbols, superscripts, footnotes |
| `vector-graphics` | `vector`, `alphatrans`, `shapes`, `graphics` | Mozilla PDF.js Vector Suite | `alphatrans.pdf` (16.9 kB) | PDF graphics state, alpha transparency channels, soft masks, composite paths, blend modes |
| `linearized-multipage` | `multipage`, `freeculture`, `book` | Lawrence Lessig / PDF.js | `freeculture.pdf` (2.59 MB) | Full 270+ page book: large document virtualization, LRU memory eviction, multi-page layout caching |
| `pdfa-signatures` | `signatures`, `with_signature`, `pdfa` | Hopding pdf-lib / Acrobat | `with_signature.pdf` (12.1 kB) | Cryptographic digital signature dictionary (/Sig), signed visual appearance, byte range hashes |
| `annotations-redaction` | `annotations`, `comments`, `notes` | Mozilla PDF.js Annotations | `comments.pdf` (1.06 MB) | Native annotations: popup comment threads, sticky notes, freehand ink lines, highlights, strikeout markups |
| `sample` | `demo`, `template`, `default` | Native Showcase Template | `sample.pdf` (3 pages) | Multi-page showcase with canvas overlays, editable text, shapes, arrows, ink, image scaling |

### URL Usage Examples

```bash
# Open interactive Arizona tax schedule (AcroForms benchmark)
http://localhost:3000/?demo=forms
http://localhost:3000/?demo=160f

# Open 14-page TraceMonkey PLDI paper (Typography & reflow benchmark)
http://localhost:3000/?demo=typography
http://localhost:3000/?demo=tracemonkey

# Open alpha transparency & vector graphics benchmark
http://localhost:3000/?demo=vector
http://localhost:3000/?demo=alphatrans

# Open 270-page Free Culture book (Large publication & LRU cache benchmark)
http://localhost:3000/?demo=multipage
http://localhost:3000/?demo=freeculture

# Open cryptographic digital signature benchmark
http://localhost:3000/?demo=signatures
http://localhost:3000/?demo=with_signature

# Open native annotations and comment threads benchmark
http://localhost:3000/?demo=annotations
http://localhost:3000/?demo=comments

# Open any external CORS-permissive PDF by URL
http://localhost:3000/?url=https://raw.githubusercontent.com/Hopding/pdf-lib/master/assets/pdfs/dod_character.pdf

# Open via SPA hash fragment
http://localhost:3000/#demo=forms
```

### Security and Edge Case Guarantees

- **Protocol Whitelist**: Only `http:`, `https:`, and application-relative paths are accepted. Dangerous schemes (`javascript:`, `data:text/html`, `file:`, `ftp:`) and path traversal sequences (`../..`) are rejected immediately.
- **Magic Byte Verification**: Per ISO 32000-1 Clause 7.5.2, byte streams are validated for the `%PDF-` signature within the first 1024 bytes before PDFium allocation, rejecting HTML error pages and corrupt downloads.
- **Network Timeout**: 15-second AbortController timeout prevents stalled requests on slow or unresponsive networks.
- **CORS Diagnostics**: Detailed error messages provide clear remediation guidance if a remote server restricts cross-origin resource sharing.
- **Offline Fallback**: Transparently switches to in-memory procedural generators if network access is unavailable, ensuring zero downtime.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (version 1.0 or later). Never use npm, yarn, or pnpm.

### Setup and Development

Clone the repository and start the local development server:

```bash
git clone https://github.com/amooo-ooo/kea-pdf.git
cd kea-pdf
bun install
bun run dev
```

The Vite dev server starts at `http://localhost:3000` and opens automatically in your browser.

### Available Scripts

| Command | Description |
|---|---|
| `bun install` | Installs project dependencies using bun.lock |
| `bun run dev` | Starts Vite development server on port 3000 |
| `bun test` | Runs unit and integration test suites with Bun test runner |
| `bun run build` | Runs svelte-check diagnostics, then compiles production bundle |
| `bun run preview` | Serves compiled production build locally for verification |
| `bun run deploy` | Compiles application and deploys to Cloudflare Pages via Wrangler |
| `bunx svelte-check` | Runs standalone TypeScript and Svelte diagnostics |

## Architecture at a Glance

Dependencies flow strictly downward across five decoupled layers:

```
+-------------------------------------------------------------+
| Layer 1: Components (src/components/)                       |
|   Canvas, Layout, Panels, Dialogs, Renderers, UI Primitives |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Layer 2: State Management (src/stores/)                     |
|   EditorStore, CanvasStore, HistoryStore, SelectionStore    |
|   EditorActions, CanvasActions, WebMcpStore                 |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Layer 3: Services (src/services/)                           |
|   PdfEditorService, FontLoader, SignatureStorage            |
|   PdfDocument Facade, PdfPage Facade, Operations Modules    |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Layer 4: Core Engine and Registries (src/core/)             |
|   PdfiumEngine (WASM), Helpers, Command Pattern, Registries |
|   WebMCP Coordinator, SDG Builder, Safety Guards            |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Layer 5: Extensibility (src/plugins/)                       |
|   PluginManager, Sandboxed PluginAPI, Extension Modules     |
+-------------------------------------------------------------+
```

### Engineering Invariants

- **Process-Wide WASM Singleton**: `PdfiumEngine` manages a single instance of the 4.6 MB PDFium WebAssembly runtime with explicit heap allocation via `malloc` and `free`.
- **RAII Resource Management**: Helper functions `withPageHandle` and `withTextPageHandle` wrap handles in `try...finally` blocks to guarantee `FPDF_ClosePage` execution.
- **LRU Page Cache**: `PdfDocument` limits active WASM page handles to 10 (`MAX_CACHED_PAGES`), committing content and closing handles on eviction.
- **Unproxied Binary Storage**: Large PDF `ArrayBuffer` payloads reside in an unproxied JavaScript `Map` outside Svelte reactive state, eliminating deep-proxy overhead.
- **Memory Safety Cap**: Canvas rendering clamps total pixel area to 4,000,000 pixels to prevent GPU out-of-memory errors on high-DPI screens.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+O` | Open PDF file from disk |
| `Ctrl+S` | Export current PDF document |
| `Ctrl+Z` | Undo last action |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo last undone action |
| `Ctrl+=` / `Ctrl++` | Zoom in |
| `Ctrl+-` | Zoom out |
| `Ctrl+0` | Reset zoom to 100 percent |
| `Escape` | Cancel inline edit or clear selection |
| `Delete` / `Backspace` | Delete selected element or text span |
| `PageUp` / `PageDown` | Navigate pages |
| `V` | Select Tool |
| `H` | Hand (Pan) Tool |
| `T` | Text Tool |
| `Shift+H` | Highlight Tool |
| `P` | Pen Tool |
| `R` | Redact Tool |
| `N` | Sticky Note Tool |

## Documentation Reference

- **[CONTEXT.md](CONTEXT.md)**: Deep technical architecture manual covering the 4-pass paragraph detector, in-place font subset preservation, layout imposition formulas, ISO 32000 detached PKCS#7 signing, and full WebMCP specification alignment.
- **[TOOLS.md](TOOLS.md)**: Complete inventory of all 53 WebMCP atomic tools, low-level PDF operations, interactive canvas tools, and property subpanels.
- **[AGENTS.md](AGENTS.md)**: Engineering guidelines, coding conventions, testing protocols, and design patterns for contributors and AI agents.
- **[webmcp-pdf-editor-spec.md](webmcp-pdf-editor-spec.md)**: W3C Web Model Context Protocol specification for autonomous agent integration.
- **[STORY.md](STORY.md)**: Project story, architectural inspiration, Devpost hackathon submission narrative, and technical learnings.
- **[KEA_STORY.md](KEA_STORY.md)**: Comprehensive Devpost hackathon submission story, answering all four required questions with KaTeX math and architecture breakdown.
- **[HACKATHON_REPORT.md](HACKATHON_REPORT.md)**: In-depth WebMCP hackathon evaluation report, judge profiles, benchmark winner analysis, and competition cross-reference matrix.
- **[DEMO_WORKFLOW_AND_SCRIPT.md](DEMO_WORKFLOW_AND_SCRIPT.md)**: 3-prompt incremental agentic workflow and under-3-minute video demonstration script.

## Licence

Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See [LICENSE](LICENSE) for details.
