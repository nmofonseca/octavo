import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
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

export async function renderThumbnail(
  pdf: PDFDocumentProxy,
  pageNum: number,
  targetWidth = 120,
  rotation: Rotation = 0,
): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1, rotation: rotation });
  const scale = targetWidth / base.width;
  const viewport = page.getViewport({ scale, rotation });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.72);
}

export { pdfjs };
