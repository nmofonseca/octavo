import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

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

export { pdfjs };
