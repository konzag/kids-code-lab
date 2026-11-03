// The packaged editor (docs/BUILD.md "Checks"), served on 127.0.0.1:
// - a tiny project runs in the simulator and the .png cartridge can be saved,
// - ZERO requests outside 127.0.0.1, no service worker, no CSP violation (with CSP set), no console error,
// - the cloud UI is absent (sign-in, share, GitHub, extensions, AI help, cloud import),
// - Greek by default, English selectable (URL and MakeCode's own language menu).
// Every request is recorded in test-results/editor-*.json.
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { recordAll, summarize, watchPage } from "./record.mjs";

const RED = "255,33,33,255";

async function newProject(page, name = "spike") {
  await page.locator(".newprojectcard").first().click();
  await page.fill("#projectNameInput", name);
  await page.locator(".ui.modal button.approve").click();
  await page.waitForSelector(".blocklySvg", { timeout: 90_000 });
  // first-run editor tour bubble (appears a moment after the workspace)
  const tour = page.locator(".teaching-bubble-close");
  await tour.waitFor({ state: "visible", timeout: 15_000 }).then(() => tour.click()).catch(() => {});
}

function save(name, rec, errors, extra = {}) {
  mkdirSync("test-results", { recursive: true });
  writeFileSync(`test-results/editor-${name}.json`, JSON.stringify({
    csp: process.env.CSP ?? "none", total: rec.requests.length, byHost: summarize(rec.requests), external: rec.external,
    violations: rec.violations, consoleErrors: errors, ...extra, requests: rec.requests,
  }, null, 1));
}

test("editor: block project runs in the simulator, offline, no service worker", async ({ context }) => {
  const rec = await recordAll(context);
  const page = await context.newPage();
  const errors = watchPage(page, rec);

  await page.goto("/kids-code-lab/index.html");
  await newProject(page);

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

  await expect
    .poll(async () => {
      const sim = page.frames().filter((f) => !f.isDetached() && /simulator\.html/.test(f.url())).pop();
      if (!sim) return "no frame";
      return sim.evaluate(() => {
        const c = document.getElementById("game-screen");
        if (!c || c.classList.contains("hidden")) return "hidden";
        return Array.from(c.getContext("2d").getImageData(c.width >> 1, c.height >> 1, 1, 1).data).join(",");
      });
    }, { timeout: 60_000 })
    .toBe(RED);

  // the editor's simulator frame is sandboxed without allow-same-origin (opaque origin): the game cannot reach the
  // site's cookies, storage, parent page or same-origin API (the probe's own blocked fetch of /api/profiles is
  // filtered out of the console/CSP checks below)
  const simFrame = page.locator("iframe[id^='sim-frame-']").first();
  expect(await simFrame.getAttribute("sandbox")).toBe("allow-scripts");
  const probe = await page.frames().filter((f) => !f.isDetached() && /simulator\.html/.test(f.url())).pop().evaluate(async () => {
    const r = { origin: self.origin };
    try { r.cookie = document.cookie; } catch (e) { r.cookie = "blocked:" + e.name; }
    try { r.storage = localStorage.length; } catch (e) { r.storage = "blocked:" + e.name; }
    try { r.parentDom = !!window.parent.document; } catch (e) { r.parentDom = "blocked:" + e.name; }
    try { const res = await fetch("/api/profiles"); r.fetch = "status " + res.status; } catch (e) { r.fetch = "blocked:" + e.name; }
    return r;
  });
  expect(probe.origin).toBe("null");
  for (const k of ["cookie", "storage", "parentDom", "fetch"]) expect(String(probe[k]), k).toMatch(/^blocked:/);

  // the .png cartridge (project source inside the image) is a data: URL download: the child's backup
  const dl = page.waitForEvent("download", { timeout: 60_000 });
  await page.locator(".save-editortools-btn").first().click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/\.png$/);

  // no service worker, even with service workers allowed in the browser context (SW=allow)
  const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  expect(regs).toBe(0);
  expect(context.serviceWorkers()).toHaveLength(0);

  const notProbe = (t) => !/\/api\/profiles/.test(t);
  save("run", rec, errors.filter(notProbe), { sandboxProbe: probe });
  expect(rec.external, "requests outside 127.0.0.1").toEqual([]);
  expect(rec.violations.filter(notProbe), "CSP violations").toEqual([]);
  expect(errors.filter(notProbe), "console errors").toEqual([]);
});

