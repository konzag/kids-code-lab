// The CI workflow (.github/workflows/build.yml) keeps the house rules (COVERAGE-1511, 2026-11-15):
// - CI-NO-CONCURRENCY: no `concurrency` on the workflow or on the build/lint jobs, so a run is never left «pending»
//   behind a cancelled one. Only `release` (it writes GitHub releases) keeps its own group, never cancelling.
// - main is the default branch and has no staging: CI on every PR into main, push CI only on main and on v* tags
//   (the release), so a PR commit runs once.
// - public repo: GitHub-hosted runners only, never the homelab runner (a fork PR could run code there).
// - no `${{ }}` inside a run: script (values go through env:).
// No YAML library: a small subset reader, the same as games-template's tests/ci-workflow.spec.ts.
// Run: node --test tests/unit/  (KCL_WORKFLOW=<path> checks another file.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(process.env.KCL_WORKFLOW ?? ".github/workflows/build.yml"), "utf8");

const lines = src
  .split(/\r?\n/)
  .filter((l) => l.trim() !== "" && !l.trim().startsWith("#"))
  .map((l) => ({ ind: l.length - l.trimStart().length, text: l.trim() }));

const scalar = (s) => s.replace(/\s+#.*$/, "").trim().replace(/^(['"])(.*)\1$/, "$2");

// mappings, flow/block lists of scalars, block scalars; list items that are mappings (steps) keep their first line
function parse(i, ind) {
  if (lines[i].text.startsWith("- ")) {
    const list = [];
    while (i < lines.length && lines[i].ind === ind && lines[i].text.startsWith("- ")) {
      list.push(scalar(lines[i].text.slice(2)));
      i++;
      while (i < lines.length && lines[i].ind > ind) i++;
    }
    return [list, i];
  }
  const map = {};
  while (i < lines.length && lines[i].ind >= ind) {
    if (lines[i].ind > ind) { i++; continue; }
    const m = /^("[^"]+"|'[^']+'|[^:]+):\s*(.*)$/.exec(lines[i].text);
    if (!m) { i++; continue; }
    const key = scalar(m[1]);
    const rest = m[2].replace(/\s+#.*$/, "");
    i++;
    if (/^[|>][-+]?$/.test(rest)) {
      const body = [];
      while (i < lines.length && lines[i].ind > ind) body.push(lines[i++].text);
      map[key] = body.join("\n");
    } else if (rest === "") {
      if (i < lines.length && lines[i].ind > ind) [map[key], i] = parse(i, lines[i].ind);
      else map[key] = null;
    } else if (rest.startsWith("[")) {
      map[key] = rest.replace(/^\[|\]$/g, "").split(",").map(scalar).filter(Boolean);
    } else {
      map[key] = scalar(rest);
    }
  }
  return [map, i];
}

const doc = parse(0, 0)[0];
const jobs = doc.jobs ?? {};

test("KCL-U17 triggers: PR into main, push only on main and v* tags, workflow_dispatch", () => {
  assert.deepEqual(Object.keys(doc.on ?? {}).sort(), ["pull_request", "push", "workflow_dispatch"]);
  assert.deepEqual(Object.keys(doc.on.pull_request ?? {}), ["branches"], "no paths/types filter on pull_request");
  assert.deepEqual(doc.on.pull_request.branches, ["main"]);
  assert.deepEqual(Object.keys(doc.on.push ?? {}).sort(), ["branches", "tags"]);
  assert.deepEqual(doc.on.push.branches, ["main"], "push CI on every branch would run each PR commit twice");
  assert.deepEqual(doc.on.push.tags, ["v*"], "the release runs on v* tags");
});

test("KCL-U18 no concurrency in CI; only release keeps its own group and never cancels", () => {
  assert.equal("concurrency" in doc, false, "workflow-level concurrency (CI-NO-CONCURRENCY)");
  for (const [id, job] of Object.entries(jobs)) {
    if (id === "release") continue;
    assert.equal("concurrency" in (job ?? {}), false, `job "${id}" has a concurrency group`);
  }
  const c = jobs.release?.concurrency;
  if (c) assert.equal(c["cancel-in-progress"], "false", "the release group must never cancel a run");
});

test("KCL-U19 jobs build and lint always run; release only on v* tags after both", () => {
  for (const id of ["build", "lint"]) {
    assert.ok(jobs[id], `job "${id}" missing`);
    assert.equal(jobs[id].if, undefined, `job "${id}" must not be conditional (a skipped job reports success)`);
  }
  assert.equal(jobs.release?.if, "startsWith(github.ref, 'refs/tags/v')");
  assert.deepEqual([].concat(jobs.release.needs).sort(), ["build", "lint"]);
});

test("KCL-U20 public repo: every job on a GitHub-hosted runner, never self-hosted / vars.RUNNER", () => {
  for (const [id, job] of Object.entries(jobs)) {
    assert.match(String(job["runs-on"]), /^ubuntu-[0-9.]+$|^ubuntu-latest$/, `job "${id}" runs-on`);
  }
  assert.doesNotMatch(src, /self-hosted|vars\.RUNNER/);
});

test("KCL-U21 no ${{ }} expression inside a run: script", () => {
  const raw = src.split(/\r?\n/);
  const bad = [];
  raw.forEach((l, n) => {
    const m = /^(\s*(?:- )?)run:\s*(.*)$/.exec(l);
    if (!m) return;
    const col = m[1].length;
    const body = [m[2]];
    for (let k = n + 1; k < raw.length && (raw[k].trim() === "" || raw[k].length - raw[k].trimStart().length > col); k++) body.push(raw[k]);
    if (body.join("\n").includes("${{")) bad.push(`line ${n + 1}: ${l.trim()}`);
  });
  assert.deepEqual(bad, []);
});
