import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { OutlineItem, Rotation, SearchHit } from "../types";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export async function openPdf(url: string): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    url,
    withCredentials: false,
  });
  return task.promise;
}

async function destToPage(
  pdf: PDFDocumentProxy,
  dest: unknown,
): Promise<number | null> {
  try {
    let explicit: unknown = dest;
    if (typeof dest === "string") {
      explicit = await pdf.getDestination(dest);
    }
    if (!Array.isArray(explicit) || !explicit[0]) return null;
    const pageIndex = await pdf.getPageIndex(explicit[0] as never);
    return pageIndex + 1;
  } catch {
    return null;
  }
}

export async function getOutlineTree(
  pdf: PDFDocumentProxy,
): Promise<OutlineItem[]> {
  const outline = await pdf.getOutline();
  if (!outline?.length) return [];

  async function mapItems(
    items: Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>,
  ): Promise<OutlineItem[]> {
    if (!items) return [];
    const out: OutlineItem[] = [];
    for (const item of items) {
      const page = await destToPage(pdf, item.dest);
      out.push({
        title: item.title || "Untitled",
        page,
        items: await mapItems(item.items),
      });
    }
    return out;
  }

  return mapItems(outline);
}

/** Search every page; returns normalized highlight rects + previews. */
export async function searchDocument(
  pdf: PDFDocumentProxy,
  query: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const page = await pdf.getPage(pageNum);
    const text = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const items = text.items as Array<{
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
    }>;

    for (const item of items) {
      if (!item.str || !item.transform) continue;
      const str = item.str;
      const lower = str.toLowerCase();
      let from = 0;
      while (from < lower.length) {
        const idx = lower.indexOf(q, from);
        if (idx === -1) break;

        const tx = item.transform[4] ?? 0;
        const ty = item.transform[5] ?? 0;
        const fontH = Math.abs(item.transform[3] ?? item.height ?? 10) || 10;
        const fullW = item.width ?? Math.abs(item.transform[0] ?? 0) * str.length;
        const charW = str.length ? fullW / str.length : 0;
        const matchW = Math.max(charW * q.length, 4);
        const matchX = tx + charW * idx;

        // PDF user-space → viewport pixels → normalized
        const [vx1, vy1] = viewport.convertToViewportPoint(matchX, ty);
        const [vx2, vy2] = viewport.convertToViewportPoint(
          matchX + matchW,
          ty + fontH,
        );
        const left = Math.min(vx1, vx2) / viewport.width;
        const top = Math.min(vy1, vy2) / viewport.height;
        const w = Math.abs(vx2 - vx1) / viewport.width;
        const h = Math.abs(vy2 - vy1) / viewport.height;

        const start = Math.max(0, idx - 18);
        const end = Math.min(str.length, idx + q.length + 18);
        const preview =
          (start > 0 ? "…" : "") +
          str.slice(start, end) +
          (end < str.length ? "…" : "");

        hits.push({
          page: pageNum,
          x: left,
          y: top,
          w: Math.max(w, 0.01),
          h: Math.max(h, 0.008),
          preview,
        });
        from = idx + Math.max(q.length, 1);
      }
    }
  }
  return hits;
}

/** Thrown when a finished render has no detectable ink (white/blank page). */
export class BlankThumbnailError extends Error {
  constructor(pageNum: number) {
    super(`Blank thumbnail for page ${pageNum}`);
    this.name = "BlankThumbnailError";
  }
}

/**
 * Sample RGBA pixels for non-near-white ink.
 * Pure helper so unit tests don't need a DOM canvas.
 */
export function isMostlyBlankRgba(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options?: {
    sampleStep?: number;
    whiteThreshold?: number;
    minInkRatio?: number;
  },
): boolean {
  const sampleStep = options?.sampleStep ?? 8;
  const whiteThreshold = options?.whiteThreshold ?? 250;
  const minInkRatio = options?.minInkRatio ?? 0.002;
  if (width < 2 || height < 2 || data.length < 4) return true;

  let sampled = 0;
  let ink = 0;
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const i = (y * width + x) * 4;
      if (i + 2 >= data.length) continue;
      sampled += 1;
      const r = data[i] ?? 255;
      const g = data[i + 1] ?? 255;
      const b = data[i + 2] ?? 255;
      if (r < whiteThreshold || g < whiteThreshold || b < whiteThreshold) {
        ink += 1;
      }
    }
  }
  return sampled === 0 || ink / sampled < minInkRatio;
}