test("editor: no cloud UI (sign-in, share, GitHub, extensions, AI, cloud import)", async ({ context }) => {
  const rec = await recordAll(context);
  const page = await context.newPage();
  const errors = watchPage(page, rec);
  await page.goto("/kids-code-lab/index.html");

  // MakeCode home page: no sign-in, no hero/galleries, import offers files only
  await expect(page.locator(".newprojectcard").first()).toBeVisible();
  await expect(page.locator(".sign-in-dropdown, .signin-button, [aria-label='Sign In'], [aria-label='Σύνδεση']")).toHaveCount(0);
  // only the "My Projects" section: no hero carousel, no galleries (skillmaps, tutorials, community games)
  await expect(page.getByRole("main").getByRole("region")).toHaveCount(1);
  await expect(page.locator(".hero-banner-contents, .hero-banner")).toHaveCount(0);
  // no links out of the site on the home page (MakeCode org, terms, privacy, GitHub)
  const outLinks = await page.locator("a[href^='http']").evaluateAll((as) => as.map((a) => a.href).filter((h) => !h.startsWith(location.origin)));
  expect(outLinks, "links leaving the site").toEqual([]);
  const importBtn = page.locator(".import-dialog-btn");
  if (await importBtn.count()) {
    await importBtn.first().click();
    const dialog = page.locator(".ui.modal.visible, [role=dialog]").last();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".importurl, [aria-label*='URL'], [aria-label*='github' i], .importgithub")).toHaveCount(0);
    await page.keyboard.press("Escape");
  }

  await newProject(page, "cloud");
  // editor menu bar and toolbar
  await expect(page.locator(".shareproject, [aria-label='Share Project'], [aria-label='Κοινοποίηση έργου']")).toHaveCount(0);
  await expect(page.locator(".editortools-github-btn")).toHaveCount(0);
  await expect(page.locator(".sign-in-dropdown, [aria-label='Sign In'], [aria-label='Σύνδεση']")).toHaveCount(0);
  // toolbox: no "Extensions" category
  await expect(page.locator(".blocklyTreeRow[data-ns='addpackage'], .blocklyTreeLabel:text-is('Extensions'), .blocklyTreeLabel:text-is('Επεκτάσεις')")).toHaveCount(0);
  // settings menu: no extensions / GitHub / sign-in entries
  await page.locator(".settings-menuitem, [aria-label='Settings'], [aria-label='Ρυθμίσεις']").first().click();
  const visibleItems = page.locator("[role=menuitem]:visible");
  await expect(visibleItems.first()).toBeVisible();
  const items = (await visibleItems.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  expect(items.length, "settings menu opened").toBeGreaterThan(3);
  for (const bad of [/extension/i, /επέκταση|επεκτάσεις/i, /github/i, /sign in|σύνδεση/i, /share|κοινοποίηση/i]) {
    expect(items.filter((t) => bad.test(t)), `settings menu entry ${bad}`).toEqual([]);
  }
  await page.keyboard.press("Escape");
  // AI error help: make a JavaScript error and check that no "Explain with AI" control appears
  await page.locator(".javascript-menuitem").first().click();
  await page.waitForSelector(".monaco-editor textarea", { timeout: 60_000 });
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.type("let x: number = \"not a number\"\n");
  await page.waitForTimeout(3000);
  await expect(page.locator(".error-help-button:visible")).toHaveCount(0);

  save("cloud-ui", rec, errors, { settingsMenu: items });
  expect(rec.external, "requests outside 127.0.0.1").toEqual([]);
});

test("languages: Greek by default, English selectable, only en/el offered", async ({ context }) => {
  const rec = await recordAll(context);
  const page = await context.newPage();
  const errors = watchPage(page, rec);

  // default (no ?lang=, no cookie): Greek
  await page.goto("/kids-code-lab/index.html");
  await newProject(page, "lang");
  await expect(page.locator(".blocklyTreeLabel", { hasText: "Βρόχοι" }).first()).toBeVisible();
  expect(await page.evaluate(() => pxt.Util.userLanguage())).toBe("el");

  // MakeCode's language menu lists exactly English and Greek; choosing English switches and is remembered
  await page.locator(".settings-menuitem, [aria-label='Ρυθμίσεις']").first().click();
  await page.locator("[role=menuitem], .item").filter({ hasText: /Γλώσσα|Language/ }).first().click();
  const langDialog = page.locator(".ui.modal.visible, [role=dialog]").last();
  await expect(langDialog).toBeVisible();
  const cards = langDialog.locator(".langoption");
  const labels = (await cards.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  expect(labels.length, `language options: ${labels.join(" | ")}`).toBe(2);
  // no in-context translation (Crowdin) and no "add a language" link
  await expect(langDialog.locator("#langmodalfooter")).toHaveCount(0);
  await langDialog.locator(".langoption[aria-label=English]").click();
  await page.waitForLoadState("load");
  await page.waitForSelector(".blocklySvg, .newprojectcard", { timeout: 90_000 });
  expect(await page.evaluate(() => pxt.Util.userLanguage())).toBe("en");
  await page.reload();
  await page.waitForSelector(".blocklySvg, .newprojectcard", { timeout: 90_000 });
  expect(await page.evaluate(() => pxt.Util.userLanguage()), "English remembered after reload").toBe("en");

  // the lab page can force a language with ?lang=
  await page.goto("/kids-code-lab/index.html?lang=el");
  await page.waitForSelector(".blocklySvg, .newprojectcard", { timeout: 90_000 });
  expect(await page.evaluate(() => pxt.Util.userLanguage())).toBe("el");

  save("languages", rec, errors, { languageOptions: labels });
  expect(rec.external, "requests outside 127.0.0.1").toEqual([]);
});
