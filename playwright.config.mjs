// Checks of the packaged MakeCode Arcade site (docs/BUILD.md "Checks"), served by makecode/serve.mjs on 127.0.0.1.
// PKG = the slim site folder (default: .build/slim of makecode/build.sh).
// CSP = none | strict | editor | play (makecode/csp.mjs). SW=allow lets the browser register service workers.
// HUB_HEADERS=1 adds the games-hub security headers. EDITOR_TIGHT=1 = the recommended editor CSP pair.
import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const PKG = resolve(process.env.PKG ?? ".build/slim");
const PORT = Number(process.env.PW_PORT ?? 8471);
const CSP = process.env.CSP ?? "none";
const HUB = process.env.HUB_HEADERS === "1" ? " --hub-headers" : "";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results/artifacts",
  timeout: 240_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: "chromium",
    viewport: { width: 1280, height: 800 },
    serviceWorkers: process.env.SW === "allow" ? "allow" : "block",
  },
  webServer: {
    command: `node makecode/serve.mjs "${PKG}" --port ${PORT} --route /kids-code-lab/ --csp ${CSP}${HUB}`,
    url: `http://127.0.0.1:${PORT}/kids-code-lab/index.html`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
