import { beforeEach, describe, expect, it } from "vitest";
import type { LibraryDoc } from "../types";
import {
  docIdFromMeta,
  loadDocStore,
  loadLibrary,
  saveDocStore,
  saveLibrary,
  touchOpened,
  upsertAnnotations,
} from "./storage";

describe("docIdFromMeta", () => {
  it("joins title and byte length", () => {
    expect(docIdFromMeta("Report.pdf", 42)).toBe("Report.pdf::42");
  });

  it("defaults missing bytes to 0", () => {
    expect(docIdFromMeta("a")).toBe("a::0");
  });
});

describe("touchOpened", () => {
  const base: LibraryDoc[] = [
    {
      id: "a",
      title: "A",
      source: "sample",
      url: "/a.pdf",
      addedAt: 100,
      lastOpenedAt: 100,
    },
    {
      id: "b",
      title: "B",
      source: "sample",
      url: "/b.pdf",
      addedAt: 200,
      lastOpenedAt: 200,
    },
  ];

  it("bumps lastOpenedAt and sorts most-recent first", () => {
    const next = touchOpened(base, "a");
    expect(next[0]?.id).toBe("a");
    expect(next[0]?.lastOpenedAt).toBeGreaterThan(100);
    expect(next[1]?.id).toBe("b");
  });
});

describe("library + doc store persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips the library and strips ephemeral blob URLs", () => {
    saveLibrary([
      {
        id: "sample",
        title: "Welcome",
        source: "sample",
        url: "/samples/octavo-welcome.pdf",
        addedAt: 1,
      },
      {
        id: "file",
        title: "Local",
        source: "file",
        url: "blob:http://localhost/abc",
        addedAt: 2,
      },
    ]);
    const loaded = loadLibrary();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.url).toBe("/samples/octavo-welcome.pdf");
    expect(loaded[1]?.url).toBe("");
  });

  it("loads defaults then upserts annotations and extras", () => {
    expect(loadDocStore("doc-1")).toMatchObject({
      annotations: [],
      lastPage: 1,
      zoom: 1.1,
      rotation: 0,
      viewMode: "continuous",
    });

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
      { lastPage: 3, zoom: 1.5, rotation: 90, viewMode: "single" },
    );

    expect(loadDocStore("doc-1")).toEqual({
      annotations: [
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
      lastPage: 3,
      zoom: 1.5,
      rotation: 90,
      viewMode: "single",
    });
  });

  it("saveDocStore overwrites the stored document", () => {
    saveDocStore("doc-2", {
      annotations: [],
      lastPage: 9,
      zoom: 2,
      rotation: 180,
      viewMode: "single",
    });
    expect(loadDocStore("doc-2").lastPage).toBe(9);
  });
});
