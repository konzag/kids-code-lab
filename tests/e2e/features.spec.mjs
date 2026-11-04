// MakeCode features the spike did not cover, under the games-hub ADR-0006 policies (CI: CSP=adr HUB_HEADERS=1):
// the asset editor (image, tile, tilemap, animation), the music editor (song) and a shipped tutorial, inside the lab's
// editor page. Each run: 0 CSP violations, 0 console errors, 0 requests outside 127.0.0.1.
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { recordAll, summarize, watchPage } from "./record.mjs";
import { FakeHub } from "./fake-hub.mjs";

test.setTimeout(240_000);

async function openEditor(context, query = "new=1") {
  const rec = await recordAll(context);
  const hub = new FakeHub();
  await hub.install(context);
  const page = await context.newPage();
  const errors = watchPage(page, rec);
  await page.goto(`/kids-code-lab/lab/edit.html?${query}`);
  const ed = page.frameLocator("#editor-frame");
  return { rec, page, errors, ed };
}

function check(name, rec, errors) {
  mkdirSync("test-results", { recursive: true });
  writeFileSync(`test-results/feature-${name}.json`, JSON.stringify({ csp: process.env.CSP ?? "none", byHost: summarize(rec.requests),
    external: rec.external, violations: rec.violations, consoleErrors: errors }, null, 1));
  expect(rec.external, "requests outside 127.0.0.1").toEqual([]);
  expect(rec.violations, "CSP violations").toEqual([]);
  expect(errors, "console errors").toEqual([]);
}

async function closeTour(ed) {
  const tour = ed.locator(".teaching-bubble-close");
  await tour.waitFor({ state: "visible", timeout: 10_000 }).then(() => tour.click()).catch(() => {});
}

// the size of the open project's files in MakeCode's IndexedDB (assets are saved into its .jres/.ts files)
async function projectSize(page) {
  return page.evaluate(async () => {
    const mc = await import("/kids-code-lab/lab/mc.js");
    const [p] = await mc.listProjects();
    const prj = p ? await mc.readProject(p.id) : null;
    return prj ? JSON.stringify(prj.files).length : 0;
  });
}

// draw on the asset's canvas: a few clicks spread over it
async function paint(page, canvas) {
  const box = await canvas.boundingBox();
  for (const [fx, fy] of [[0.3, 0.3], [0.5, 0.5], [0.7, 0.4]]) await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

for (const kind of ["Image", "Tile", "Tilemap", "Animation"]) {
  test(`asset editor: create and draw a ${kind}`, async ({ context }) => {
    const { rec, page, errors, ed } = await openEditor(context);
    await ed.locator(".blocklySvg").first().waitFor({ timeout: 90_000 });
    await closeTour(ed);
    await ed.locator(".assets-menuitem").first().click();
    await page.waitForTimeout(1500);
    const before = await projectSize(page);
    await ed.locator(".create-new").first().click();
    await ed.locator(`[aria-label="Create a new ${kind} asset"]`).click();
    const canvas = ed.locator("canvas.paint-surface.main").first();
    await canvas.waitFor({ state: "visible", timeout: 30_000 });
    await paint(page, canvas);
    await ed.locator(".image-editor-confirm").first().click();
    await expect(canvas).toBeHidden({ timeout: 15_000 });
    // the new asset is saved with the project
    await expect.poll(() => projectSize(page), { timeout: 15_000 }).toBeGreaterThan(before);
    check(`asset-${kind.toLowerCase()}`, rec, errors);
  });
}

test("music editor: create a song, place notes, play it", async ({ context }) => {
  const { rec, page, errors, ed } = await openEditor(context);
  await ed.locator(".blocklySvg").first().waitFor({ timeout: 90_000 });
  await closeTour(ed);
  await ed.locator(".assets-menuitem").first().click();
  await ed.locator(".create-new").first().click();
  await ed.locator('[aria-label="Create a new Song asset"]').click();
  const staff = ed.locator("svg.music-workspace").first();
  await staff.waitFor({ state: "visible", timeout: 30_000 });
  const box = await staff.boundingBox();
  for (const [fx, fy] of [[0.15, 0.4], [0.3, 0.5], [0.45, 0.35]]) await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  // a second instrument, then play / stop the song in the editor (Web Audio, no network)
  await ed.locator(".music-track-button[title='Drums']").click();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
  const play = ed.locator(".music-playback-buttons button[title='Play']");
  await expect(play).toHaveCount(1);
  await play.click();
  await page.waitForTimeout(1500);
  await ed.locator(".music-playback-buttons button").first().click(); // stop («Διακοπή»)
  await ed.locator("button.green", { hasText: /Ολοκλήρωση|Done/ }).first().click();
  await expect(staff).toBeHidden({ timeout: 15_000 });
  check("music", rec, errors);
});

test("tutorial: a shipped tutorial starts and steps through to the end", async ({ context }) => {
  const { rec, page, errors, ed } = await openEditor(context, "tutorial=intro");
  // the tutorial's start dialog (its button reads «ΟΚ», Greek letters)
  const ok = ed.getByRole("dialog").getByRole("button", { name: /^(OK|ΟΚ|Εντάξει)$/ }).first();
  await ok.waitFor({ state: "visible", timeout: 90_000 });
  // no "Immersive Reader" (a Microsoft cloud service) in the dialog
  await expect(ed.getByRole("button", { name: /Immersive Reader/i })).toHaveCount(0);
  await ok.click();
  const label = ed.getByText(/^(Step|Βήμα) \d+ (of|από) \d+$/).filter({ visible: true }).first();
  await expect(label).toBeVisible({ timeout: 30_000 });
  const next = ed.getByRole("button", { name: /next step of the tutorial|επόμενο βήμα/i }).first();
  const nums = (s) => (s.match(/\d+/g) || []).map(Number);
  let text = await label.innerText();
  let guard = 0;
  // "Step N of M" (or the Greek text): step until N = M
  while (guard < 40) {
    const [n, m] = nums(text);
    if (n && m && n >= m) break;
    await next.click();
    guard++;
    // a step that checks the code asks first: continue anyway
    const cont = ed.locator(".tutorial-validation-error-controls button").last();
    if (await cont.isVisible().catch(() => false)) await cont.click();
    const dlgOk = ed.getByRole("dialog").getByRole("button", { name: /^(OK|ΟΚ|Εντάξει)$/ }).first();
    if (await dlgOk.isVisible().catch(() => false)) await dlgOk.click();
    await expect.poll(() => label.innerText(), { timeout: 10_000 }).not.toBe(text);
    text = await label.innerText();
  }
  const [n, m] = nums(text);
  expect(m, "steps in the tutorial").toBeGreaterThan(5);
  expect(n, `reached the last step (${text})`).toBe(m);
  check("tutorial", rec, errors);
});

