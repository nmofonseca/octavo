# Octavo

A personal, multi-platform desktop PDF reader with annotations — highlights, freehand ink, and sticky notes — built for calm, brand-first reading in an **orange + black** palette.

**Stack:** [Tauri 2](https://tauri.app) + React + Vite + [PDF.js](https://mozilla.github.io/pdf.js/)

## Features (v1)

- Open local PDFs (or the bundled sample) with a **recent library** and resume
- **Find in document** (Ctrl/Cmd+F) with next/prev, match count, and hit highlights
- **Page thumbnails** and **outline/bookmarks** sidebar (when the PDF has a TOC)
- **Rotate** view, **fit width / fit page**, zoom presets
- **Continuous scroll** or **single-page** mode
- **Print** via the system dialog
- Pan/zoom, page navigation
- Highlight regions, freehand ink, sticky notes (persisted per document)

## Run (development)

### Prerequisites

- Node.js 20+
- Rust stable (for the desktop shell)
- Linux: WebKitGTK 4.1 + GTK 3 (see [Tauri Linux prerequisites](https://tauri.app/start/prerequisites/))
- Windows: WebView2 (usually preinstalled on Win10/11)

### Web UI only (fast demos)

```bash
npm install
npm run dev
```

Open the printed `http://localhost:1420` URL. Sample PDF: `public/samples/octavo-welcome.pdf`.

### Desktop shell (Tauri)

```bash
npm install
npm run tauri:dev
```

## Packaging notes (Linux / Windows × amd64 / arm64)

```bash
npm run tauri:build
```

Artifacts land under `src-tauri/target/release/bundle/`. Prefer native CI runners per OS/arch. Icons live in `src-tauri/icons/`.

## Annotation storage

Annotation JSON lives in the webview’s `localStorage`, keyed by document id. Packaged builds inherit the OS WebView storage for the app origin.

## Keyboard

| Key | Action |
| --- | --- |
| Ctrl/Cmd+F | Find in document |
| Enter / Shift+Enter (in Find) | Next / previous match |
| Ctrl/Cmd+P | Print |
| ← / → or j / k | Prev / next page |
| + / − | Zoom |
| f / F | Fit width / fit page |
| r / R | Rotate CW / CCW |
| 1–4 | Pan / Highlight / Ink / Note |
| Esc | Close find, or back to library |

## License

Private / personal use unless otherwise stated.
