// The play-only page (makecode/player) runs a compiled game without the editor (docs/BUILD.md, spike §7).
// 1. compile a small program with the packaged runner (run.html?code=...&sendBuilt=1 posts the pxtc
//    BuiltSimJsInfo JSON to its parent): the artefact the hub stores at publish time.
// 2. play.html?id=1 (no MakeCode script; simulator.html in a sandbox="allow-scripts" frame) runs it; on a tablet (820x1180 portrait, 1180x820 landscape) the
//    on-screen d-pad and A/B are shown and move the sprite. Every request must stay on 127.0.0.1.
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { recordAll, summarize, watchPage } from "./record.mjs";

const PROGRAM = [
  "scene.setBackgroundColor(2)",
  "let block = image.create(16, 16)",
  "block.fill(5)",
  "let s = sprites.create(block, SpriteKind.Player)",
  "controller.moveSprite(s)",
  "",
].join("\n");
const RED = "255,33,33,255"; // palette colour 2
let built;

const liveSim = (page) => page.frames().filter((f) => !f.isDetached() && /simulator\.html/.test(f.url())).pop();

async function screenPixel(page, xFrac, yFrac) {
  // the simulator driver may replace its frame; take the live one
  const sim = page.frames().filter((f) => !f.isDetached() && /simulator\.html/.test(f.url())).pop();
  if (!sim) return "no frame";
  return sim.evaluate(([x, y]) => {
    const c = document.getElementById("game-screen");
    if (!c || c.classList.contains("hidden")) return "hidden";
    return Array.from(c.getContext("2d").getImageData(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1).data).join(",");
  }, [xFrac, yFrac]);
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const rec = await recordAll(context);
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__built = null;
    window.addEventListener("message", (e) => { if (e.data && typeof e.data.js === "string") window.__built = e.data; });
  });
  await page.goto(`/kids-code-lab/run.html?code=${encodeURIComponent(PROGRAM)}&sendBuilt=1&nofooter=1`);
  await page.waitForFunction(() => window.__built, null, { timeout: 120_000 });
  built = await page.evaluate(() => window.__built);
  expect(rec.external, "compile step: requests outside 127.0.0.1").toEqual([]);
  await context.close();
});

