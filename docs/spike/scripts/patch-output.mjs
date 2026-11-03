// Post-package patches on the `pxt staticpkg` output (SPIKE-REPORT.md §3, §4, §1).
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
for (const f of readdirSync(out).filter((n) => n.endsWith(".html"))) {
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
console.log(`patch-output: ${patched} html files without telemetry; removed ${removed.join(", ") || "nothing"}`);

if (slim) {
  // keep-list (top level). Everything else in the package is the docs site or another sub-app.
  const KEEP = [
    "index.html", "run.html", "simulator.html", "siminstructions.html",
    "main.js", "pxtapp.js", "pxtlib.js", "pxtweb.js", "pxtsim.js", "pxtcompiler.js", "pxtpy.js", "pxtworker.js",
    "pxtembed.js", "pxtrcdeps.js", "pxtasseteditor.js", "embed.js", "worker.js", "tsworker.js", "monacoworker.js",
    "typescript.js", "target.js", "target.json", "targetlight.js", "targetlight.json", "targetconfig.json",
    "theme.json", "target-strings.json", "sim-strings.json", "sim.js", "common-sim.js", "editor.js", "scriptPage.js",
    "semantic.js", "jquery.js", "zip.js", "highlight.js", "runnerembed.js",
    "semantic.css", "rtlsemantic.css", "blockly.css", "rtlblockly.css", "icons.css", "sim.css", "sim-shell.css",
    "sim.webmanifest", "favicon.ico",
    "blockly", "fonts", "icons", "images", "locales", "vs", "gifjs", "marked", "music-editor", "sounds", "qrcode",
    "smoothie", "docfiles",
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
  const size = (d) => readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? size(join(d, e.name)) : statSync(join(d, e.name)).size), 0);
  const count = (d) => readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? count(join(d, e.name)) : 1), 0);
  console.log(`slim copy: ${slim} ${(size(slim) / 1048576).toFixed(1)} MB in ${count(slim)} files`);
}
