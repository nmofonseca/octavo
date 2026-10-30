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

/**
 * Render a sharp sidebar thumbnail.
 * Renders at device-pixel density (capped), fills white, exports PNG.
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
    const name = (e as { name?: string })?.name;
    if (
      signal?.aborted ||
      name === "RenderingCancelledException" ||
      name === "AbortError"
    ) {
      throw new DOMException("Aborted", "AbortError");
    }
    throw e;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // Keep the high-DPI bitmap so CSS-scaled thumbs stay sharp on retina displays
  return canvas.toDataURL("image/png");
}

export { pdfjs };
