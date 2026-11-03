// SPIKE-REPORT.md §7: a play-only page runs a compiled game without the editor.
// Step 1 compiles a tiny program with the packaged runner (run.html?code=...&sendBuilt=1), which posts the
// compiled game (pxtc BuiltSimJsInfo: js, fnArgs, parts, usedBuiltinParts) to its parent. That JSON is what the hub
// would store at publish time and serve as GET /api/lab/games/<id>/binary.
// Step 2 opens play/play.html (pxtsim.js + simulator.html only) with that JSON and checks the game runs.
// Needs the slim build (it contains play/). Every request must stay on 127.0.0.1; CSP=play adds the CSP check.
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { recordAll, summarize, watchPage } from "./record.mjs";

const PROGRAM = [
  "scene.setBackgroundColor(2)",
  "let s = sprites.create(img`",
  "5 5",
  "5 5",
  "`, SpriteKind.Player)",
  "controller.moveSprite(s)",
  "",
].join("\n");

async function compile(context) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__built = null;
    window.addEventListener("message", (e) => { if (e.data && typeof e.data.js === "string") window.__built = e.data; });
  });
  await page.goto(`/kids-code-lab/run.html?code=${encodeURIComponent(PROGRAM)}&sendBuilt=1&nofooter=1`);
  await page.waitForFunction(() => window.__built, null, { timeout: 120_000 });
  const built = await page.evaluate(() => window.__built);
  await page.close();
  return built;
}

test("play-only page runs the compiled game without the editor", async ({ context }) => {
  const rec = await recordAll(context);
  const built = await compile(context);
  const body = JSON.stringify(built);

  const page = await context.newPage();
  const errors = watchPage(page, rec);
  const loaded = [];
  page.on("response", async (r) => loaded.push({ path: new URL(r.url()).pathname, bytes: (await r.body().catch(() => Buffer.alloc(0))).length }));
  // the "hub API": the compiled game, same origin
  await page.route("**/kids-code-lab/play/game.json", (route) => route.fulfill({ contentType: "application/json", body }));
  await page.goto("/kids-code-lab/play/play.html?src=game.json");

  await expect
    .poll(async () => {
      const sim = page.frames().find((f) => /simulator\.html/.test(f.url()));
      if (!sim) return "no frame";
      return sim.evaluate(() => {
        const c = document.getElementById("game-screen");
        if (!c || c.classList.contains("hidden")) return "hidden";
        return Array.from(c.getContext("2d").getImageData(2, 2, 1, 1).data).join(",");
      });
    }, { timeout: 60_000 })
    .toBe("255,33,33,255");
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(500);
  await page.keyboard.up("ArrowRight");

  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/play-requests.json", JSON.stringify({
    csp: process.env.CSP ?? "none", builtJsBytes: body.length, byHost: summarize(rec.requests), external: rec.external,
    violations: rec.violations, consoleErrors: errors, playPageLoads: loaded,
  }, null, 1));
  expect(loaded.map((l) => l.path).filter((p) => /main\.js|target\.js|pxtembed\.js|pxtworker\.js/.test(p)), "no editor/compiler on the play page").toEqual([]);
  expect(rec.external, "requests outside 127.0.0.1").toEqual([]);
  expect(rec.violations, "CSP violations").toEqual([]);
});
