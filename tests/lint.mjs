// Lint (npm run lint): every tracked .js/.mjs file parses (node --check) and every tracked shell script passes
// shellcheck. Locally shellcheck is optional (a note when it is missing); in CI (CI=true) it is required.
// docs/spike/ is left out: the frozen scripts of the spike report (docs/spike/SPIKE-REPORT.md), not built or run.
import { execFileSync, spawnSync } from "node:child_process";

const tracked = (...globs) => execFileSync("git", ["ls-files", "-z", "--", ...globs], { encoding: "utf8" })
  .split("\0").filter((f) => f && !f.startsWith("docs/spike/"));

let failed = 0;
const js = tracked("*.js", "*.mjs");
for (const f of js) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status !== 0) { failed++; console.error(`node --check ${f}\n${r.stderr}`); }
}
console.log(`node --check: ${js.length} files, ${failed} failed`);

const sh = tracked("*.sh");
const sc = spawnSync("shellcheck", ["--version"], { encoding: "utf8" });
if (sc.error) {
  if (process.env.CI) { failed++; console.error("shellcheck is not installed (required in CI)"); }
  else console.log(`shellcheck not installed: ${sh.length} shell scripts not checked (CI checks them)`);
} else {
  const r = spawnSync("shellcheck", sh, { encoding: "utf8" });
  if (r.status !== 0) { failed++; console.error(r.stdout + r.stderr); }
  console.log(`shellcheck: ${sh.length} files, ${r.status === 0 ? "clean" : "findings"}`);
}
process.exit(failed ? 1 : 0);
