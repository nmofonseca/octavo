/** Apply Logo B as the native window icon (Linux titlebar / window menu). */
export async function applyWindowIcon(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { Image } = await import("@tauri-apps/api/image");
    const res = await fetch("/octavo-icon.png");
    if (!res.ok) return;
    const bytes = await res.arrayBuffer();
    const image = await Image.fromBytes(bytes);
    await getCurrentWindow().setIcon(image);
  } catch {
    // Browser preview / non-Tauri — ignore.
  }
}
