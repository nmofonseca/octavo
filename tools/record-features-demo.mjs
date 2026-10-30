/**
 * Record Octavo feature demo (web UI) via Playwright video → mp4.
 * Expects vite already serving on PORT (default 1420).
 *
 * Usage: node scripts/record-features-demo.mjs
 */
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = process.env.PORT || "1420";
const BASE = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(ROOT, "docs", "media");
const OUT_MP4 = path.join(OUT_DIR, "octavo-features-demo.mp4");
const STORE_MEDIA =
  process.env.OCTAVO_STORE_MEDIA ||
  "/cursor/stores/self/media/octavo-features-demo.mp4";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPagePaint(page) {
  await page.waitForSelector(".page-stack canvas.pdf-canvas", { timeout: 30000 });
  await page.waitForFunction(() => {
    const c = document.querySelector(".page-stack canvas.pdf-canvas");
    return c && c.width > 40 && c.height > 40;
  }, null, { timeout: 30000 });
  await sleep(800);
}

async function dragHighlight(page) {
  const canvas = page.locator(".page-stack.active-page canvas.pdf-canvas, .page-stack canvas.pdf-canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas for highlight");
  const x1 = box.x + box.width * 0.18;
  const y1 = box.y + box.height * 0.28;
  const x2 = box.x + box.width * 0.72;
  const y2 = box.y + box.height * 0.36;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 18 });
  await page.mouse.up();
  await sleep(600);
}

async function drawInk(page) {
  const canvas = page.locator(".page-stack.active-page canvas.pdf-canvas, .page-stack canvas.pdf-canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas for ink");
  const cx = box.x + box.width * 0.55;
  const cy = box.y + box.height * 0.55;
  await page.mouse.move(cx - 40, cy);
  await page.mouse.down();
  for (const [dx, dy] of [
    [20, -25],
    [40, 10],
    [60, -15],
    [80, 20],
    [100, -5],
  ]) {
    await page.mouse.move(cx - 40 + dx, cy + dy, { steps: 6 });
  }
  await page.mouse.up();
  await sleep(500);
}

async function placeNote(page) {
  const canvas = page.locator(".page-stack.active-page canvas.pdf-canvas, .page-stack canvas.pdf-canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas for note");
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.45);
  await sleep(400);
  const sticky = page.locator(".sticky textarea, .sticky input, .sticky").first();
  if (await sticky.count()) {
    await sticky.click({ force: true }).catch(() => {});
    await page.keyboard.type("Octavo sticky note", { delay: 35 });
    await sleep(400);
  }
}

async function runDemo(page) {
  // 1. Library
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForSelector(".brand", { timeout: 15000 });
  await sleep(1400);

  // 2. Open sample
  await page.getByRole("button", { name: "Open sample PDF" }).click();
  await waitForPagePaint(page);
  await sleep(1200);

  // 3. Thumbnails visible; flip pages
  await page.getByRole("button", { name: "Next page" }).click();
  await sleep(900);
  await page.getByRole("button", { name: "Next page" }).click();
  await sleep(900);
  await page.getByRole("button", { name: "Previous page" }).click();
  await sleep(700);
  await page.getByRole("button", { name: "Previous page" }).click();
  await sleep(800);

  // 4. Outline
  await page.getByRole("button", { name: "Outline" }).click();
  await sleep(1200);
  const outlineItem = page.locator(".outline-item, .outline button, aside button").first();
  if (await outlineItem.count()) {
    await outlineItem.click().catch(() => {});
    await sleep(900);
  }
  await page.getByRole("button", { name: "Thumbnails" }).click();
  await sleep(800);

  // 5. Find
  await page.getByRole("button", { name: "Find (Ctrl/Cmd+F)" }).click();
  await page.waitForSelector(".find-bar input", { timeout: 5000 });
  await page.locator(".find-bar input").fill("annotation");
  await sleep(1600);
  const nextMatch = page.getByRole("button", { name: "Next match" });
  if (await nextMatch.isEnabled().catch(() => false)) {
    await nextMatch.click();
    await sleep(900);
  }
  await page.getByRole("button", { name: "Close find" }).click();
  await sleep(500);

  // 6. Highlight
  await page.getByRole("button", { name: "Highlight" }).click();
  await sleep(300);
  await dragHighlight(page);
  await sleep(700);

  // 7. Ink
  await page.getByRole("button", { name: "Ink" }).click();
  await sleep(300);
  await drawInk(page);
  await sleep(600);

  // 8. Sticky note
  await page.getByRole("button", { name: "Sticky note" }).click();
  await sleep(300);
  await placeNote(page);
  await sleep(900);

  // 9. Rotate + fit + zoom
  await page.getByRole("button", { name: "Rotate right" }).click();
  await sleep(900);
  await page.getByRole("button", { name: "Rotate left" }).click();
  await sleep(700);
  await page.getByRole("button", { name: "Fit width" }).click();
  await sleep(900);
  await page.getByRole("button", { name: "Fit page" }).click();
  await sleep(900);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await sleep(400);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await sleep(600);
  await page.getByRole("button", { name: "Zoom out" }).click();
  await sleep(500);

  // 10. Continuous ↔ single
  const modeBtn = page.locator('button[data-tool="mode"]');
  await modeBtn.click();
  await sleep(1000);
  await modeBtn.click();
  await sleep(900);

  // 11. Back to library
  await page.getByRole("button", { name: "← Library" }).click();
  await page.waitForSelector(".brand", { timeout: 10000 });
  await sleep(1500);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "octavo-demo-"));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: { dir: tmpDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  try {
    console.log("Recording feature demo against", BASE);
    await runDemo(page);
  } finally {
    const video = page.video();
    await page.close();
    await context.close();
    await browser.close();

    const webm = video ? await video.path() : null;
    if (!webm || !fs.existsSync(webm)) {
      throw new Error("Playwright did not produce a video file");
    }
    console.log("raw video:", webm, fs.statSync(webm).size, "bytes");

    const ff = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-i",
        webm,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-an",
        OUT_MP4,
      ],
      { encoding: "utf8" },
    );
    if (ff.status !== 0) {
      console.error(ff.stderr);
      throw new Error(`ffmpeg failed with status ${ff.status}`);
    }
    console.log("wrote", OUT_MP4, fs.statSync(OUT_MP4).size, "bytes");

    fs.mkdirSync(path.dirname(STORE_MEDIA), { recursive: true });
    fs.copyFileSync(OUT_MP4, STORE_MEDIA);
    console.log("copied", STORE_MEDIA, fs.statSync(STORE_MEDIA).size, "bytes");

    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
