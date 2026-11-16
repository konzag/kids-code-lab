// FREE-PORTS (2026-11-15): CI has no concurrency group, so two runs of the checks can start at the same time. With
// PW_PORT unset, each run must get its own free port for makecode/serve.mjs, and both servers must answer.
// Each config load runs in its own node process, like two Playwright runs. Run: node --test tests/unit/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const CONFIG = pathToFileURL(resolve("playwright.config.mjs")).href;
const READ = `const c = (await import(${JSON.stringify(CONFIG)})).default;
console.log(JSON.stringify({ base: c.use.baseURL, url: c.webServer.url, command: c.webServer.command }));`;

async function loadConfig(env = {}) {
  const childEnv = { ...process.env };
  delete childEnv.PW_PORT;
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e", READ], { env: { ...childEnv, ...env } });
  return JSON.parse(stdout);
}

// makecode/serve.mjs exactly as the config's webServer starts it, on a tiny site folder
function serve(dir, port) {
  return spawn(process.execPath, ["makecode/serve.mjs", dir, "--port", String(port), "--route", "/kids-code-lab/", "--csp", "none"],
    { stdio: "ignore" });
}

async function answers(url, ms = 10_000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const res = await fetch(url);
      return res.status;
    } catch (err) {
      if (Date.now() > end) throw err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

test("KCL-U15 two runs started at the same time get different free ports and both servers answer", async () => {
  const [a, b] = await Promise.all([loadConfig(), loadConfig()]);
  const ports = [a, b].map((c) => Number(new URL(c.base).port));
  assert.notEqual(ports[0], ports[1], `both runs got port ${ports[0]}`);
  for (const [i, c] of [a, b].entries()) {
    assert.match(c.command, new RegExp(` --port ${ports[i]} `), "serve.mjs must get the port baseURL uses");
    assert.equal(c.url, `${c.base}/kids-code-lab/index.html`);
  }
  const dir = mkdtempSync(join(tmpdir(), "kcl-port-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title>");
  const servers = ports.map((port) => serve(dir, port));
  try {
    for (const c of [a, b]) assert.equal(await answers(c.url), 200);
  } finally {
    for (const s of servers) s.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("KCL-U16 PW_PORT stays the override (and is what every Playwright worker re-reads)", async () => {
  const c = await loadConfig({ PW_PORT: "45678" });
  assert.equal(c.base, "http://127.0.0.1:45678");
  assert.match(c.command, / --port 45678 /);
});
