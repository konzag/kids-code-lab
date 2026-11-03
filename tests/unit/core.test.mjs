// Unit tests of makecode/lab/core.js (TEST-STANDARD v1). Run: node --test tests/unit/
// KCL_CORE=<path> runs them against another implementation (used to show them red against an empty module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const core = await import(pathToFileURL(resolve(process.env.KCL_CORE ?? "makecode/lab/core.js")).href);

class MemStorage {
  constructor(init = {}) { this.m = new Map(Object.entries(init)); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
}
class BrokenStorage {
  getItem() { throw new Error("SecurityError"); }
  setItem() { throw new Error("QuotaExceededError"); }
}

test("KCL-U01 key and defaults", () => {
  assert.equal(core.KEY, "game.kids-code-lab.v1");
  const s = core.loadSettings(new MemStorage());
  assert.equal(s.version, 1);
  assert.deepEqual(s.hub, { schema: 1, completed: false, milestones: [] });
  assert.equal(s.lang, "el");
  assert.equal(s.theme, null);
});

test("KCL-U02 bad JSON, non-object, missing hub, broken storage: defaults, never throws", () => {
  for (const text of ["{", "null", "42", "[]", '"x"', "{\"hub\": 5}"]) {
    const s = core.loadSettings(new MemStorage({ [core.KEY]: text }));
    assert.deepEqual(s.hub, { schema: 1, completed: false, milestones: [] }, text);
  }
  assert.deepEqual(core.loadSettings(new BrokenStorage()).hub.milestones, []);
  assert.equal(core.saveSettings(new BrokenStorage(), core.defaults()), false);
});

test("KCL-U03 old version (no version field) is migrated, unknown fields dropped", () => {
  const old = JSON.stringify({ theme: "dark", lang: "en", hub: { milestones: ["first-project"] }, secret: "x", publishCount: 2 });
  const s = core.loadSettings(new MemStorage({ [core.KEY]: old }));
  assert.equal(s.version, 1);
  assert.equal(s.theme, "dark");
  assert.equal(s.lang, "en");
  assert.equal(s.publishCount, 2);
  assert.deepEqual(s.hub.milestones, ["first-project"]);
  assert.equal("secret" in s, false);
  const st = new MemStorage();
  assert.equal(core.saveSettings(st, s), true);
  const saved = JSON.parse(st.getItem(core.KEY));
  assert.equal(saved.version, 1);
  assert.deepEqual(Object.keys(saved.hub).sort(), ["completed", "milestones", "schema"]);
});

test("KCL-U04 wrong types are ignored field by field", () => {
  const raw = JSON.stringify({ theme: "purple", lang: "fr", publishCount: -3, published: { "abc": "t", "7": 5, "8": "tok" },
    hub: { schema: 9, completed: "yes", completedAt: "yesterday", milestones: "first-project" } });
  const s = core.parseSettings(raw);
  assert.equal(s.theme, null);
  assert.equal(s.lang, "el");
  assert.equal(s.publishCount, 0);
  assert.deepEqual(s.published, { 8: "tok" });
  assert.deepEqual(s.hub, { schema: 1, completed: false, milestones: [] });
});

test("KCL-U05 milestone validation: [a-z0-9-], <= 32 chars, unique, append-only, <= 50", () => {
  const hub = { schema: 1, completed: false, milestones: [] };
  assert.equal(core.addMilestone(hub, "first-project"), true);
  assert.equal(core.addMilestone(hub, "first-project"), false, "no duplicates");
  for (const bad of ["", "Upper", "with space", "ελληνικά", "a".repeat(33), "under_score", null, 5]) {
    assert.equal(core.addMilestone(hub, bad), false, String(bad));
  }
  assert.equal(core.addMilestone(hub, "a".repeat(32)), true);
  for (let i = 0; i < 60; i++) core.addMilestone(hub, `m-${i}`);
  assert.equal(hub.milestones.length, 50);
  assert.equal(hub.milestones[0], "first-project", "append-only keeps the order");
  // cleanHub drops invalid ones read from storage and caps at 50
  const cleaned = core.cleanHub({ milestones: ["ok-1", "BAD", "ok-1", ...Array.from({ length: 80 }, (_, i) => `x${i}`)] });
  assert.equal(cleaned.milestones.length, 50);
  assert.equal(cleaned.milestones.includes("BAD"), false);
});

test("KCL-U06 first publish: completed + completedAt written once; publish-5 on the fifth", () => {
  const s = core.defaults();
  core.recordPublish(s, 11, "tok-11", new Date(2026, 10, 3));
  assert.equal(s.hub.completed, true);
  assert.equal(s.hub.completedAt, "2026-11-03");
  assert.deepEqual(s.hub.milestones, ["first-publish"]);
  assert.equal(s.published["11"], "tok-11");
  for (let i = 0; i < 4; i++) core.recordPublish(s, 20 + i, `t${i}`, new Date(2026, 11, 24));
  assert.equal(s.hub.completedAt, "2026-11-03", "completedAt never changes");
  assert.deepEqual(s.hub.milestones, ["first-publish", "publish-5"]);
  assert.equal(s.publishCount, 5);
  core.recordUnpublish(s, 11);
  assert.equal("11" in s.published, false);
  assert.deepEqual(s.hub.milestones, ["first-publish", "publish-5"], "unpublish never removes milestones");
});

test("KCL-U07 first-project milestone once", () => {
  const s = core.defaults();
  assert.equal(core.recordFirstProject(s), true);
  assert.equal(core.recordFirstProject(s), false);
  assert.deepEqual(s.hub.milestones, ["first-project"]);
});

const B64 = "iVBORw0KGgo="; // any base64
const good = { title: "Ο δράκος", description: "Πέτα και μάζεψε αστέρια", profile: 2, cartridge: B64, cartridgeBytes: 9, binary: B64, binaryGzipBytes: 9 };

test("KCL-U08 publish payload: caps in code points, cleaning, JSON body", () => {
  const r = core.buildPublishPayload(good);
  assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(r.body), { title: "Ο δράκος", description: "Πέτα και μάζεψε αστέρια", profile: 2, cartridge: B64, binary: B64 });
  assert.equal(core.buildPublishPayload({ ...good, title: "α".repeat(40) }).ok, true, "40 Greek letters fit");
  assert.deepEqual(core.buildPublishPayload({ ...good, title: "α".repeat(41) }).errors, ["title-long"]);
  assert.deepEqual(core.buildPublishPayload({ ...good, title: "   " }).errors, ["title-empty"]);
  assert.deepEqual(core.buildPublishPayload({ ...good, description: "β".repeat(141) }).errors, ["description-long"]);
  assert.equal(core.buildPublishPayload({ ...good, description: "" }).ok, true);
  assert.deepEqual(core.buildPublishPayload({ ...good, profile: "2" }).errors, ["profile"]);
  assert.deepEqual(core.buildPublishPayload({ ...good, cartridge: "not base64!" }).errors, ["cartridge"]);
  assert.deepEqual(core.buildPublishPayload({ ...good, cartridgeBytes: core.CARTRIDGE_MAX + 1 }).errors, ["cartridge-big"]);
  assert.deepEqual(core.buildPublishPayload({ ...good, binaryGzipBytes: core.BINARY_GZIP_MAX + 1 }).errors, ["binary-big"]);
});

