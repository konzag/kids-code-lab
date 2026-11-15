// FREE-PORTS (2026-11-15): a free TCP port on 127.0.0.1 for the checks' test server (makecode/serve.mjs), so two
// runs at the same time (CI has no concurrency group, or two local runs) never fight over one fixed port.
// Synchronous, because Playwright's config is: a child node binds 127.0.0.1:0, prints the port it got and closes it.
// The short window between that close and the server's own bind is accepted (same helper as family-calendar).
import { execFileSync } from "node:child_process";

const PROBE = "const s = require('node:net').createServer(); s.listen(0, '127.0.0.1', () => "
  + "{ process.stdout.write(String(s.address().port)); s.close(); });";

export function freePort() {
  const port = Number(execFileSync(process.execPath, ["-e", PROBE], { encoding: "utf8" }).trim());
  if (!Number.isInteger(port) || port <= 0) throw new Error(`free-port probe returned ${port}`);
  return port;
}
