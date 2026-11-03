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
const LAB = ["default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "font-src 'self'",
  "connect-src 'self'", "frame-src 'self'", "worker-src 'none'", "media-src 'none'", "manifest-src 'self'",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"];

export function pageKind(path) {
  if (/(^|\/)simulator\.html$/.test(path)) return "sim";
  if (/\/play\/[^/]*$/.test(path)) return "play";
  if (/\/lab\/[^/]*$/.test(path)) return "lab";
  return "editor";
}

function adrCsp(html, path) {
  const kind = pageKind(path);
  if (kind === "lab") return LAB.join("; ");
  const t = kind === "editor" ? { any: TABLE.strict.any } : { any: TABLE.play.any, sim: TABLE.play.sim };
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
