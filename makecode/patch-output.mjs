// Post-package patches on the `pxt staticpkg` output (docs/BUILD.md "Patches"; first measured in
// docs/spike/SPIKE-REPORT.md §1, §3, §4).
// Usage: node patch-output.mjs <out dir> [--slim <dest dir>]
//   in place: removes the Application Insights telemetry loader from every HTML page, deletes the telemetry SDK,
//             both service-worker scripts and the appcache manifest.
//   --slim:   copies only what the lab needs (editor, simulator, player, locales, blocks/monaco assets, the
//             tutorials' markdown) into <dest>; drops the docs site images/videos, skillmap, teacher tool, kiosk,
//             multiplayer, hardware hex cache and the other sub-apps.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const out = args[0];
const slimIdx = args.indexOf("--slim");
const slim = slimIdx > -1 ? args[slimIdx + 1] : null;

// 1. telemetry: <!-- include apptracking.html --> ... <!-- end include apptracking.html --> is the App Insights
//    snippet (POSTs to dc.services.visualstudio.com even when ai.2.min.js is served locally).
const TRACKING = /<!-- include apptracking\.html -->[\s\S]*?<!-- end include apptracking\.html -->\s*/g;
let patched = 0;
for (const f of readdirSync(out, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".html")).map((e) => e.name)) {
  const p = join(out, f);
  const html = readFileSync(p, "utf8");
  const next = html.replace(TRACKING, "");
  if (next !== html) { writeFileSync(p, next); patched++; }
}
// 2. files that must not be served: telemetry SDK, service workers (GAME-STANDARD: no service worker), appcache
const removed = [];
for (const f of ["ai.2.min.js", "serviceworker.js", "simulatorserviceworker.js", "release.manifest"]) {
  if (existsSync(join(out, f))) { rmSync(join(out, f)); removed.push(f); }
}
// 3. offline region lookup: pxt.Cloud.initRegionAsync() does new URL("geo", webConfig.cdnUrl); with the relative
//    cdnUrl of a static package that throws ("Unable to determine region", console error). An empty cdnUrl makes it
//    return "unknown" silently. cdnUrl is otherwise only used for cloud docs/hexcache URLs, which the lab does not use.
let cdn = 0;
for (const f of readdirSync(out, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".html")).map((e) => e.name)) {
  const p = join(out, f);
  const html = readFileSync(p, "utf8");
  const next = html.replace(/("cdnUrl":\s*)"[^"]*"/g, '$1""');
  if (next !== html) { writeFileSync(p, next); cdn++; }
}
// 3b. the simulator asks for locales/<lang>/sim-strings.json; Crowdin has no approved Greek simulator strings, so
//     the file is missing (HTTP 404 on every run). An empty object means "no translations" to pxt.
let simStrings = 0;
if (existsSync(join(out, "locales"))) {
  for (const lang of readdirSync(join(out, "locales"))) {
    const p = join(out, "locales", lang, "sim-strings.json");
    if (statSync(join(out, "locales", lang)).isDirectory() && !existsSync(p)) { writeFileSync(p, "{}\n"); simStrings++; }
  }
}
// 4. the simulator iframe asks for allow="autoplay;microphone"; the lab has no microphone feature and the hub's
//    Permissions-Policy denies it ("Potential permissions policy violation: microphone" on every run).
let mic = 0;
for (const f of readdirSync(out, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".js")).map((e) => e.name)) {
  const p = join(out, f);
  const js = readFileSync(p, "utf8");
  if (!js.includes('"autoplay;microphone"')) continue;
  writeFileSync(p, js.split('"autoplay;microphone"').join('"autoplay"'));
  mic++;
}
// 5. the editor's simulator frame runs SANDBOXED without allow-same-origin (opaque origin), like the play page:
//    the child's compiled game runs with 'unsafe-eval' in that frame and must not reach the hub's cookies, storage
//    or /api/* (docs/BUILD.md "Player security"). pxsim's SimulatorDriver needs three changes for that:
//    a) iframe sandbox "allow-same-origin allow-scripts" -> "allow-scripts" (only the simulator frame, recognised by
//       the allow="autoplay" set just before it; docs/extension frames are untouched),
//    b) messages TO the frame: targetOrigin "*" (an opaque origin cannot be named; the window reference pins the
//       receiver),
//    c) messages FROM the frame: origin "null" is accepted only when ev.source is one of the driver's own simulator
//       frames (all other origins are checked against the allow-list exactly as before).
const SANDBOX_RE = /(\.setAttribute\("allow","autoplay"\),(\w+)\.setAttribute\("sandbox",)"allow-same-origin allow-scripts"/g;
const ORIGIN_RE = /\.dataset\.origin=new URL\((\w+)\)\.origin\|\|"\*"/g;
const LISTEN_RE = /this\._allowedOrigins\.indexOf\((\w+)\.origin\)<0/g;
const sandboxed = [];
for (const f of ["pxtsim.js", "pxtembed.js", "pxtapp.js"]) {
  const p = join(out, f);
  if (!existsSync(p)) continue;
  const js = readFileSync(p, "utf8");
  const a = (js.match(SANDBOX_RE) || []).length, b = (js.match(ORIGIN_RE) || []).length, c = (js.match(LISTEN_RE) || []).length;
  if (js.includes("kclF=>kclF.contentWindow")) continue; // already patched (re-run on the same output)
  if (a !== 1 || b !== 1 || c !== 1) throw new Error(`patch-output: simulator sandbox patch does not fit ${f} (${a}/${b}/${c}); check the pxt-core version`);
  const next = js
    .replace(SANDBOX_RE, '$1"allow-scripts"')
    .replace(ORIGIN_RE, '.dataset.origin="*"')
    .replace(LISTEN_RE, (_m, v) => `(this._allowedOrigins.indexOf(${v}.origin)<0&&!("null"===${v}.origin&&this.simFrames().some(kclF=>kclF.contentWindow===${v}.source)))`);
  writeFileSync(p, next);
  sandboxed.push(f);
}
console.log(`patch-output: ${patched} html without telemetry, ${cdn} html with empty cdnUrl, ${simStrings} empty sim-strings, ${mic} js without microphone, simulator sandboxed in [${sandboxed.join(", ")}]; removed ${removed.join(", ") || "nothing"}`);

if (slim) {
  // keep-list (top level). Everything else in the package is the docs site or another sub-app.
  const KEEP = [
    "index.html", "run.html", "simulator.html",
    "main.js", "pxtapp.js", "pxtlib.js", "pxtweb.js", "pxtsim.js", "pxtcompiler.js", "pxtpy.js", "pxtworker.js",
    "pxtembed.js", "pxtrcdeps.js", "pxtasseteditor.js", "embed.js", "worker.js", "tsworker.js", "monacoworker.js",
    "typescript.js", "target.js", "target.json", "targetlight.js", "targetlight.json", "targetconfig.json",
    "theme.json", "target-strings.json", "sim-strings.json", "sim.js", "common-sim.js", "editor.js", "scriptPage.js",
    "semantic.js", "jquery.js", "zip.js", "highlight.js", "runnerembed.js",
    "semantic.css", "rtlsemantic.css", "blockly.css", "rtlblockly.css", "icons.css", "sim.css", "sim-keys.js",
    "sim.webmanifest", "favicon.ico",
    "blockly", "fonts", "icons", "images", "locales", "vs", "gifjs", "marked", "music-editor", "sounds", "qrcode",
    "smoothie",
    "docs/static/Micorsoft_logo_rgb_W-white_D.png", "docs/static/Micorsoft_logo_rgb_W-white_D-square.png",
  ];
  rmSync(slim, { recursive: true, force: true });
  mkdirSync(slim, { recursive: true });
  for (const k of KEEP) if (existsSync(join(out, k))) cpSync(join(out, k), join(slim, k), { recursive: true });
  // tutorials: markdown only (the editor renders tutorials from docs/**.md; images are optional)
  const copyMd = (rel) => {
    for (const e of readdirSync(join(out, rel), { withFileTypes: true })) {
      const r = join(rel, e.name);
      if (e.isDirectory()) { if (!/^static$/.test(e.name)) copyMd(r); }
      else if (e.name.endsWith(".md")) { mkdirSync(join(slim, rel), { recursive: true }); cpSync(join(out, r), join(slim, r)); }
    }
  };
  if (existsSync(join(out, "docs"))) copyMd("docs");
  // «Μαθήματα»: the images the lab's tutorials show (/static/... in their markdown, served from docs/static/), so a
  // tutorial step has no broken image and no 404 in the console.
  const { TUTORIALS } = await import("./lab/core.js");
  let images = 0;
  for (const t of TUTORIALS) {
    const md = join(out, "docs", "tutorials", `${t.id}.md`);
    if (!existsSync(md)) continue;
    const text = readFileSync(md, "utf8");
    for (const m of text.matchAll(/(?:\]\(|src=")(\/static\/[^)"\s]+)/g)) {
      const rel = m[1].replace(/^\/static\//, "");
      const from = join(out, "docs", "static", rel);
      const to = join(slim, "docs", "static", rel);
      if (existsSync(from) && !existsSync(to)) { mkdirSync(join(to, ".."), { recursive: true }); cpSync(from, to); images++; }
    }
  }
  // The markdown says /static/... (the site root on makecode.com). Under /kids-code-lab/ that is the hub's own /static
  // (404, or worse a hub file): point the lab's tutorials at the package's docs/static/.
  const route = `/${out.split(/[\\/]/).filter(Boolean).pop()}/`;
  for (const t of TUTORIALS) {
    const md = join(slim, "docs", "tutorials", `${t.id}.md`);
    if (!existsSync(md)) continue;
    const text = readFileSync(md, "utf8");
    writeFileSync(md, text.replace(/(\]\(|src=")\/static\//g, `$1${route}docs/static/`));
  }
  console.log(`slim: ${images} tutorial images, tutorial image paths under ${route}docs/static/`);
  const size = (d) => readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? size(join(d, e.name)) : statSync(join(d, e.name)).size), 0);
  const count = (d) => readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? count(join(d, e.name)) : 1), 0);
  console.log(`slim copy: ${slim} ${(size(slim) / 1048576).toFixed(1)} MB in ${count(slim)} files`);
}
