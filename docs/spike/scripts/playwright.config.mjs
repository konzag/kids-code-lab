// Spike checks against the packaged editor served by serve.mjs on 127.0.0.1 only.
// PKG = the staticpkg output folder (default: the build folder of build.sh). CSP = none | editor | play.
import { defineConfig } from "@playwright/test";

const PKG = process.env.PKG ?? "D:/Git/.worktrees/kcl-spike-build/pxt-arcade/built/packaged/kids-code-lab";
const PORT = Number(process.env.PW_PORT ?? 8471);
const CSP = process.env.CSP ?? "none";
const BLOCK_SW = process.env.BLOCK_SW === "1" ? " --block-sw" : "";
const HUB = process.env.HUB_HEADERS === "1" ? " --hub-headers" : "";

export default defineConfig({
  testDir: "./e2e",
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
    command: `node serve.mjs "${PKG}" --port ${PORT} --route /kids-code-lab/ --csp ${CSP}${BLOCK_SW}${HUB}`,
    url: `http://127.0.0.1:${PORT}/kids-code-lab/index.html`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