export function isMostlyBlankCanvas(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!ctx) return true;
  const { width, height } = canvas;
  try {
    const { data } = ctx.getImageData(0, 0, width, height);
    return isMostlyBlankRgba(data, width, height);
  } catch {
    // Tainted / oversized canvas — treat as unknown (not blank) so we keep the bitmap
    return false;
  }
}

function isAbortError(e: unknown): boolean {
  return (e as { name?: string })?.name === "AbortError";
}

function isRenderCancelled(e: unknown): boolean {
  const name = (e as { name?: string })?.name;
  return name === "RenderingCancelledException" || name === "AbortError";
}

/**
 * Render a sharp sidebar thumbnail once.
 * Renders at device-pixel density (capped), fills white, exports PNG.
 * Rejects with BlankThumbnailError when the bitmap has no ink.
 * Only throws AbortError when the caller's signal aborted — concurrent
 * RenderingCancelledException from another canvas must be retried, not treated
 * as a full thumbnail-pass abort.
 */
export async function renderThumbnail(
  pdf: PDFDocumentProxy,
  pageNum: number,
  targetWidth = 200,
  rotation: Rotation = 0,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const page = await pdf.getPage(pageNum);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const dpr =
    typeof window !== "undefined"
      ? Math.min(Math.max(window.devicePixelRatio || 1, 1), 2.5)
      : 2;
  const cssWidth = Math.max(96, targetWidth);
  const base = page.getViewport({ scale: 1, rotation });
  // Floor scale so image-heavy pages still paint ink (avoids blank low-DPI renders)
  const scale = Math.max(0.55, (cssWidth * dpr) / Math.max(base.width, 1));
  const viewport = page.getViewport({ scale, rotation });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return "";

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let task: RenderTask | null = null;
  const onAbort = () => {
    try {
      task?.cancel();
    } catch {
      /* ignore */
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    task = page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      intent: "display",
      background: "#ffffff",
    });
    await task.promise;
  } catch (e) {
    if (signal?.aborted || isAbortError(e)) {
      throw new DOMException("Aborted", "AbortError");
    }
    // Concurrent page.render() (e.g. main viewer) cancelled us — caller should retry
    if (isRenderCancelled(e)) {
      const err = new Error("Thumbnail render cancelled");
      err.name = "RenderingCancelledException";
      throw err;
    }
    throw e;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  if (isMostlyBlankCanvas(canvas)) {
    throw new BlankThumbnailError(pageNum);
  }

  // Keep the high-DPI bitmap so CSS-scaled thumbs stay sharp on retina displays
  return canvas.toDataURL("image/png");
}

export const THUMB_RETRY_DELAYS_MS = [0, 40, 120, 280];

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Retry an async attempt across delays. AbortError (or aborted signal) stops immediately.
 * Used by thumbnail rendering so blank/cancelled paints can recover.
 */
export async function attemptWithRetries<T>(
  attempt: () => Promise<T>,
  options?: {
    signal?: AbortSignal;
    delaysMs?: number[];
    isSuccess?: (value: T) => boolean;
  },
): Promise<T> {
  const delays = options?.delaysMs ?? THUMB_RETRY_DELAYS_MS;
  const signal = options?.signal;
  const isSuccess = options?.isSuccess ?? ((v: T) => v != null && v !== ("" as T));
  let lastError: unknown;

  for (let i = 0; i < delays.length; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await sleep(delays[i] ?? 0, signal);
    try {
      const value = await attempt();
      if (isSuccess(value)) return value;
      lastError = new Error("Attempt returned empty result");
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      lastError = e;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("All attempts failed");
}

/**
 * Reliable thumbnail: retries on blank bitmaps and concurrent render cancels.
 */
export async function renderThumbnailReliable(
  pdf: PDFDocumentProxy,
  pageNum: number,
  targetWidth = 200,
  rotation: Rotation = 0,
  signal?: AbortSignal,
): Promise<string> {
  return attemptWithRetries(
    () => renderThumbnail(pdf, pageNum, targetWidth, rotation, signal),
    {
      signal,
      delaysMs: THUMB_RETRY_DELAYS_MS,
      isSuccess: (src) => Boolean(src),
    },
  );
}

export { pdfjs };
