# Octavo

A personal, multi-platform desktop PDF reader with annotations — highlights, freehand ink, and sticky notes — built for calm, brand-first reading.

**Stack:** [Tauri 2](https://tauri.app) + React + Vite + [PDF.js](https://mozilla.github.io/pdf.js/)

## Features (v0)

- Open local PDFs (or the bundled sample)
- Zoom, pan, and page navigation
- Highlight regions, freehand ink, sticky notes
- Local annotation persistence (per-document, via `localStorage` in the webview)
- Library view with recent documents

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

Open the printed `http://localhost:1420` URL. The sample PDF is at `public/samples/octavo-welcome.pdf`.

### Desktop shell (Tauri)

```bash
npm install
npm run tauri:dev
```

## Packaging notes (Linux / Windows × amd64 / arm64)

Octavo uses Tauri’s bundler. From a machine with the matching OS/arch toolchain:

```bash
npm run tauri:build
```

Artifacts land under `src-tauri/target/release/bundle/`:

| Target | Typical outputs |
| --- | --- |
| Linux amd64 / arm64 | `.deb`, `.AppImage`, and/or `.rpm` (enable in `tauri.conf.json` → `bundle.targets`) |
| Windows amd64 / arm64 | `.msi` / `.exe` (NSIS or WiX) |

Cross-tips:

- Prefer **native CI runners** per OS/arch (GitHub `ubuntu-24.04`, `ubuntu-24.04-arm`, `windows-latest`, `windows-11-arm`) over cross-compilation for WebView shells.
- On Linux CI, install WebKitGTK 4.1 and GTK 3 before `tauri build`.
- On Windows, ensure WebView2 Evergreen is available on target machines (Tauri can bootstrap it).
- Set `productName` / `identifier` in `src-tauri/tauri.conf.json` (already `Octavo` / `com.octavo.app`).
- Icons live in `src-tauri/icons/` — replace before a public release.

`bundle.targets` is currently `"all"` so each host produces its native installers.

## Annotation storage

v0 stores annotation JSON in the webview’s `localStorage`, keyed by document id. Packaged builds inherit the OS WebView storage for the app origin. A future release can move this to the Tauri app-data directory via a small Rust command.

## Keyboard

| Key | Action |
| --- | --- |
| ← / → or j / k | Prev / next page |
| + / − | Zoom |
| 1–4 | Pan / Highlight / Ink / Note |
| Esc | Back to library |

## License

Private / personal use unless otherwise stated.
