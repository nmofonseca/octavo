#!/usr/bin/env node
/**
 * Fail if shipped icon assets still look like the old yellow "W" / default
 * Tauri mark instead of Logo B (orange octagon + book on black).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const py = `
from pathlib import Path
from PIL import Image
import sys

roots = [
    Path(${JSON.stringify(join(root, "src-tauri/icons"))}),
    Path(${JSON.stringify(join(root, "public"))}),
    Path(${JSON.stringify(join(root, "src-tauri/app-icon.png"))}),
]
files = []
for r in roots:
    if r.is_file():
        files.append(r)
    elif r.is_dir():
        for p in sorted(r.rglob("*")):
            if p.suffix.lower() in {".png", ".ico", ".icns"} and "ios" not in p.parts and "android" not in p.parts:
                files.append(p)

failed = []
for p in files:
    try:
        im = Image.open(p)
        n = getattr(im, "n_frames", 1)
    except Exception as e:
        failed.append(f"{p}: cannot open ({e})")
        continue
    for i in range(n):
        im.seek(i)
        frame = im.convert("RGBA")
        gold = orange = 0
        for r,g,b,a in frame.getdata():
            if a < 128:
                continue
            if r > 200 and 150 <= g <= 210 and b < 100:
                gold += 1
            if r > 200 and 70 <= g <= 160 and b < 80:
                orange += 1
        opaque = gold + orange
        if opaque > 20 and gold > orange * 2 and gold > 30:
            failed.append(f"{p} frame{i} {frame.size}: gold={gold} orange={orange} (looks like old yellow W)")
        elif opaque > 50 and orange == 0 and gold > 50:
            failed.append(f"{p} frame{i} {frame.size}: gold={gold} orange=0")

if failed:
    print("ICON CHECK FAILED — yellow/W signature still present:")
    for line in failed:
        print(" ", line)
    sys.exit(1)

print(f"OK — {len(files)} icon assets look like Logo B (no yellow W dominance)")
`;

const result = spawnSync("python3", ["-c", py], { encoding: "utf8" });
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
process.exit(result.status ?? 1);
