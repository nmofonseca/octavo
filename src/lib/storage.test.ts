import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  docIdFromMeta,
  loadDocStore,
  loadLibrary,
  saveDocStore,
  saveLibrary,
  touchOpened,
  upsertAnnotations,
} from "./storage";
import type { LibraryDoc } from "../types";

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

describe("docIdFromMeta", () => {
  it("joins title and byte length", () => {
    expect(docIdFromMeta("Report", 42)).toBe("Report::42");
  });

  it("defaults missing bytes to 0", () => {
    expect(docIdFromMeta("Untitled")).toBe("Untitled::0");
  });
});

describe("touchOpened", () => {
  it("bumps lastOpenedAt and sorts most-recent first", () => {
    const docs: LibraryDoc[] = [
      {
        id: "a",
        title: "A",
        source: "sample",
        url: "/a.pdf",
        addedAt: 1,
        lastOpenedAt: 10,
      },
      {
        id: "b",
        title: "B",
        source: "file",
        url: "/b.pdf",
        addedAt: 2,
        lastOpenedAt: 5,
      },
    ];
    const next = touchOpened(docs, "b");
    expect(next[0].id).toBe("b");
    expect(next[0].lastOpenedAt).toBeGreaterThan(5);
    expect(next[1].id).toBe("a");
  });
});

describe("doc store persistence", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: new MemoryStorage(),
      configurable: true,
    });
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).localStorage;
  });

  it("returns defaults for unknown docs", () => {
    expect(loadDocStore("missing")).toEqual({
      annotations: [],
      lastPage: 1,
      zoom: 1.1,
      rotation: 0,
      viewMode: "continuous",
    });
  });

  it("round-trips annotations and extras", () => {
    upsertAnnotations(
      "doc-1",
      [
        {
          id: "n1",
          type: "note",
          page: 2,
          x: 0.1,
          y: 0.2,
          text: "hi",
          color: "#f60",
        },
      ],
      { lastPage: 2, zoom: 1.5, rotation: 90, viewMode: "single" },
    );
    expect(loadDocStore("doc-1")).toMatchObject({
      lastPage: 2,
      zoom: 1.5,
      rotation: 90,
      viewMode: "single",
      annotations: [{ id: "n1", type: "note", text: "hi" }],
    });
  });

  it("strips ephemeral blob URLs when saving the library", () => {
    saveLibrary([
      {
        id: "f",
        title: "Local",
        source: "file",
        url: "blob:http://localhost/abc",
        addedAt: 1,
      },
    ]);
    expect(loadLibrary()[0].url).toBe("");
  });

  it("persists explicit doc stores", () => {
    saveDocStore("x", {
      annotations: [],
      lastPage: 3,
      zoom: 2,
      rotation: 180,
      viewMode: "single",
    });
    expect(loadDocStore("x").lastPage).toBe(3);
  });
});
