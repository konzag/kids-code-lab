// Shared helpers: record every request of a browser context (pages, iframes, workers) and every CSP violation.
// Requests to anything but 127.0.0.1 are aborted AND recorded, so a leak fails the test without reaching the net.
export async function recordAll(context) {
  const requests = [];
  const external = [];
  const violations = [];
  await context.route("**/*", (route) => {
    const url = route.request().url();
    const u = new URL(url);
    const local = u.protocol === "data:" || u.protocol === "blob:" || u.hostname === "127.0.0.1";
    if (!local) {
      external.push(`${route.request().method()} ${u.origin}${u.pathname}`);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  context.on("request", (r) => requests.push(r.url()));
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.log(`CSP-VIOLATION ${e.effectiveDirective} ${e.blockedURI} ${e.sourceFile ?? ""}:${e.lineNumber ?? ""}`);
    });
  });
  return { requests, external, violations };
}

// Call for every page right after context.newPage(): console messages of the page AND its frames (simulator).
export function watchPage(page, rec) {
  const errors = [];
  page.on("console", (m) => {
    const t = m.text();
    if (t.startsWith("CSP-VIOLATION") || /Content Security Policy/i.test(t)) rec.violations.push(t.slice(0, 300));
    else if (m.type() === "error") errors.push(t.slice(0, 300));
  });
  page.on("pageerror", (e) => {
    const t = String(e.message);
    if (/Content Security Policy|unsafe-eval/i.test(t)) rec.violations.push(t.slice(0, 300));
    else errors.push(t.slice(0, 300));
  });
  return errors;
}

export function summarize(requests) {
  const byHost = {};
  for (const r of requests) {
    let h;
    try { h = new URL(r).host || new URL(r).protocol; } catch { h = "invalid"; }
    byHost[h] = (byHost[h] ?? 0) + 1;
  }
  return byHost;
}
