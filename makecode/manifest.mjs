// kcl-headers.json (release contract, APP-REPLY 2026-11-03 §2c): which page kind of games-hub ADR-0006 each HTML file
// of the served tree is, the sha256 of the editor pages' inline scripts (infra fills them into the editor CSP), and
// the files that get Cross-Origin-Resource-Policy: cross-origin (the sandboxed simulator frame's own files).
// Written by the build from the build output; tests/release/release.test.mjs checks it independently.
// Usage: node manifest.mjs <www dir> <out file>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { inlineScriptHashes } from "./csp.mjs";

// Paths relative to /kids-code-lab/; "*" only as the whole last segment. The lab's own pages (lab/*) run under the
// editor policy: no inline script, same-origin fetch and frames, which that policy allows.
export const KINDS = {
  editor: ["index.html", "run.html", "lab/*"],
  simulator: ["simulator.html"],
  player: ["play/*"],
};
export const CORP_CROSS_ORIGIN = ["simulator.html", "pxtsim.js", "sim.js", "sim.css", "sim-keys.js"];

export const matches = (pattern, path) =>
  pattern.endsWith("/*") ? path.startsWith(pattern.slice(0, -1)) && path.length > pattern.length - 1 : pattern === path;

/** "editor" | "simulator" | "player" for a path relative to /kids-code-lab/ (a directory path means its index.html). */
export function kindOf(path) {
  const p = path === "" || path.endsWith("/") ? `${path}index.html` : path;
  const kinds = Object.keys(KINDS).filter((k) => KINDS[k].some((pat) => matches(pat, p)));
  return kinds.length === 1 ? kinds[0] : null;
}

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

export function buildManifest(www) {
  const html = walk(www).filter((p) => p.endsWith(".html")).map((p) => relative(www, p).split("\\").join("/")).sort();
  const unclassified = html.filter((h) => !kindOf(h));
  if (unclassified.length) throw new Error(`manifest: html without exactly one kind: ${unclassified.join(", ")}`);
  const hashes = new Set();
  for (const h of html.filter((x) => kindOf(x) === "editor")) {
    for (const q of inlineScriptHashes(readFileSync(join(www, h), "utf8"))) hashes.add(q.replace(/^'|'$/g, ""));
  }
  const corp = CORP_CROSS_ORIGIN.filter((f) => walk(www).some((p) => relative(www, p).split("\\").join("/") === f));
  if (corp.length !== CORP_CROSS_ORIGIN.length) throw new Error("manifest: a simulator-frame file is missing");
  return {
    schema: 1,
    editor: { paths: KINDS.editor, script_hashes: [...hashes].sort() },
    simulator: { paths: KINDS.simulator },
    player: { paths: KINDS.player },
    corp_cross_origin: corp,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [www, out] = process.argv.slice(2);
  const m = buildManifest(www);
  writeFileSync(out, JSON.stringify(m, null, 2) + "\n");
  console.log(`manifest: editor ${m.editor.paths.length} paths, ${m.editor.script_hashes.length} hashes; simulator ${m.simulator.paths.length}; player ${m.player.paths.length}; corp ${m.corp_cross_origin.length}`);
}
