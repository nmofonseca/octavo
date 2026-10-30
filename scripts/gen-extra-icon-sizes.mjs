#!/usr/bin/env node
/**
 * Tauri's `tauri icon` omits some Linux titlebar sizes (16/24/48/256).
 * Generate those from app-icon.png so hicolor + _NET_WM_ICON cover KDE menus.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const py = `
from pathlib import Path
from PIL import Image

root = Path(${JSON.stringify(root)})
master = Image.open(root / "src-tauri" / "app-icon.png").convert("RGBA")
icons = root / "src-tauri" / "icons"
for size in (16, 24, 48, 256):
    out = icons / f"{size}x{size}.png"
    master.resize((size, size), Image.Resampling.LANCZOS).save(out, optimize=True)
    print("wrote", out)

pub = root / "public"
win = master.resize((256, 256), Image.Resampling.LANCZOS)
win.save(pub / "octavo-window-icon.png", optimize=True)
master.save(pub / "octavo-icon.png", optimize=True)
print("wrote public/octavo-window-icon.png and public/octavo-icon.png")
`;

const result = spawnSync("python3", ["-c", py], { encoding: "utf8" });
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
process.exit(result.status ?? 1);
