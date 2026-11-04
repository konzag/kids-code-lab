// Candidate CSPs measured in the spike (SPIKE-REPORT.md §2). Like games-hub `page_csp()`, every inline <script>
// of the served HTML is allowed by its sha256 (never 'unsafe-inline' for scripts). The CSP is per page:
// the simulator frame (simulator.html) runs the compiled game and is the only page that may need 'unsafe-eval'.
// Modes:
//   none     no header (baseline)
//   strict   hub-like for every page: no eval, no blob:   -> shows what MakeCode needs beyond the hub CSP
//   editor   narrowest CSP found for the editor page + simulator frame
//   play     narrowest CSP found for the play-only page + simulator frame
//   adr      games-hub ADR-0006: per page kind (editor, simulator frame, player, lab pages), what infra sends
import { createHash } from "node:crypto";
import { kindOf } from "./manifest.mjs";

export function inlineScriptHashes(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    out.push(`'sha256-${createHash("sha256").update(m[2], "utf8").digest("base64")}'`);
  }
  return [...new Set(out)];
}

const BASE = [
  "default-src 'none'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
];

// Directives per page kind and mode. `null` = page not expected in that mode (gets the strict CSP).
const TABLE = {
  strict: {
    any: ["script-src 'self' HASHES", "img-src 'self' data:", "connect-src 'self'", "frame-src 'self'",
      "worker-src 'self'", "media-src 'self'", "frame-ancestors 'self'"],
  },
  editor: {
    // index.html (editor). Findings in SPIKE-REPORT.md §2.
    any: ["script-src 'self' HASHES EDITOR_EVAL", "img-src 'self' data: blob:", "connect-src 'self' data: blob:",
      "frame-src 'self'", "worker-src 'self' blob:", "media-src 'self' data: blob:", "frame-ancestors 'self'"],
    sim: ["script-src 'self' HASHES 'unsafe-eval'", "img-src 'self' data: blob:", "connect-src 'self' data: blob:",
      "frame-src 'none'", "worker-src 'none'", "media-src 'self' data: blob:", "frame-ancestors 'self'"],
  },
  play: {
    any: ["script-src 'self' HASHES", "img-src 'self' data:", "connect-src 'self'", "frame-src 'self'",
      "worker-src 'none'", "media-src 'none'", "frame-ancestors 'none'"],
    sim: ["script-src 'self' HASHES 'unsafe-eval'", "img-src 'self' data: blob:", "connect-src 'none'",
      "frame-src 'none'", "worker-src 'none'", "media-src 'self' data: blob:", "frame-ancestors 'self'"],
  },
};

// ADR-0006 (games-hub): one CSP per page kind, as infra's file server sends them.
// ADR-0006 page kinds come from the release manifest's rules (makecode/manifest.mjs): editor (index.html, run.html,
// the lab's own pages lab/*), simulator (simulator.html), player (play/*). The test server sends exactly what infra
// sends for each kind.
export function pageKind(path) {
  const rel = String(path).replace(/^.*\/kids-code-lab\//, "").replace(/^\//, "");
  const k = kindOf(rel);
  return k === "simulator" ? "sim" : k === "player" ? "play" : "editor";
}

function adrCsp(html, path) {
  const kind = pageKind(path);
  // ADR-0006 amendment 2026-11-04 (WP3): the editor page's worker-src adds data: for MakeCode's music editor
  // metronome (pxsim AudioContextManager.Metronome: new Worker("data:application/javascript,...")). A data: worker
  // runs with an opaque origin: no access to the page, its storage or cookies.
  const EDITOR_ADR = TABLE.strict.any.map((d) => (d.startsWith("worker-src") ? "worker-src 'self' data:" : d));
  const t = kind === "editor" ? { any: EDITOR_ADR } : { any: TABLE.play.any, sim: TABLE.play.sim };
  const k = kind === "sim" ? "sim" : "any";
  return [...BASE, ...t[k]].join("; ").replace("HASHES", inlineScriptHashes(html).join(" ")).replace(/ +/g, " ").replace(/ ;/g, ";");
}

export function cspFor(mode, html, path = "") {
  if (mode === "adr") return adrCsp(html, path);
  let t = TABLE[mode];
  if (!t) return "";
  // EDITOR_TIGHT=1: the editor page gets the strict (hub-like) directives; only the simulator keeps its own.
  // This is the recommended pair: editor page = hub-like CSP, simulator frame = the play simulator CSP.
  if (mode === "editor" && process.env.EDITOR_TIGHT === "1") t = { any: TABLE.strict.any, sim: TABLE.play.sim };
  // play mode: only the player pages (/play/) get the play CSP; run.html (compile at publish time) is an editor page
  if (mode === "play" && !/\/play\/[^/]*$/.test(path) && !/(^|\/)simulator\.html$/.test(path)) t = TABLE.editor;
  const kind = /(^|\/)simulator\.html$/.test(path) && t.sim ? "sim" : "any";
  const editorEval = process.env.EDITOR_EVAL === "0" ? "" : "'unsafe-eval'";
  return [...BASE, ...t[kind]]
    .join("; ")
    .replace("HASHES", inlineScriptHashes(html).join(" "))
    .replace("EDITOR_EVAL", editorEval)
    .replace(/ +/g, " ")
    .replace(/ ;/g, ";");
}
