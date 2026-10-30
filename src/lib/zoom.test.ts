import { describe, expect, it } from "vitest";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PRESETS,
  ZOOM_STEP,
  applyWheelZoom,
  nextZoomFromWheelDelta,
  zoomIn,
  zoomOut,
} from "./zoom";

describe("zoom helpers", () => {
  it("exposes presets and step matching toolbar feel", () => {
    expect(ZOOM_PRESETS).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
    expect(ZOOM_STEP).toBe(0.1);
    expect(ZOOM_MIN).toBe(0.4);
    expect(ZOOM_MAX).toBe(3);
  });

  it("zooms in/out by 0.1 within bounds", () => {
    expect(zoomIn(1.15)).toBe(1.25);
    expect(zoomOut(1.15)).toBe(1.05);
    expect(zoomIn(2.95)).toBe(3);
    expect(zoomIn(3)).toBe(3);
    expect(zoomOut(0.45)).toBe(0.4);
    expect(zoomOut(0.4)).toBe(0.4);
  });

  it("maps wheel delta to zoom in/out", () => {
    expect(nextZoomFromWheelDelta(1, -100)).toBe(1.1);
    expect(nextZoomFromWheelDelta(1, 100)).toBe(0.9);
    expect(nextZoomFromWheelDelta(1, 0)).toBe(1);
    expect(nextZoomFromWheelDelta(3, -10)).toBe(3);
    expect(nextZoomFromWheelDelta(0.4, 10)).toBe(0.4);
  });
});

describe("applyWheelZoom", () => {
  it("ignores plain wheel (no modifier)", () => {
    expect(
      applyWheelZoom(1.15, { ctrlKey: false, metaKey: false, deltaY: -120 }),
    ).toEqual({ handled: false });
  });

  it("handles Ctrl+wheel zoom in and out", () => {
    expect(
      applyWheelZoom(1.15, { ctrlKey: true, metaKey: false, deltaY: -120 }),
    ).toEqual({ handled: true, nextZoom: 1.25 });
    expect(
      applyWheelZoom(1.15, { ctrlKey: true, metaKey: false, deltaY: 120 }),
    ).toEqual({ handled: true, nextZoom: 1.05 });
  });

  it("handles Meta/Cmd+wheel the same way", () => {
    expect(
      applyWheelZoom(1, { ctrlKey: false, metaKey: true, deltaY: -50 }),
    ).toEqual({ handled: true, nextZoom: 1.1 });
    expect(
      applyWheelZoom(1, { ctrlKey: false, metaKey: true, deltaY: 50 }),
    ).toEqual({ handled: true, nextZoom: 0.9 });
  });

  it("treats Ctrl+Meta as a zoom gesture", () => {
    expect(
      applyWheelZoom(2, { ctrlKey: true, metaKey: true, deltaY: 1 }),
    ).toEqual({ handled: true, nextZoom: 1.9 });
  });
});
