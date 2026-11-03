// A local fake of the games-hub API the lab uses (games-hub ADR-0006 + the contract of 2026-11-03), installed with
// Playwright routes: nothing listens on a port, nothing leaves the browser. Same origin as the lab (127.0.0.1).
//   GET    /api/profiles                     200 {"profiles":[{id,name}]} | 401 without the unlock session | 503
//   GET    /api/lab/games                    200 {"games":[{id,title,description,profile,created_at}]}
//   POST   /api/lab/games                    201 {"id","unpublish_token"} | 401 403 409 413 415 422 429(+Retry-After) 503
//   DELETE /api/lab/games/<id>               204 with X-Lab-Unpublish: <token> | 404 | 403
//   GET    /api/lab/games/<id>/binary        the gzip bytes, Content-Encoding: gzip, Content-Type: application/json
//   GET    /static/fonts/comfortaa.css       empty CSS (the hub's font file, not part of this repo)
import { gunzipSync } from "node:zlib";

export const PROFILES = [{ id: 1, name: "Δράκος" }, { id: 2, name: "Αστεράκι" }];

export class FakeHub {
  constructor() {
    this.unlocked = true;
    this.saveApiOn = true;
    this.forceStatus = null; // e.g. 409: the next POST answers with it
    this.games = new Map();
    this.nextId = 1;
    this.posts = []; // parsed POST bodies
    this.deletes = []; // {id, token}
    this.requests = []; // "METHOD /path"
  }

  async install(context) {
    await context.route("**/static/fonts/comfortaa.css", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "/* fake hub font css */" }));
    await context.route("**/api/**", (route) => this.handle(route));
  }

  json(route, status, body, headers = {}) {
    return route.fulfill({ status, contentType: "application/json", headers, body: body === undefined ? "" : JSON.stringify(body) });
  }

  error(route, status, code, extraHeaders = {}) {
    return this.json(route, status, { error: { code, message: code, trace_id: "fake", details: {} } }, extraHeaders);
  }

  async handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    this.requests.push(`${method} ${url.pathname}`);
    const path = url.pathname;

    if (path === "/api/profiles" && method === "GET") {
      if (!this.saveApiOn) return this.error(route, 503, "SERVICE_UNAVAILABLE");
      if (!this.unlocked) return this.error(route, 401, "UNAUTHORIZED");
      return this.json(route, 200, { profiles: PROFILES });
    }

    if (path === "/api/lab/games" && method === "GET") {
      const games = [...this.games.values()].map(({ id, title, description, profile, created_at }) => ({ id, title, description, profile, created_at }));
      return this.json(route, 200, { games });
    }

    if (path === "/api/lab/games" && method === "POST") {
      if (this.forceStatus) {
        const s = this.forceStatus;
        this.forceStatus = null;
        return this.error(route, s, `FORCED_${s}`, s === 429 ? { "Retry-After": "30" } : {});
      }
      if (!this.saveApiOn) return this.error(route, 503, "SERVICE_UNAVAILABLE");
      if (!this.unlocked) return this.error(route, 401, "UNAUTHORIZED");
      const origin = req.headers()["origin"];
      if (origin && origin !== url.origin) return this.error(route, 403, "FORBIDDEN");
      if (!/^application\/json/.test(req.headers()["content-type"] || "")) return this.error(route, 415, "UNSUPPORTED_MEDIA_TYPE");
      let body;
      try {
        body = JSON.parse(req.postData() || "");
      } catch {
        return this.error(route, 422, "VALIDATION_ERROR");
      }
      const keys = Object.keys(body).sort().join(",");
      if (keys !== "binary,cartridge,description,profile,title") return this.error(route, 422, "VALIDATION_ERROR");
      const t = Array.from(String(body.title || "").trim());
      if (t.length < 1 || t.length > 40 || Array.from(String(body.description)).length > 140) return this.error(route, 422, "VALIDATION_ERROR");
      if (!PROFILES.some((p) => p.id === body.profile)) return this.error(route, 422, "VALIDATION_ERROR");
      const png = Buffer.from(String(body.cartridge), "base64");
      const gz = Buffer.from(String(body.binary), "base64");
      if (png.length > 256 * 1024 || gz.length > 2 * 1024 * 1024) return this.error(route, 413, "PAYLOAD_TOO_LARGE");
      if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return this.error(route, 415, "UNSUPPORTED_MEDIA_TYPE");
      let game;
      try {
        game = JSON.parse(gunzipSync(gz).toString("utf8"));
      } catch {
        return this.error(route, 415, "UNSUPPORTED_MEDIA_TYPE");
      }
      if (!game || typeof game.js !== "string") return this.error(route, 415, "UNSUPPORTED_MEDIA_TYPE");
      if (this.games.size >= 100) return this.error(route, 409, "CONFLICT");
      const id = this.nextId++;
      const token = `tok-${id}-${Math.random().toString(36).slice(2)}`;
      this.posts.push(body);
      this.games.set(id, { id, title: body.title, description: body.description, profile: body.profile, created_at: new Date().toISOString(), gz, png, token });
      return this.json(route, 201, { id, unpublish_token: token });
    }

    let m = path.match(/^\/api\/lab\/games\/(\d{1,9})\/binary$/);
    if (m && method === "GET") {
      const g = this.games.get(Number(m[1]));
      if (!g) return this.error(route, 404, "NOT_FOUND");
      // The hub answers with the stored gzip bytes and Content-Encoding: gzip; the browser decodes them. Playwright's
      // route.fulfill hands the body to the page as-is (no decoding), so the fake sends the decoded JSON.
      return route.fulfill({ status: 200, headers: { "Content-Type": "application/json" }, body: gunzipSync(g.gz) });
    }

    m = path.match(/^\/api\/lab\/games\/(\d{1,9})$/);
    if (m && method === "DELETE") {
      const g = this.games.get(Number(m[1]));
      const token = req.headers()["x-lab-unpublish"];
      this.deletes.push({ id: Number(m[1]), token });
      if (!g) return this.error(route, 404, "NOT_FOUND");
      if (token !== g.token) return this.error(route, 403, "FORBIDDEN");
      this.games.delete(g.id);
      return route.fulfill({ status: 204, body: "" });
    }

    return this.error(route, 404, "NOT_FOUND");
  }
}
