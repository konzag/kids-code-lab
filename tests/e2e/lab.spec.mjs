// The lab's own pages (/kids-code-lab/lab/) against a local fake of the games-hub API (fake-hub.mjs):
// home, editor bar, «Δημοσίευση» flow with every server answer, «Απόσυρση», the player with the hub shell buttons,
// sizes 1280 / 820x1180 / 1180x820 / 360, light + dark, axe (0 serious/critical) on the lab's own pages,
// 0 requests outside 127.0.0.1, 0 CSP violations (run with CSP=adr HUB_HEADERS=1), no service worker.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gunzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { recordAll, watchPage } from "./record.mjs";
import { FakeHub } from "./fake-hub.mjs";
import { KEY, publishErrorText } from "../../makecode/lab/core.js";

const RED = "255,33,33,255";
const SIZES = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet-portrait", width: 820, height: 1180 },
  { name: "tablet-landscape", width: 1180, height: 820 },
  { name: "phone", width: 360, height: 740 },
];

async function setup(context) {
  const rec = await recordAll(context);
  const hub = new FakeHub();
  await hub.install(context);
  const page = await context.newPage();
  const errors = watchPage(page, rec);
  return { rec, hub, page, errors };
}

function clean(rec, errors) {
  mkdirSync("test-results", { recursive: true });
  writeFileSync(`test-results/lab-clean-${Date.now()}.json`, JSON.stringify({ external: rec.external, violations: rec.violations, errors }, null, 1));
  expect(rec.external, "requests outside 127.0.0.1").toEqual([]);
  expect(rec.violations, "CSP violations").toEqual([]);
  expect(errors, "console errors").toEqual([]);
}

