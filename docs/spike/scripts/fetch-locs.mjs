// Build-time only: downloads the approved Crowdin translations of MakeCode Arcade for the given languages from
// the public (token-less) makecode.com translations API into <out>/<lang>/<crowdin path>, the layout that
// `pxt staticpkg --locs-src <out>` bundles into built/packaged/.../locales/<lang>/*.json.
// The browser never calls this API: the packaged editor loads the bundled files from its own origin.
// It also prints a coverage table (keys translated in <lang> vs English source keys, or vs a reference language
// for the core UI files that have no English source in the npm packages).
// Usage: node fetch-locs.mjs <pxt-arcade dir> <out dir> [lang=el] [reference=de]
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const [arcade, out, lang = "el", ref = "de"] = process.argv.slice(2);
const target = "arcade";
const API = "https://makecode.com/api/translations";

async function get(l, file) {
  const url = `${API}?lang=${encodeURIComponent(l)}&filename=${encodeURIComponent(file)}&approved=true`;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    if (r.status === 404) return {};
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  throw new Error(`HTTP error for ${file}`);
}
const count = (o) => Object.values(o ?? {}).filter((v) => typeof v === "string" && v.trim() !== "").length;

// top-level (pxt core UI) files and target files, as in pxt-core crowdin.buildAllTranslationsAsync
const files = [
  { crowd: "strings.json", src: null },
  { crowd: "webstrings.json", src: null },
  { crowd: "skillmap-strings.json", src: null },
  { crowd: `${target}/target-strings.json`, src: join(arcade, "built", "target-strings.json") },
  { crowd: `${target}/sim-strings.json`, src: join(arcade, "built", "sim-strings.json") },
];
const pxtarget = JSON.parse(await readFile(join(arcade, "pxtarget.json"), "utf8"));
for (const dir of pxtarget.bundleddirs) {
  const loc = join(arcade, dir, "_locales");
  if (!existsSync(loc)) continue;
  for (const f of await readdir(loc)) if (f.endsWith(".json")) files.push({ crowd: `${target}/${f}`, src: join(loc, f) });
}

const rows = [];
let tot = { el: 0, en: 0 };
for (const f of files) {
  const tr = await get(lang, f.crowd);
  const dest = join(out, lang, f.crowd);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(tr));
  let base;
  if (f.src && existsSync(f.src)) base = count(JSON.parse(await readFile(f.src, "utf8")));
  else base = count(await get(ref, f.crowd)); // no English source shipped: compare with the reference language
  const n = count(tr);
  rows.push({ file: f.crowd, translated: n, base, baseFrom: f.src ? "en" : ref });
  tot.el += n;
  tot.en += base;
}
rows.sort((a, b) => b.base - a.base);
console.log(`file\t${lang}\tbase\tbase-from\t%`);
for (const r of rows) console.log(`${r.file}\t${r.translated}\t${r.base}\t${r.baseFrom}\t${r.base ? Math.round((100 * r.translated) / r.base) : "-"}`);
console.log(`TOTAL\t${tot.el}\t${tot.en}\t\t${Math.round((100 * tot.el) / tot.en)}`);
