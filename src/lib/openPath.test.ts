import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  fileFromPdfPayload,
  isTauriRuntime,
  resetPendingOpenPathsCacheForTests,
  takePendingOpenPaths,
} from "./openPath";

describe("fileFromPdfPayload", () => {
  it("builds a PDF File from IPC number arrays", async () => {
    const magic = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
    const file = fileFromPdfPayload({ name: "workout.pdf", data: magic });
    expect(file.name).toBe("workout.pdf");
    expect(file.type).toBe("application/pdf");
    expect(file.size).toBe(5);
    const buf = new Uint8Array(await file.arrayBuffer());
    expect(Array.from(buf)).toEqual(magic);
  });

  it("appends .pdf when the name lacks an extension", () => {
    const file = fileFromPdfPayload({
      name: "notes",
      data: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    });
    expect(file.name).toBe("notes.pdf");
  });
});

describe("isTauriRuntime", () => {
  it("is false in the vitest/jsdom environment", () => {
    expect(isTauriRuntime()).toBe(false);
  });
});

describe("takePendingOpenPaths", () => {
  beforeEach(() => {
    resetPendingOpenPathsCacheForTests();
    vi.mocked(invoke).mockReset();
  });

  it("shares one invoke promise across callers (Strict Mode safe)", async () => {
    vi.mocked(invoke).mockResolvedValue(["/tmp/a.pdf"]);
    const [a, b] = await Promise.all([
      takePendingOpenPaths(),
      takePendingOpenPaths(),
    ]);
    expect(a).toEqual(["/tmp/a.pdf"]);
    expect(b).toEqual(["/tmp/a.pdf"]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("take_pending_open_paths");
  });
});
