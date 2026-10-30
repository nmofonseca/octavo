import { describe, expect, it, vi } from "vitest";
import {
  BlankThumbnailError,
  attemptWithRetries,
  isMostlyBlankRgba,
  renderThumbnailReliable,
} from "./pdf";

function rgbaFill(
  width: number,
  height: number,
  rgba: [number, number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }
  return data;
}

describe("isMostlyBlankRgba", () => {
  it("treats pure white as blank", () => {
    const data = rgbaFill(64, 64, [255, 255, 255, 255]);
    expect(isMostlyBlankRgba(data, 64, 64)).toBe(true);
  });

  it("treats near-white as blank", () => {
    const data = rgbaFill(64, 64, [252, 252, 252, 255]);
    expect(isMostlyBlankRgba(data, 64, 64)).toBe(true);
  });

  it("detects dark ink on a page", () => {
    const data = rgbaFill(64, 64, [255, 255, 255, 255]);
    for (let y = 10; y < 40; y++) {
      for (let x = 10; x < 40; x++) {
        const i = (y * 64 + x) * 4;
        data[i] = 20;
        data[i + 1] = 20;
        data[i + 2] = 20;
      }
    }
    expect(isMostlyBlankRgba(data, 64, 64)).toBe(false);
  });

  it("treats tiny canvases as blank", () => {
    const data = rgbaFill(1, 1, [0, 0, 0, 255]);
    expect(isMostlyBlankRgba(data, 1, 1)).toBe(true);
  });
});

describe("attemptWithRetries", () => {
  it("retries blank/cancelled failures then succeeds", async () => {
    vi.useFakeTimers();
    let n = 0;
    const promise = attemptWithRetries(
      async () => {
        n += 1;
        if (n === 1) throw new BlankThumbnailError(3);
        if (n === 2) {
          const err = new Error("Thumbnail render cancelled");
          err.name = "RenderingCancelledException";
          throw err;
        }
        return "data:image/png;base64,ok";
      },
      { delaysMs: [0, 10, 20] },
    );

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("data:image/png;base64,ok");
    expect(n).toBe(3);
    vi.useRealTimers();
  });

  it("stops immediately on AbortError", async () => {
    let n = 0;
    await expect(
      attemptWithRetries(
        async () => {
          n += 1;
          throw new DOMException("Aborted", "AbortError");
        },
        { delaysMs: [0, 0, 0] },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(n).toBe(1);
  });

  it("respects abort signal between attempts", async () => {
    const ac = new AbortController();
    let n = 0;
    const promise = attemptWithRetries(
      async () => {
        n += 1;
        ac.abort();
        throw new BlankThumbnailError(1);
      },
      { delaysMs: [0, 0, 0], signal: ac.signal },
    );
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(n).toBe(1);
  });
});

describe("renderThumbnailReliable", () => {
  it("is exported for the reader", () => {
    expect(typeof renderThumbnailReliable).toBe("function");
  });
});