test("KCL-U09 publish payload: markup stays literal text, control and bidi characters removed", () => {
  const r = core.buildPublishPayload({ ...good, title: "<img src=x onerror=alert(1)>", description: "a\u202eb\u0000c\n\n d" });
  assert.equal(r.ok, true);
  const body = JSON.parse(r.body);
  assert.equal(body.title, "<img src=x onerror=alert(1)>", "no HTML escaping in JSON: pages render with textContent");
  assert.equal(body.description, "a b c d");
  assert.equal(r.body.includes("\u202e"), false);
});

test("KCL-U10 gzip cap: the compiled game is packed with gzip and checked against 2 MB", async () => {
  const built = { js: "var x = 1;".repeat(1000), fnArgs: { a: 1 }, parts: [], usedBuiltinParts: [] };
  const p = await core.packBinary(built);
  assert.equal(p.ok, true);
  const json = JSON.parse(gunzipSync(Buffer.from(p.base64, "base64")).toString("utf8"));
  assert.equal(json.js, built.js);
  assert.ok(p.gzipBytes < p.rawBytes);
  // incompressible data above the cap is refused on the client
  const rnd = randomBytes(Math.ceil(core.BINARY_GZIP_MAX * 1.5));
  const big = await core.packBinary({ js: rnd.toString("base64") });
  assert.equal(big.ok, false);
  assert.equal(big.error, "binary-big");
  assert.equal((await core.packBinary({})).ok, false);
});

test("KCL-U11 Greek answers for every status of the API contract", () => {
  for (const s of [401, 403, 404, 409, 413, 415, 422, 429, 503, 500]) {
    const t = core.publishErrorText(s);
    assert.match(t, /[Ͱ-Ͽ]/, `status ${s} has Greek text`);
  }
  assert.notEqual(core.publishErrorText(401), core.publishErrorText(503));
  assert.equal(core.retryAfterSeconds("30"), 30);
  assert.equal(core.retryAfterSeconds("Wed, 21 Oct 2015 07:28:00 GMT"), null);
});

test("KCL-U12 player id: only ?id=<1-9 digits>", () => {
  assert.equal(core.parseGameId("?id=7"), "7");
  assert.equal(core.parseGameId("?id=123456789"), "123456789");
  for (const q of ["", "?id=", "?id=1234567890", "?id=1x", "?id=../1", "?id=1&x=2", "?src=/a", "?id=1&id=2", "?id=%2F1"]) {
    assert.equal(core.parseGameId(q), null, q);
  }
});
