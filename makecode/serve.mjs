// Minimal static server for the checks: serves a folder under a route prefix on 127.0.0.1 only,
// with an optional CSP header (the candidate hub CSP) and no Service-Worker-Allowed header.
// Usage: node serve.mjs <dir> [--port 8471] [--route /kids-code-lab/] [--csp none|strict|editor|play]
//                         [--block-sw] [--hub-headers]   (--block-sw: answer 404 for serviceworker.js, proves the editor runs without one)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, relative, resolve } from "node:path";
import { cspFor } from "./csp.mjs";

const args = process.argv.slice(2);
const root = resolve(args[0] ?? ".");
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : dflt;
};
const port = Number(opt("port", "8471"));
const route = opt("route", "/kids-code-lab/");
const cspMode = opt("csp", "none");
const blockSw = args.includes("--block-sw");
// --hub-headers: the games-hub SECURITY_HEADERS (app/core/middleware.py) on every response, to show what breaks
const HUB = args.includes("--hub-headers") ? {
  "x-frame-options": process.env.HUB_XFO ?? "SAMEORIGIN", // ADR-0006: SAMEORIGIN on the lab paths "referrer-policy": "no-referrer", "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()",
} : {};

// files the sandboxed simulator frame loads (makecode/sim/simulator.html), relative to the route
const SIM_ASSETS = /^(simulator\.html|pxtsim\.js|sim\.js|sim\.css|sim-keys\.js)$/;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".gif": "image/gif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject", ".wasm": "application/wasm", ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".xml": "application/xml", ".hex": "application/octet-stream", ".uf2": "application/octet-stream",
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  let p = decodeURIComponent(url.pathname);
  if (!p.startsWith(route)) { res.writeHead(404).end(); return; }
  p = p.slice(route.length);
  if (p === "" || p.endsWith("/")) p += "index.html";
  if (blockSw && /serviceworker\.js$/i.test(p)) { res.writeHead(404).end(); return; }
  const file = normalize(join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    let f = file;
    let s = await stat(f).catch(() => null);
    // pxt static routes: /kids-code-lab/<page> -> <page>.html (e.g. ---run, ---embed, ---simulator)
    if (!s && !extname(f)) { f += ".html"; s = await stat(f).catch(() => null); }
    if (!s || !s.isFile()) { res.writeHead(404).end(); return; }
    const body = await readFile(f);
    const type = TYPES[extname(f).toLowerCase()] ?? "application/octet-stream";
    const headers = { "content-type": type, "cache-control": "no-cache", "x-content-type-options": "nosniff", ...HUB };
    // The simulator frame runs sandboxed (opaque origin), so its own subresources are cross-origin requests:
    // with the hub CORP "same-origin" they would be blocked. These public static files get CORP "cross-origin".
    if (HUB["cross-origin-resource-policy"] && SIM_ASSETS.test(p)) headers["cross-origin-resource-policy"] = "cross-origin";
    const csp = type.startsWith("text/html") ? cspFor(cspMode, body.toString("utf8"), route + relative(root, f).split("\\").join("/")) : "";
    if (csp) headers["content-security-policy"] = csp;
    res.writeHead(200, headers).end(body);
  } catch (e) {
    res.writeHead(500).end(String(e.code ?? "error"));
  }
}).listen(port, "127.0.0.1", () => console.log(`serving ${root} at http://127.0.0.1:${port}${route} csp=${cspMode} blockSw=${blockSw}`));
