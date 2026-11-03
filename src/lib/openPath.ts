import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type PdfFilePayload = {
  name: string;
  data: number[] | Uint8Array;
};

/** True when running inside a Tauri webview (not plain Vite browser). */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function fileFromPdfPayload(payload: PdfFilePayload): File {
  const bytes =
    payload.data instanceof Uint8Array
      ? payload.data
      : Uint8Array.from(payload.data);
  const name = payload.name.toLowerCase().endsWith(".pdf")
    ? payload.name
    : `${payload.name}.pdf`;
  // Copy into a fresh ArrayBuffer-backed view — File/Blob reject shared buffers.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type: "application/pdf" });
}

export async function readPdfFromPath(path: string): Promise<File> {
  const payload = await invoke<PdfFilePayload>("read_pdf_for_open", { path });
  return fileFromPdfPayload(payload);
}

/**
 * Drain cold-start paths once per JS realm.
 * React Strict Mode remounts must share the same promise; otherwise the first
 * (aborted) effect empties pending and the second mount sees nothing.
 */
let pendingOpenPathsPromise: Promise<string[]> | null = null;

export async function takePendingOpenPaths(): Promise<string[]> {
  if (!pendingOpenPathsPromise) {
    pendingOpenPathsPromise = invoke<string[]>("take_pending_open_paths");
  }
  return pendingOpenPathsPromise;
}

/** Test-only: reset the once-per-realm pending fetch. */
export function resetPendingOpenPathsCacheForTests() {
  pendingOpenPathsPromise = null;
}

/**
 * Subscribe to paths forwarded from a second Octavo instance
 * ("Open with" while already running).
 */
export async function listenOpenPaths(
  onPaths: (paths: string[]) => void,
): Promise<UnlistenFn> {
  return listen<string[]>("octavo://open-paths", (event) => {
    const paths = event.payload;
    if (Array.isArray(paths) && paths.length > 0) onPaths(paths);
  });
}
