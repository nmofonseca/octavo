/** Zoom bounds and step shared by toolbar, keyboard, and Ctrl/Meta+wheel. */
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.1;
export const ZOOM_PRESETS: number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function zoomIn(zoom: number): number {
  return Math.min(ZOOM_MAX, +(zoom + ZOOM_STEP).toFixed(2));
}

export function zoomOut(zoom: number): number {
  return Math.max(ZOOM_MIN, +(zoom - ZOOM_STEP).toFixed(2));
}

/**
 * Next zoom from a wheel delta when a modifier is held.
 * Negative deltaY (wheel up) zooms in; positive zooms out.
 */
export function nextZoomFromWheelDelta(zoom: number, deltaY: number): number {
  if (deltaY < 0) return zoomIn(zoom);
  if (deltaY > 0) return zoomOut(zoom);
  return +zoom.toFixed(2);
}

export type WheelZoomInput = {
  ctrlKey: boolean;
  metaKey: boolean;
  deltaY: number;
};

export type WheelZoomResult =
  | { handled: false }
  | { handled: true; nextZoom: number };

/** Decide whether a wheel event should zoom the viewer (Ctrl or Meta held). */
export function applyWheelZoom(
  zoom: number,
  e: WheelZoomInput,
): WheelZoomResult {
  if (!(e.ctrlKey || e.metaKey)) return { handled: false };
  return { handled: true, nextZoom: nextZoomFromWheelDelta(zoom, e.deltaY) };
}
