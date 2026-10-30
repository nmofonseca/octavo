/**
 * Browser simulation of Octavo blank-main-page + thumbs-OK regression.
 * Uses Chromium via Playwright against local vite + fixture HTTP servers.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const STORE =
  "/home/nmof/.local/state/cursor/agent-stores/cursor_agent_stores/bc-a3f02463-9e41-4285-8e0d-7781913ce3a2/files";
const MEDIA = path.join(STORE, "media");
const FIXTURE = path.join(
  STORE,
  "fixtures/alphabet-practice-handwriting-sheets.pdf",
);
const WORKOUT = path.join(
  STORE,
  "fixtures/three-day-workout-schedule.pdf",
);

fs.mkdirSync(MEDIA, { recursive: true });

function inkRatioFromDataUrl(dataUrl) {
  // data:image/png;base64,...
  const b64 = dataUrl.split(",")[1];
  if (!b64) return 0;
  // Decode in page instead — this helper unused; keep for clarity
  return 0;
}

async function measureVisibleMainPages(page) {
  return page.evaluate(() => {
    const stacks = [...document.querySelectorAll(".page-stack")];
    const results = [];
    for (const stack of stacks) {
      const pageNum = Number(stack.getAttribute("data-page") || 0);
      const canvas = stack.querySelector("canvas.pdf-canvas");
      if (!canvas) {
        results.push({ page: pageNum, ink: 0, w: 0, h: 0, missing: true });
        continue;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx || !canvas.width || !canvas.height) {
        results.push({
          page: pageNum,
          ink: 0,
          w: canvas.width,
          h: canvas.height,
          empty: true,
        });
        continue;
      }
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let ink = 0;
      const step = 16; // sample every 4th pixel * 4 channels
      for (let i = 0; i < data.length; i += step) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // non-near-white counts as ink
        if (r < 245 || g < 245 || b < 245) ink++;
      }
      const samples = Math.ceil(data.length / step);
      results.push({
        page: pageNum,
        ink,
        samples,
        inkPct: samples ? (100 * ink) / samples : 0,
        w: canvas.width,
        h: canvas.height,
      });
    }
    const thumbs = [...document.querySelectorAll(".thumb img, .thumb-btn img, button.thumb img, .thumbs img")];
    // also try sidebar thumb images more broadly
    const sideImgs = [...document.querySelectorAll(".reader-sidebar img, aside img, [class*='thumb'] img")];
    const thumbStats = (sideImgs.length ? sideImgs : thumbs).map((img, i) => ({
      i: i + 1,
      w: img.naturalWidth,
      h: img.naturalHeight,
      srcLen: (img.getAttribute("src") || "").length,
      complete: img.complete,
    }));
    return {
      pages: results,
      thumbs: thumbStats,
      pageLabel: document.querySelector(".page-indicator, .toolbar")?.textContent?.slice(0, 80) ?? null,
    };
  });
}

async function openPdf(page, filePath, sampleUrl) {
  if (sampleUrl) {
    await page.goto(`http://127.0.0.1:5173/?open=${encodeURIComponent(sampleUrl)}`, {
      waitUntil: "networkidle",
    });
  } else {
    await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
    await page.waitForSelector('button:has-text("Open a file")');
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.click('button:has-text("Open a file")'),
    ]);
    await fileChooser.setFiles(filePath);
  }
  // Wait for reader chrome
  await page.waitForSelector(".page-stack, .pdf-canvas", { timeout: 60000 });
  // Give thumbs + main paints time on heavy docs
  await page.waitForTimeout(4000);
}

async function stress(page) {
  // zoom thrash
  for (const label of ["+", "−", "+", "+", "−"]) {
    const btn = page.locator(`button[aria-label*="${label === "+" ? "Zoom in" : "Zoom out"}"], button:has-text("${label}")`).first();
    if (await btn.count()) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(400);
    }
  }
  // scroll stage
  await page.evaluate(async () => {
    const stage = document.querySelector(".stage");
    if (!stage) return;
    for (const y of [400, 900, 1400, 0, 600]) {
      stage.scrollTop = y;
      await new Promise((r) => requestAnimationFrame(() => r()));
      await new Promise((r) => setTimeout(r, 250));
    }
  });
  // next/prev pages
  for (const aria of ["Next page", "Previous page", "Next", "Previous"]) {
    const btn = page.locator(`button[aria-label*="${aria}" i]`).first();
    if (await btn.count()) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }
  await page.waitForTimeout(2000);
}

async function runOne(browser, name, filePath, sampleUrl) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  // CPU throttle via CDP
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  console.log(`\n=== ${name} ===`);
  await openPdf(page, filePath, sampleUrl);

  const beforePath = path.join(MEDIA, `octavo-browser-before-${name}.png`);
  await page.screenshot({ path: beforePath, fullPage: false });
  console.log("screenshot", beforePath);

  let metrics = await measureVisibleMainPages(page);
  console.log("initial metrics", JSON.stringify(metrics, null, 2));

  await stress(page);
  const afterStress = path.join(MEDIA, `octavo-browser-stress-${name}.png`);
  await page.screenshot({ path: afterStress, fullPage: false });
  metrics = await measureVisibleMainPages(page);
  console.log("after stress", JSON.stringify(metrics, null, 2));

  const blanks = metrics.pages.filter((p) => !p.missing && (p.inkPct ?? 0) < 2);
  const okThumbs = metrics.thumbs.filter((t) => t.w > 40 && t.srcLen > 100);
  const summary = {
    name,
    blankMainPages: blanks.map((p) => p.page),
    visibleMain: metrics.pages.map((p) => ({
      page: p.page,
      inkPct: Number((p.inkPct ?? 0).toFixed(2)),
      w: p.w,
      h: p.h,
    })),
    thumbCount: metrics.thumbs.length,
    okThumbCount: okThumbs.length,
    screenshots: [beforePath, afterStress],
    ok: blanks.length === 0 && metrics.pages.length > 0,
  };
  await context.close();
  return summary;
}

const browser = await chromium.launch({ headless: true });
try {
  const alphabet = await runOne(
    browser,
    "alphabet",
    FIXTURE,
    "/samples/alphabet-practice-handwriting-sheets.pdf",
  );
  const workout = await runOne(
    browser,
    "workout",
    WORKOUT,
    "/samples/three-day-workout-schedule.pdf",
  );
  const out = { alphabet, workout, at: new Date().toISOString() };
  const outPath = path.join(STORE, "internal/octavo-browser-repro-after.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("\nSUMMARY", JSON.stringify(out, null, 2));
  console.log("wrote", outPath);
  if (!alphabet.ok || !workout.ok) {
    console.error("FAIL: blank main page(s) detected under scroll/zoom stress");
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
