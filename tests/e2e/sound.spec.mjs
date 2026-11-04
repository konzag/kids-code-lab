// Sound in the sandboxed simulator frame under the games-hub ADR-0006 policies (CI: CSP=adr HUB_HEADERS=1).
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { recordAll, summarize, watchPage } from "./record.mjs";
import { FakeHub } from "./fake-hub.mjs";

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


// Sound in the simulator frame (sandboxed, ADR-0006 simulator CSP): a game that plays a melody and a sound effect.
// Chromium is started without the autoplay gesture rule so the audio really starts in headless runs.
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });
test.setTimeout(240_000);

test("a game plays music in the simulator", async ({ context }) => {
    const { rec, page, errors, ed } = await openEditor(context);
    await ed.locator(".blocklySvg").first().waitFor({ timeout: 90_000 });
    await closeTour(ed);
    await ed.locator(".javascript-menuitem").first().click();
    await ed.locator(".monaco-editor textarea").first().waitFor({ state: "attached", timeout: 60_000 });
    await ed.locator(".monaco-editor").first().click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await page.keyboard.type("scene.setBackgroundColor(2)\nmusic.play(music.melodyPlayable(music.powerUp), music.PlaybackMode.LoopingInBackground)\nmusic.play(music.stringPlayable(\"C D E F G A B C5 \", 240), music.PlaybackMode.InBackground)\n");
    await page.waitForTimeout(1500);
    await ed.locator(".blocks-menuitem").first().click();
    // the simulator runs the game (red background) and plays for a few seconds
    await expect.poll(async () => {
      const sim = page.frames().filter((f) => !f.isDetached() && /simulator\.html/.test(f.url())).pop();
      if (!sim) return "no frame";
      return sim.evaluate(() => {
        const c = document.getElementById("game-screen");
        return !c || c.classList.contains("hidden") ? "hidden" : Array.from(c.getContext("2d").getImageData(2, 2, 1, 1).data).join(",");
      });
    }, { timeout: 60_000 }).toBe("255,33,33,255");
    await page.waitForTimeout(4000);
    check("sim-sound", rec, errors);
  });
