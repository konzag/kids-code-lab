// The test server's "adr" mode (makecode/csp.mjs) must keep matching the three CSP texts of games-hub ADR-0006
// decision 3 (as at games-hub d324f13, editor worker-src with the data: amendment of 2026-11-04), and the page kinds
// must be those of the release manifest (makecode/manifest.mjs). Order of directives does not matter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cspFor, pageKind } from "../../makecode/csp.mjs";
import { kindOf } from "../../makecode/manifest.mjs";

const ADR = {
  editor: "default-src 'none'; script-src 'self' HASHES; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; worker-src 'self' data:; media-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  simulator: "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; media-src 'self' data: blob:; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  player: "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; worker-src 'none'; media-src 'none'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
const norm = (csp) => csp.split(";").map((d) => d.trim().replace(/\s+/g, " ")).filter(Boolean).sort();
const HTML = "<html><head><script>var pxtConfig = 1;</script><script src=\"x.js\"></script></head></html>";

test("KCL-U13 adr mode = ADR-0006 texts for editor, simulator, player", () => {
  const editor = cspFor("adr", HTML, "/kids-code-lab/index.html");
  const hash = editor.match(/'sha256-[^']+'/)[0];
  assert.deepEqual(norm(editor), norm(ADR.editor.replace("HASHES", hash)));
  assert.deepEqual(norm(cspFor("adr", HTML, "/kids-code-lab/run.html")), norm(ADR.editor.replace("HASHES", hash)));
  assert.deepEqual(norm(cspFor("adr", "", "/kids-code-lab/lab/edit.html")), norm(ADR.editor.replace(" HASHES", "")));
  assert.deepEqual(norm(cspFor("adr", "", "/kids-code-lab/simulator.html")), norm(ADR.simulator));
  assert.deepEqual(norm(cspFor("adr", "", "/kids-code-lab/play/index.html")), norm(ADR.player));
});

test("KCL-U14 page kinds = the manifest rules", () => {
  assert.equal(kindOf("index.html"), "editor");
  assert.equal(kindOf("run.html"), "editor");
  assert.equal(kindOf("lab/index.html"), "editor");
  assert.equal(kindOf("lab/"), "editor");
  assert.equal(kindOf("simulator.html"), "simulator");
  assert.equal(kindOf("play/index.html"), "player");
  assert.equal(kindOf("play/"), "player");
  assert.equal(kindOf("docfiles/x.html"), null);
  assert.equal(pageKind("/kids-code-lab/play/index.html"), "play");
  assert.equal(pageKind("/kids-code-lab/simulator.html"), "sim");
});
