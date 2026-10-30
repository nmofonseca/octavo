import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  replacePresent,
  undoHistory,
} from "./history";

describe("annotation history", () => {
  it("undoes and redoes snapshots", () => {
    let h = createHistory<number[]>([1]);
    h = pushHistory(h, [1, 2]);
    h = pushHistory(h, [1, 2, 3]);
    expect(h.present).toEqual([1, 2, 3]);
    expect(canUndo(h)).toBe(true);

    h = undoHistory(h);
    expect(h.present).toEqual([1, 2]);
    expect(canRedo(h)).toBe(true);

    h = undoHistory(h);
    expect(h.present).toEqual([1]);
    expect(canUndo(h)).toBe(false);

    h = redoHistory(h);
    expect(h.present).toEqual([1, 2]);

    h = redoHistory(h);
    expect(h.present).toEqual([1, 2, 3]);
    expect(canRedo(h)).toBe(false);
  });

  it("clears future on new push after undo", () => {
    let h = createHistory([1]);
    h = pushHistory(h, [1, 2]);
    h = undoHistory(h);
    h = pushHistory(h, [1, 9]);
    expect(h.present).toEqual([1, 9]);
    expect(canRedo(h)).toBe(false);
  });

  it("replacePresent does not create undo step", () => {
    let h = createHistory(["a"]);
    h = pushHistory(h, ["a", "b"]);
    h = replacePresent(h, ["a", "b-edited"]);
    expect(canUndo(h)).toBe(true);
    h = undoHistory(h);
    expect(h.present).toEqual(["a"]);
  });
});
