// Release contract of kids-code-lab (APP-REPLY 2026-11-03 §2c, games-hub ADR-0006): the tarball, its .sha256 and
// kcl-headers.json. Run after the build:  KCL_TARBALL=<path to kids-code-lab-<version>.tar.gz> node --test tests/release/
// The checks compute everything themselves from the unpacked tree (hashes, html list); they share no code with the
// build that wrote the manifest.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { gunzipSync, brotliDecompressSync } from "node:zlib";

const TARBALL = process.env.KCL_TARBALL;
const NAME_RE = /^kids-code-lab-([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)\.tar\.gz$/;
const CORP = ["simulator.html", "pxtsim.js", "sim.js", "sim.css", "sim-keys.js"];
const TEXT = /\.(html|js|css|json|md|svg|txt|webmanifest|xml)$/i;

let version, top, www, manifest;

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const rel = (p) => relative(www, p).split("\\").join("/");

before(() => {
  assert.ok(TARBALL, "KCL_TARBALL is set");
  assert.ok(existsSync(TARBALL), `tarball exists: ${TARBALL}`);
  const m = basename(TARBALL).match(NAME_RE);
  assert.ok(m, `tarball name kids-code-lab-<version>.tar.gz: ${basename(TARBALL)}`);
  version = m[1];
  if (process.env.KCL_VERSION) assert.equal(version, process.env.KCL_VERSION.replace(/^v/, ""), "version = tag without v");
  const tmp = mkdtempSync(join(tmpdir(), "kcl-release-"));
  execFileSync("tar", ["-xzf", basename(TARBALL), "-C", tmp], { cwd: dirname(TARBALL) });
  top = join(tmp, `kids-code-lab-${version}`);
  www = join(top, "www");
});

test("KCL-R01 .sha256 in sha256sum format verifies the tarball", () => {
  const file = `${TARBALL}.sha256`;
  assert.ok(existsSync(file), `${basename(file)} exists`);
  const text = readFileSync(file, "utf8");
  const m = text.match(/^([0-9a-f]{64})  (\S+)\n?$/);
  assert.ok(m, `sha256sum format "<hash>  <name>": ${JSON.stringify(text)}`);
  assert.equal(m[2], basename(TARBALL));
  assert.equal(m[1], createHash("sha256").update(readFileSync(TARBALL)).digest("hex"));
});

test("KCL-R02 one top directory kids-code-lab-<version>/ with www/ and kcl-headers.json only", () => {
  const listing = execFileSync("tar", ["-tzf", basename(TARBALL)], { cwd: dirname(TARBALL), maxBuffer: 64 * 1024 * 1024 }).toString().split("\n").filter(Boolean);
  const tops = new Set(listing.map((p) => p.replace(/^\.\//, "").split("/")[0]));
  assert.deepEqual([...tops], [`kids-code-lab-${version}`]);
  assert.ok(existsSync(top), "top directory unpacked");
  assert.deepEqual(readdirSync(top).sort(), ["kcl-headers.json", "www"]);
  assert.ok(statSync(www).isDirectory());
  assert.ok(existsSync(join(www, "index.html")), "www/index.html (the editor) exists");
  assert.ok(!existsSync(join(www, "kcl-headers.json")), "the manifest is not served");
});

test("KCL-R03 text files are precompressed (.br and .gz next to each, same content)", () => {
  const files = walk(www).filter((p) => !/\.(br|gz)$/.test(p));
  const text = files.filter((p) => TEXT.test(p) && statSync(p).size >= 1024);
  assert.ok(text.length > 100, `text files found: ${text.length}`);
  const missing = text.filter((p) => !existsSync(`${p}.br`) || !existsSync(`${p}.gz`)).map(rel);
  assert.deepEqual(missing, [], "text files without .br/.gz");
  for (const p of [join(www, "index.html"), join(www, "simulator.html"), join(www, "target.js")]) {
    if (!existsSync(p)) continue;
    const raw = readFileSync(p);
    assert.ok(gunzipSync(readFileSync(`${p}.gz`)).equals(raw), `${rel(p)}.gz`);
    assert.ok(brotliDecompressSync(readFileSync(`${p}.br`)).equals(raw), `${rel(p)}.br`);
  }
});

test("KCL-R04 kcl-headers.json: schema 1, exactly these keys, path rules", () => {
  manifest = JSON.parse(readFileSync(join(top, "kcl-headers.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest).sort(), ["corp_cross_origin", "editor", "player", "schema", "simulator"]);
  assert.equal(manifest.schema, 1);
  assert.deepEqual(Object.keys(manifest.editor).sort(), ["paths", "script_hashes"]);
  assert.deepEqual(Object.keys(manifest.simulator), ["paths"]);
  assert.deepEqual(Object.keys(manifest.player), ["paths"]);
  const all = [...manifest.editor.paths, ...manifest.simulator.paths, ...manifest.player.paths, ...manifest.corp_cross_origin];
  for (const p of all) {
    assert.equal(typeof p, "string");
    assert.ok(p.length > 0 && !p.startsWith("/") && !p.includes("..") && !p.includes("\\") && !p.includes("//"), `relative to /kids-code-lab/: ${p}`);
    const segs = p.split("/");
    segs.forEach((s, i) => assert.ok(!s.includes("*") || (s === "*" && i === segs.length - 1), `"*" only as the whole last segment: ${p}`));
  }
  for (const h of manifest.editor.script_hashes) assert.match(h, /^sha256-[A-Za-z0-9+/]{43}=$/);
});

const matches = (pattern, path) => (pattern.endsWith("/*") ? path.startsWith(pattern.slice(0, -1)) && path.length > pattern.length - 1 : pattern === path);

test("KCL-R05 every *.html under www/ is in exactly one of editor / simulator / player", () => {
  const html = walk(www).filter((p) => p.endsWith(".html")).map(rel);
  assert.ok(html.length > 3);
  const bad = [];
  for (const h of html) {
    const kinds = ["editor", "simulator", "player"].filter((k) => manifest[k].paths.some((p) => matches(p, h)));
    if (kinds.length !== 1) bad.push(`${h}: ${kinds.join(",") || "none"}`);
  }
  assert.deepEqual(bad, []);
  // and every listed path matches something that exists
  for (const k of ["editor", "simulator", "player"]) {
    for (const p of manifest[k].paths) assert.ok(html.some((h) => matches(p, h)), `${k} path ${p} matches an html file`);
  }
});

test("KCL-R06 script_hashes = the sha256 of every inline script of the editor pages", () => {
  const html = walk(www).filter((p) => p.endsWith(".html")).map(rel).filter((h) => manifest.editor.paths.some((p) => matches(p, h)));
  const hashes = new Set();
  for (const h of html) {
    const text = readFileSync(join(www, h), "utf8");
    // inline = a <script> element without a src attribute; the hash is over the exact text between the tags
    for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/(^|\s)src\s*=/i.test(m[1])) continue;
      hashes.add(`sha256-${createHash("sha256").update(m[2], "utf8").digest("base64")}`);
    }
  }
  assert.ok(hashes.size > 0, "the editor has inline scripts");
  assert.deepEqual([...manifest.editor.script_hashes].sort(), [...hashes].sort());
  assert.equal(new Set(manifest.editor.script_hashes).size, manifest.editor.script_hashes.length, "no duplicates");
});

test("KCL-R07 corp_cross_origin = the five simulator-frame files, all present", () => {
  const names = manifest.corp_cross_origin.map((p) => p.split("/").pop()).sort();
  assert.deepEqual(names, [...CORP].sort());
  for (const p of manifest.corp_cross_origin) assert.ok(existsSync(join(www, p)), `exists: ${p}`);
  // the simulator page loads exactly these files of its own
  const sim = readFileSync(join(www, manifest.simulator.paths[0]), "utf8");
  for (const m of sim.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const own = m[1].replace(/^\/kids-code-lab\//, "");
    if (!/^https?:/.test(m[1])) assert.ok(manifest.corp_cross_origin.includes(own), `simulator.html loads ${m[1]}: in corp_cross_origin`);
  }
});