async function axe(page, label) {
  // the lab pages only: MakeCode's frames are not ours (spec §8), and axe's CSS preload would fetch() inside the
  // sandboxed simulator frame, whose CSP is connect-src 'none'
  const res = await new AxeBuilder({ page }).include("body").exclude("iframe").options({ preload: false, iframes: false }).analyze();
  const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  mkdirSync("test-results", { recursive: true });
  writeFileSync(`test-results/axe-${label}.json`, JSON.stringify(res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })), null, 1));
  expect(bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`), `axe ${label}`).toEqual([]);
}

const settingsOf = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), KEY);

// The editor frame of lab/edit.html: make the program `scene.setBackgroundColor(2)` like editor.spec.mjs does.
async function writeProgram(page) {
  const ed = page.frameLocator("#editor-frame");
  await ed.locator(".blocklySvg").first().waitFor({ timeout: 90_000 });
  const tour = ed.locator(".teaching-bubble-close");
  await tour.waitFor({ state: "visible", timeout: 15_000 }).then(() => tour.click()).catch(() => {});
  await ed.locator(".javascript-menuitem").first().click();
  await ed.locator(".monaco-editor textarea").first().waitFor({ state: "attached", timeout: 60_000 });
  await ed.locator(".monaco-editor").first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.type("scene.setBackgroundColor(2)\n");
  await page.waitForTimeout(1500);
  await ed.locator(".blocks-menuitem").first().click();
  await expect.poll(() => ed.locator(".blocklyDraggable").count(), { timeout: 30_000 }).toBeGreaterThan(1);
}

async function openPublish(page) {
  await page.locator("#publish-open").click();
  await expect(page.locator("#publish")).toBeVisible();
  await expect(page.locator("#prep-status")).toHaveText(/Έτοιμο/, { timeout: 120_000 });
}

test.describe("lab home", () => {
  for (const size of SIZES) {
    for (const theme of ["light", "dark"]) {
      test(`home ${size.name} ${theme}: Greek, sections, axe`, async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme: theme });
        const { rec, page, errors } = await setup(context);
        await page.goto("/kids-code-lab/lab/");
        await expect(page.locator("html")).toHaveAttribute("lang", "el");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.getByRole("link", { name: /Νέο παιχνίδι/ })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Τα παιχνίδια μου" })).toBeVisible();
        await expect(page.locator("#tutorials li")).toHaveCount(5);
        await expect(page.getByRole("link", { name: /Πίσω στα παιχνίδια/ })).toHaveAttribute("href", "/");
        await expect(page.locator("#projects")).toContainText("Δεν έχεις φτιάξει ακόμα παιχνίδι");
        // text >= 18 px everywhere on the page
        const small = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && e.offsetParent !== null && parseFloat(getComputedStyle(e).fontSize) < 18).map((e) => e.tagName + "." + e.className));
        expect(small, "text smaller than 18 px").toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal scroll").toBe(true);
        await axe(page, `home-${size.name}-${theme}`);
        clean(rec, errors);
        await context.close();
      });
    }
  }

  test("theme switch is remembered", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const { page } = await setup(context);
    await page.goto("/kids-code-lab/lab/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.locator("#theme").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("#theme")).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect((await settingsOf(page)).theme).toBe("dark");
    await context.close();
  });
});

test.describe("editor page", () => {
  test("360 px: the editor asks for a tablet or computer", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const { rec, page, errors } = await setup(context);
    await page.goto("/kids-code-lab/lab/edit.html?new=1");
    await expect(page.getByText("Το εργαστήρι θέλει tablet ή υπολογιστή")).toBeVisible();
    await expect(page.locator("#editor-frame")).toBeHidden();
    await expect(page.locator("#publish-open")).toBeHidden();
    await axe(page, "edit-phone");
    clean(rec, errors);
    await context.close();
  });

  for (const size of SIZES.slice(0, 3)) {
    test(`editor bar ${size.name}: «🏠 Πίσω» and «Δημοσίευση στο hub», editor framed`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height } });
      const { rec, page, errors } = await setup(context);
      await page.goto("/kids-code-lab/lab/edit.html?new=1");
      await expect(page.getByRole("link", { name: /Πίσω/ })).toHaveAttribute("href", "index.html");
      await expect(page.getByRole("button", { name: /Δημοσίευση στο hub/ })).toBeVisible();
      await page.frameLocator("#editor-frame").locator(".blocklySvg").first().waitFor({ timeout: 90_000 });
      await axe(page, `edit-${size.name}`);
      clean(rec, errors);
      await context.close();
    });
  }
});

test.describe("publish", () => {
  test("publish flow: binary + cartridge, 201, token kept, milestones, play it, unpublish", async ({ browser }) => {
    const context = await browser.newContext();
    const { rec, hub, page, errors } = await setup(context);
    const consoleText = [];
    page.on("console", (m) => consoleText.push(m.text()));
    await page.goto("/kids-code-lab/lab/edit.html?new=1");
    await writeProgram(page);
    await openPublish(page);
    await expect(page.locator("#cover")).toBeVisible();
    await expect(page.locator("#profile option")).toHaveCount(2);
    await page.locator("#title").fill("Το κόκκινο <b>κάστρο</b>");
    await page.locator("#description").fill("Ένα κόκκινο παιχνίδι.");
    await page.locator("#profile").selectOption("2");
    await page.locator("#publish-submit").click();
    await expect(page.locator("#publish-status")).toContainText("Το παιχνίδι μπήκε στο ράφι του hub");
    await axe(page, "publish-dialog");

    // what the hub received
    expect(hub.posts).toHaveLength(1);
    const body = hub.posts[0];
    expect(body.title).toBe("Το κόκκινο <b>κάστρο</b>");
    expect(body.profile).toBe(2);
    expect(Buffer.from(body.cartridge, "base64").subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const game = JSON.parse(gunzipSync(Buffer.from(body.binary, "base64")).toString("utf8"));
    expect(typeof game.js).toBe("string");
    expect(game.js.length).toBeGreaterThan(1000);

    // device state: token kept (never in a URL or the console), §5a completion once, milestones
    const s = await settingsOf(page);
    const token = s.published["1"];
    expect(token).toMatch(/^tok-1-/);
    expect(s.hub.completed).toBe(true);
    expect(s.hub.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.hub.milestones).toEqual(expect.arrayContaining(["first-project", "first-publish"]));
    expect(rec.requests.filter((u) => u.includes(token)), "token in a URL").toEqual([]);
    expect(consoleText.filter((t) => t.includes(token)), "token in the console").toEqual([]);

    // the player runs the published game from the (gzip) binary, sandboxed
    await page.locator("#publish-status a").click();
    await expect(page).toHaveURL(/\/kids-code-lab\/play\/\?id=1$/);
    await expect.poll(async () => {
      const sim = page.frames().filter((f) => !f.isDetached() && /simulator\.html/.test(f.url())).pop();
      if (!sim) return "no frame";
      return sim.evaluate(() => {
        const c = document.getElementById("game-screen");
        return !c || c.classList.contains("hidden") ? "hidden" : Array.from(c.getContext("2d").getImageData(2, 2, 1, 1).data).join(",");
      });
    }, { timeout: 60_000 }).toBe(RED);
    expect(await page.locator("#player iframe").getAttribute("sandbox")).toBe("allow-scripts");
    // hub shell buttons
    for (const name of ["Σταμάτημα", "Σίγαση", "Πλήρης οθόνη"]) await expect(page.getByRole("button", { name })).toBeVisible();
    await expect(page.getByRole("link", { name: "Πίσω στα παιχνίδια" })).toHaveAttribute("href", "/");
    await page.getByRole("button", { name: "Σίγαση" }).click();
    await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#pause").click();
    await expect(page.locator("#pause")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#pause").click();
    await expect(page.locator("#pause")).toHaveAttribute("aria-pressed", "false");
    await axe(page, "player");

    // «Απόσυρση» from the lab home with the device token
    await page.goto("/kids-code-lab/lab/");
    await expect(page.locator("#published")).toContainText("Το κόκκινο <b>κάστρο</b>");
    await page.getByRole("button", { name: "Απόσυρση" }).click();
    await page.getByRole("button", { name: "Ναι, απόσυρση" }).click();
    await expect(page.locator("#pub-status")).toHaveText("Το παιχνίδι αποσύρθηκε από το ράφι.");
    expect(hub.deletes).toEqual([{ id: 1, token }]);
    expect((await settingsOf(page)).published).toEqual({});
    expect(rec.requests.filter((u) => u.includes(token)), "token in a URL").toEqual([]);
    clean(rec, errors);
    await context.close();
  });

  test("every error answer of the hub is shown in Greek", async ({ browser }) => {
    const context = await browser.newContext();
    const { hub, page } = await setup(context);
    await page.goto("/kids-code-lab/lab/edit.html?new=1");
    await page.frameLocator("#editor-frame").locator(".blocklySvg").first().waitFor({ timeout: 90_000 });
    await openPublish(page);
    await page.locator("#title").fill("Δοκιμή");
    // 401 last: after it the lab marks the session missing and waits for the parent to unlock
    for (const status of [403, 409, 413, 415, 422, 429, 503, 401]) {
      hub.forceStatus = status;
      await page.locator("#publish-submit").click();
      const expected = publishErrorText(status) + (status === 429 ? " (σε 30 δευτερόλεπτα)" : "");
      await expect(page.locator("#publish-status"), `status ${status}`).toContainText(expected);
      if (status === 401) await expect(page.locator("#publish-status a")).toHaveAttribute("href", "/profiles");
    }
    expect(hub.posts).toHaveLength(0);
    await context.close();
  });

  test("without the unlock session: no PIN field, link to «Προφίλ», publish disabled", async ({ browser }) => {
    const context = await browser.newContext();
    const { rec, hub, page, errors } = await setup(context);
    hub.unlocked = false;
    await page.goto("/kids-code-lab/lab/edit.html?new=1");
    await page.frameLocator("#editor-frame").locator(".blocklySvg").first().waitFor({ timeout: 90_000 });
    await page.locator("#publish-open").click();
    await expect(page.locator("#profile-hint a")).toHaveAttribute("href", "/profiles");
    await expect(page.locator("#publish input[type=password], #publish input[inputmode=numeric]")).toHaveCount(0);
    await expect(page.locator("#publish-submit")).toBeDisabled();
    // the fake hub answered 401 to GET /api/profiles: that console error is expected
    clean(rec, errors.filter((e) => !/HTTP 401 \/api\/profiles/.test(e)));
    await context.close();
  });

  test("client-side cap: a binary above 2 MB gzip is refused before any upload", async ({ browser }) => {
    const context = await browser.newContext();
    const { hub, page } = await setup(context);
    await page.goto("/kids-code-lab/lab/edit.html?new=1");
    await page.frameLocator("#editor-frame").locator(".blocklySvg").first().waitFor({ timeout: 90_000 });
    // a compiled game of incompressible noise > 2 MB gzip, through the lab's own packBinary
    const r = await page.evaluate(async () => {
      const core = await import("/kids-code-lab/lab/core.js");
      const bytes = new Uint8Array(3 * 1024 * 1024);
      for (let i = 0; i < bytes.length; i += 65536) crypto.getRandomValues(bytes.subarray(i, i + 65536));
      let noise = "";
      for (let i = 0; i < bytes.length; i += 8192) noise += String.fromCharCode(...bytes.subarray(i, i + 8192).map((b) => 33 + (b % 90)));
      return core.packBinary({ js: noise });
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("binary-big");
    expect(hub.posts).toHaveLength(0);
    await context.close();
  });
});
