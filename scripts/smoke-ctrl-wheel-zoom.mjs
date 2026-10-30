/**
 * Smoke: Ctrl/Meta+wheel zoom on the reader stage.
 * Expects vite preview (or dev) already serving on PORT (default 4173).
 */
import { chromium } from "playwright";

const PORT = process.env.PORT || "4173";
const BASE = `http://127.0.0.1:${PORT}`;

async function zoomPct(page) {
  return page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Zoom preset"]');
    const opt = sel?.selectedOptions?.[0];
    const text = opt?.textContent?.trim() || "";
    const m = text.match(/(\d+)\s*%/);
    return m ? Number(m[1]) : null;
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const failures = [];

  try {
    await page.goto(`${BASE}/?open=/samples/octavo-welcome.pdf`, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector(".stage", { timeout: 15000 });
    await page.waitForSelector(".page-stack canvas, canvas.pdf-canvas", {
      timeout: 20000,
    });

    const stage = page.locator(".stage");
    const initial = await zoomPct(page);
    console.log("initial zoom %:", initial);
    if (initial == null) failures.push("could not read zoom %");

    // Plain wheel scrolls; must not change zoom.
    const box = await stage.boundingBox();
    if (!box) throw new Error("no stage box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(150);
    const scrollAfterPlain = await stage.evaluate((el) => el.scrollTop);
    const afterPlain = await zoomPct(page);
    console.log("plain wheel scrollTop:", scrollAfterPlain, "zoom%:", afterPlain);
    if (afterPlain !== initial) {
      failures.push(`plain wheel changed zoom: ${initial} → ${afterPlain}`);
    }

    // Ctrl+wheel zoom in/out via WheelEvent (Playwright mouse.wheel has no modifiers).
    await page.evaluate(() => {
      document.querySelector(".stage").dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -120,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const afterCtrlIn = await zoomPct(page);
    console.log("after Ctrl+wheel in:", afterCtrlIn);
    if (afterCtrlIn !== initial + 10) {
      failures.push(`Ctrl+wheel in: expected ${initial + 10}, got ${afterCtrlIn}`);
    }

    await page.evaluate(() => {
      document.querySelector(".stage").dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: 120,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const afterCtrlOut = await zoomPct(page);
    console.log("after Ctrl+wheel out:", afterCtrlOut);
    if (afterCtrlOut !== initial) {
      failures.push(`Ctrl+wheel out: expected ${initial}, got ${afterCtrlOut}`);
    }

    await page.evaluate(() => {
      document.querySelector(".stage").dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -120,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const afterMeta = await zoomPct(page);
    console.log("after Meta+wheel in:", afterMeta);
    if (afterMeta !== initial + 10) {
      failures.push(`Meta+wheel in: expected ${initial + 10}, got ${afterMeta}`);
    }

    // Toolbar +/- still work
    const beforePlus = await zoomPct(page);
    await page.getByRole("button", { name: "Zoom in" }).click();
    const afterPlus = await zoomPct(page);
    await page.getByRole("button", { name: "Zoom out" }).click();
    const afterMinus = await zoomPct(page);
    console.log("toolbar +/-:", beforePlus, "→", afterPlus, "→", afterMinus);
    if (afterPlus !== beforePlus + 10) {
      failures.push(`toolbar Zoom in: expected ${beforePlus + 10}, got ${afterPlus}`);
    }
    if (afterMinus !== beforePlus) {
      failures.push(`toolbar Zoom out: expected ${beforePlus}, got ${afterMinus}`);
    }

    // Find / undo shortcuts unaffected
    await page.keyboard.press("Control+f");
    await page.waitForSelector(".find-bar", { timeout: 3000 });
    console.log("Ctrl+F find bar: OK");
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+z");
    await page.waitForSelector(".stage", { timeout: 2000 });
    console.log("Ctrl+Z: reader still up OK");

    if (failures.length) {
      console.error("SMOKE FAIL:", failures);
      process.exitCode = 1;
    } else {
      console.log("SMOKE PASS");
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
