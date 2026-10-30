/** Thrown when a finished render has no detectable ink (white/blank page). */
export class BlankThumbnailError extends Error {
  constructor(pageNum: number) {
    super(`Blank thumbnail for page ${pageNum}`);
    this.name = "BlankThumbnailError";
  }
}

/**
 * Sample RGBA pixels for non-near-white ink.
 * Pure helper so unit tests don't need a DOM canvas or pdf.js.
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

export function isAbortError(e: unknown): boolean {
  return (e as { name?: string })?.name === "AbortError";
}

export const THUMB_RETRY_DELAYS_MS = [0, 40, 120, 280];

/** Main PageView paint retries — keep short so continuous scroll stays responsive. */
export const PAGE_RETRY_DELAYS_MS = [0, 32, 80, 160, 280];

export function isRenderCancelledError(e: unknown): boolean {
  const name = (e as { name?: string })?.name;
  return name === "RenderingCancelledException" || name === "AbortError";
}

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
