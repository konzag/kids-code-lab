// SPIKE-REPORT.md §3, §4, §6: the packaged editor, served on 127.0.0.1, makes a tiny project, runs it in the
// simulator and saves the .png cartridge with ZERO requests outside 127.0.0.1, no service worker and (with
// CSP=editor) zero CSP violations. Every request is recorded in test-results/editor-requests.json.
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { recordAll, summarize, watchPage } from "./record.mjs";

const QS = process.env.QS ?? "?lang=el";

test("editor: block project runs in the simulator, 0 external requests", async ({ context }) => {
  const rec = await recordAll(context);
  const page = await context.newPage();
  const errors = watchPage(page, rec);

  await page.goto(`/kids-code-lab/index.html${QS}`);
  await page.locator(".newprojectcard").first().click();
  await page.fill("#projectNameInput", "spike");
  await page.locator(".ui.modal button.approve").click();
  await page.waitForSelector(".blocklySvg", { timeout: 90_000 });
  const tour = page.locator(".teaching-bubble-close");
  // first-run editor tour bubble (appears a moment after the workspace)
  await tour.waitFor({ state: "visible", timeout: 15_000 }).then(() => tour.click()).catch(() => {});

  // tiny program typed in JavaScript, then shown as blocks (decompile) and run by the simulator
  await page.locator(".javascript-menuitem").first().click();
  await page.waitForSelector(".monaco-editor textarea", { timeout: 60_000 });
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.type("scene.setBackgroundColor(2)\n");
  await page.waitForTimeout(1500);
  await page.locator(".blocks-menuitem").first().click();
  await expect.poll(() => page.locator(".blocklyDraggable").count(), { timeout: 30_000 }).toBeGreaterThan(1);

  // simulator frame: the game screen turns red (palette colour 2 = #ff2121)
  await expect
    .poll(async () => {
      const sim = page.frames().find((f) => /simulator\.html/.test(f.url()));
      if (!sim) return "no frame";
      return sim.evaluate(() => {
        const c = document.getElementById("game-screen");
        if (!c || c.classList.contains("hidden")) return "hidden";
        return Array.from(c.getContext("2d").getImageData(c.width >> 1, c.height >> 1, 1, 1).data).join(",");
      });
    }, { timeout: 60_000 })
    .toBe("255,33,33,255");

  // the .png cartridge (project source inside the image) is a data: URL download
  const dl = page.waitForEvent("download", { timeout: 60_000 });
  await page.locator(".save-editortools-btn").first().click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/\.png$/);

  // §3: no service worker, even with service workers allowed in the browser context (SW=allow)
  const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  expect(regs).toBe(0);
  expect(context.serviceWorkers()).toHaveLength(0);

  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/editor-requests.json", JSON.stringify({
    qs: QS, csp: process.env.CSP ?? "none", total: rec.requests.length, byHost: summarize(rec.requests),
    external: rec.external, violations: rec.violations, consoleErrors: errors, requests: rec.requests,
  }, null, 1));
  expect(rec.external, "requests outside 127.0.0.1").toEqual([]);
  expect(rec.violations, "CSP violations").toEqual([]);
});