for (const vp of [{ name: "desktop", width: 1280, height: 800 }, { name: "tablet-portrait", width: 820, height: 1180 }, { name: "tablet-landscape", width: 1180, height: 820 }]) {
  test(`play-only page runs the compiled game (${vp.name} ${vp.width}x${vp.height})`, async ({ browser }) => {
    const touch = vp.name.startsWith("tablet");
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: touch, isMobile: false });
    const rec = await recordAll(context);
    const page = await context.newPage();
    const errors = watchPage(page, rec);
    const body = JSON.stringify(built);
    const loaded = [];
    page.on("response", async (r) => loaded.push({ path: new URL(r.url()).pathname, bytes: (await r.body().catch(() => Buffer.alloc(0))).length }));
    // the hub API of a published game (games-hub ADR-0006), answered by the test
    await page.route("**/api/lab/games/1/binary", (route) => route.fulfill({ contentType: "application/json", body }));
    await page.goto("/kids-code-lab/play/play.html?id=1");

    // background red at a corner, yellow sprite in the middle
    await expect.poll(() => screenPixel(page, 0.02, 0.02), { timeout: 60_000 }).toBe(RED);
    const centre = await screenPixel(page, 0.5, 0.5);
    expect(centre).not.toBe(RED);

    const sim = page.frameLocator("#player iframe").last();
    const pad = sim.locator(".game-joystick-svg");
    const ab = sim.locator(".game-button-svg");
    if (vp.name === "desktop") {
      await page.keyboard.down("ArrowRight");
      await page.waitForTimeout(800);
      await page.keyboard.up("ArrowRight");
    } else {
      // on-screen controls visible and usable
      await expect(pad).toBeVisible();
      await expect(ab).toBeVisible();
      const padBox = await pad.boundingBox();
      const abBox = await ab.boundingBox();
      expect(padBox.width).toBeGreaterThan(80);
      expect(abBox.width).toBeGreaterThan(80);
      const right = await sim.locator(".dpad-right").boundingBox();
      await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(800);
      await page.mouse.up();
    }
    // the sprite left the middle
    await expect.poll(() => screenPixel(page, 0.5, 0.5), { timeout: 5_000 }).toBe(RED);

    // the game runs in an opaque-origin sandbox: no cookies, no storage, no same-origin API calls
    const frameEl = page.locator("#player iframe");
    expect(await frameEl.getAttribute("sandbox")).toBe("allow-scripts");
    // the probe below provokes errors/violations on purpose (blocked fetch); the checks use the state before it
    const errorsBeforeProbe = [...errors];
    const violationsBeforeProbe = [...rec.violations];
    const probe = await liveSim(page).evaluate(async () => {
      const r = { origin: self.origin };
      try { r.cookie = document.cookie; } catch (e) { r.cookie = "blocked:" + e.name; }
      try { r.storage = localStorage.length; } catch (e) { r.storage = "blocked:" + e.name; }
      try { r.parentDom = !!window.parent.document; } catch (e) { r.parentDom = "blocked:" + e.name; }
      try { const res = await fetch("/api/profiles"); r.fetch = "status " + res.status; } catch (e) { r.fetch = "blocked:" + e.name; }
      return r;
    });
    expect(probe.origin).toBe("null");
    expect(String(probe.cookie)).toMatch(/^blocked:/);
    expect(String(probe.storage)).toMatch(/^blocked:/);
    expect(String(probe.parentDom)).toMatch(/^blocked:/);
    expect(String(probe.fetch)).toMatch(/^blocked:/);

    mkdirSync("test-results", { recursive: true });
    await page.screenshot({ path: `test-results/play-${vp.name}.png` });
    writeFileSync(`test-results/play-${vp.name}.json`, JSON.stringify({
      csp: process.env.CSP ?? "none", viewport: vp, builtJsBytes: body.length, builtJsGzipBytes: gzipSync(body).length,
      byHost: summarize(rec.requests), external: rec.external, violations: violationsBeforeProbe, consoleErrors: errorsBeforeProbe,
      sandboxProbe: probe, playPageLoads: loaded,
    }, null, 1));
    expect(loaded.map((l) => l.path).filter((p) => /main\.js|target\.js|pxtembed\.js|pxtworker\.js/.test(p)), "no editor/compiler on the play page").toEqual([]);
    expect(rec.external, "requests outside 127.0.0.1").toEqual([]);
    expect(violationsBeforeProbe, "CSP violations").toEqual([]);
    expect(errorsBeforeProbe, "console errors").toEqual([]);
    await context.close();
  });
}

// Only ?id=<1-9 digits> is accepted; anything else fetches and runs nothing and shows a Greek message.
for (const qs of ["?src=/kids-code-lab/play/x.json", "?id=../x", "?id=1x", "?id=" + encodeURIComponent("http://127.0.0.1:1/x"),
  "?id=1234567890", "?id=1&src=x", ""]) {
  test(`play page refuses "${qs || "(no parameter)"}"`, async ({ context }) => {
    const rec = await recordAll(context);
    const page = await context.newPage();
    watchPage(page, rec);
    const asked = [];
    await page.route("**/api/**", (route) => { asked.push(route.request().url()); return route.fulfill({ contentType: "application/json", body: JSON.stringify(built) }); });
    await page.goto(`/kids-code-lab/play/play.html${qs}`);
    await expect(page.locator("#status")).toHaveText(/δεν υπάρχει/);
    await page.waitForTimeout(500);
    expect(asked, "no game fetched").toEqual([]);
    await expect(page.locator("iframe")).toHaveCount(0);
    const paths = rec.requests.map((u) => new URL(u).pathname);
    expect(paths.filter((p) => !/\/play\/play\.(html|js|css)$/.test(p)), "only the page itself loaded").toEqual([]);
  });
}
