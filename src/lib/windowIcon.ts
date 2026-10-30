/** Apply Logo B as the native window icon (Linux titlebar / window menu). */
export async function applyWindowIcon(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { Image } = await import("@tauri-apps/api/image");
    // Cache-busting filename + modest size: WebKit favicon DB may keep an old
    // yellow mark under /octavo-icon.png from earlier builds.
    const res = await fetch("/octavo-window-icon.png");
    if (!res.ok) return;
    const bytes = await res.arrayBuffer();
    const image = await Image.fromBytes(bytes);
    await getCurrentWindow().setIcon(image);
  } catch {
    // Browser preview / non-Tauri — ignore.
  }
}

/** Re-apply after load; WebKit can overwrite the window icon from favicon. */
export function scheduleWindowIconApply(): () => void {
  const run = () => {
    void applyWindowIcon();
  };
  run();
  const timers = [300, 1000, 2500].map((ms) => window.setTimeout(run, ms));
  window.addEventListener("focus", run);
  return () => {
    for (const id of timers) window.clearTimeout(id);
    window.removeEventListener("focus", run);
  };
}
