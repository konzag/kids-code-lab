# SPIKE-REPORT: MakeCode Arcade as a static offline site (spec §4, queue item L1-27)

Date: 2026-11-03. Branch `list1/l1-27-spike`. Report only: nothing was deployed, the hub and the hosts were not
touched. Everything below was measured on a Windows 11 dev PC (Node 24, Chromium 141 headless through
Playwright 1.56), with the build served by `scripts/serve.mjs` on `127.0.0.1` only.

**Built:** `microsoft/pxt-arcade` tag `v4.2.1` (pins `pxt-core` 13.2.1 and `pxt-common-packages` 14.1.4), packaged
with `pxt staticpkg --route /kids-code-lab --locs-src <el translations> --no-appcache`, then post-patched.
Reproducible with [`scripts/build.sh`](scripts/build.sh) (about 10 minutes; logs in the build folder, outside the
repo). The checks are [`scripts/run-checks.sh`](scripts/run-checks.sh) (Playwright specs in `scripts/e2e/`).

**Short answer:** MakeCode Arcade runs fully offline from a static folder: 0 requests outside `127.0.0.1`, no
service worker, Greek UI available (partly translated), and a published game can be played by a small page
without the editor. It needs `'unsafe-eval'` in the simulator frame only, and the slim build is 77 MB in
1 583 files (editor first load 28 MB, 6.4 MB gzip). That does not fit the hub's model (in-memory catalog of a
pinned submodule, a fixed suffix list without `.json`/`.md`, "never `'unsafe-eval'`"). Recommendation (§8): its
own static path on VM 106, LAN/tailnet only, the §12a.3 fallback.

## Build notes (what was needed before the questions could be answered)

| Problem | Fix in the spike |
|---|---|
| The Arcade **simulator source** (`microsoft/pxt-arcade-sim`, optional dependency) is a **private** repo; `npm install` skips it silently and `pxt staticpkg` fails (`ENOENT ... pxt-arcade\public`). The public repo has had no simulator since 2019 (commit c5ff339 "Sim npm module"). | The compiled `built/sim.js` + `sim-strings.json` are taken from the npm package `pxt-arcade@4.2.1` (same version, MIT). `simulator.html` is the markup of the public `trg-arcade.userpxt.io/---simulator` page with all CDN links made local ([`scripts/sim/simulator.html`](scripts/sim/simulator.html), inline `<style>` moved to `sim-shell.css`). `sim.css` is downloaded from `cdn.makecode.com` and pinned by SHA-256. |
| `pxt staticpkg` builds a **hardware hex cache** (stm32, samd, nrf52, rp2040) through the **makecode.com cloud compiler** at build time (first run 7.5 min, 25 polls). | Accepted for the spike (build machine only, cached in `built/hexcache`). The lab does not flash hardware (spec §11); a follow-up can drop the hardware variants from `pxtarget.json` so the build needs no makecode.com at all. |
| Git Bash rewrote `--route /kids-code-lab` into `C:/Program Files/Git/kids-code-lab` (`EINVAL mkdir ...packaged\C:`). | `MSYS_NO_PATHCONV=1` on that one command (no effect on Linux CI). |

Risk to note for the product: the simulator is not buildable from public source. The npm package is MIT; the
`sim.css` on the CDN carries no licence header. Before the real build, either confirm the licence with the
pxt-arcade maintainers or write our own `sim.css` (60 KB, layout of the console frame only).

## 1. Size of the static build

**Answer.**

| Variant | Size | Files | Notes |
|---|---|---|---|
| Full `pxt staticpkg` output | 464 MB | 5 717 | `docs/` = 389 MB (the makecode.com docs site: 1 460 html, 1 303 png, 868 gif, 86 mp4, 38 pdf), `hexcache/` 13 MB |
| **Slim** (`patch-output.mjs --slim`) | **77.3 MB** | **1 583** | editor + simulator + player + `el` locales + tutorials as markdown only; 16 MB as `.tar.gz` |
| Editor first load (measured) | 28.4 MB raw, **6.4 MB gzip** | 69 requests | biggest: `target.js` 11.9 MB, `main.js` 4.3 MB, `pxtembed.js` 3.9 MB, Monaco `tsWorker.js` 4.2 MB, `pxtworker.js` 2.4 MB |
| Play-only page (measured) | 0.78 MB + the game | 10 requests | `pxtsim.js` 0.2 MB, `sim.js` 0.26 MB, css; no editor, no compiler |

Slim content by type: 1 381 `.md` (25 MB, the tutorials and reference pages; can be cut to the chosen
«Μαθήματα»), 62 `.js`, 12 `.json` (`target.json` alone 11.9 MB), fonts `.woff/.woff2/.ttf/.eot`, sounds `.mp3/.m4a`.

**Evidence.** `du`/`find` on `built/packaged/kids-code-lab` and on the slim copy; byte counts of every response in
the Playwright runs (`test-results/editor-requests.json`, `play-requests.json`).

**Consequence for the design.**
- **Not as a games-hub submodule.** A submodule must contain the build output in git: 77 MB / 1 583 files per
  MakeCode version, a new 16 MB+ of history on every upgrade, and spec §10 already says the build runs in CI and the
  artefact is attached to the release.
- **Not through the hub catalog as it is:** `app/services/catalog.py` loads every served file into RAM at startup
  (77 MB more per worker), serves only `SUFFIXES` (no `.json`, `.md`, `.ttf`, `.woff`, `.eot`, `.m4a`: the editor
  needs all of them; `.md` is explicitly "never served"), and the gzip middleware compresses every response at
  level 6 on the fly (12 MB `target.js` on every editor load).
- A plain static folder served by a file server with precompressed files (gzip/br made in CI) fits naturally.

## 2. CSP

**Answer.** Measured per page, with every inline `<script>` allowed by its sha256 (as the hub's `page_csp()` does):

- `'unsafe-eval'` is needed **only in the simulator frame** (`simulator.html`): the compiled game is a JS string that
  `pxsim` evaluates. With a hub-like CSP the game never starts: *"Refused to evaluate a string as JavaScript
  because 'unsafe-eval' is not an allowed source of script ... script-src 'self'"*.
- The **editor page** itself runs with the hub-like CSP: no `'unsafe-eval'`, no `blob:`; workers (`worker.js`,
  `tsworker.js`, Monaco) are same-origin files (`worker-src 'self'`). The simulator is a **same-origin iframe**
  (`frame-src 'self'` on the editor, `frame-ancestors 'self'` on the simulator).
- Inline scripts: `index.html` has a few small inline blocks (config, loader); they are fixed per build, so hashes
  work. No inline event handlers were needed. Inline **styles** are needed (`'unsafe-inline'` in `style-src`, as
  on hub game pages: the editor and Blockly set `style=` at runtime).
- Fonts: `font-src 'self' data:` (the icon fonts are `data:` URIs inside `semantic.css`).
- The hub's `X-Frame-Options: DENY` did not break the simulator in Chromium because CSP `frame-ancestors` takes
  precedence; still set it to `SAMEORIGIN` on the lab paths so older browsers behave the same.

**Narrowest CSP found, editor page** (`index.html`, `run.html`):

```
default-src 'none'; script-src 'self' 'sha256-<each inline script>'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; worker-src 'self';
media-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'
```

**Simulator frame** (`simulator.html`, used by the editor and by the player):

```
default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; worker-src 'none';
media-src 'self' data: blob:; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'
```

**Play-only page** (`play/play.html`, no inline script):

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;
connect-src 'self'; frame-src 'self'; worker-src 'none'; media-src 'none'; manifest-src 'self'; base-uri 'none';
form-action 'none'; frame-ancestors 'none'
```

(`connect-src 'self'` on the player only to fetch the game JSON; `style-src 'unsafe-inline'` can likely be dropped
there, not measured.)

**Evidence.** `scripts/csp.mjs` (modes `strict`, `editor`, `play`), `scripts/run-checks.sh`: editor flow with
`CSP=editor EDITOR_TIGHT=1` = the two blocks above → 0 violations, also with the hub security headers
(`HUB_HEADERS=1`); play flow with `CSP=play` → 0 violations; `CSP=strict` (hub-like everywhere) → game blocked.
Not covered by the flow (so not proven): the asset/image editor, music editor, GIF recording, extensions,
tutorials. They may need `blob:` in `img-src`/`worker-src`; the first build must run those in the e2e suite.

**Consequence.** The hub rule "never `'unsafe-eval'` in script-src" (games-hub CLAUDE.md, GAME-STANDARD §4) must
get an exception for exactly one page, `simulator.html`, in an ADR (games-hub ADR-0003 or a lab ADR). The simulator
frame has `connect-src 'none'`, `frame-ancestors 'self'` and serves no user data, so `'unsafe-eval'` there runs
only the compiled game the child built.

## 3. Service worker

**Answer.** The static build **does not register** a service worker. The editor registers
`serviceworker.js` only if `!pxt.webConfig.isStatic && !isLocalHost` (in `main.js`: `!("serviceWorker"in
navigator)||pxt.webConfig.isStatic||pxt.BrowserUtils.isLocalHost(!0)||...register(...)`) and `staticpkg` writes
`isStatic: true`; the simulator registers its worker only on `---simulator` URLs (the static build uses
`simulator.html`). App cache is off with `--no-appcache`. To be sure nothing can register later,
`patch-output.mjs` deletes `serviceworker.js`, `simulatorserviceworker.js` and `release.manifest`.

**Evidence.** Editor e2e with service workers **allowed** in the browser context (`SW=allow`):
`navigator.serviceWorker.getRegistrations()` = 0, `context.serviceWorkers()` = 0, the project runs in the
simulator with both worker files deleted.

**Consequence.** GAME-STANDARD "no service worker" holds without code changes in MakeCode; the deletion is a
two-line build step. The e2e test keeps the 0-registration check (spec §9).

## 4. External calls

**Answer.** After two patches the editor flow makes **0 requests outside 127.0.0.1**.

Flow (`e2e/editor.spec.mjs`): open the editor in Greek → «Νέο έργο» → type `scene.setBackgroundColor(2)` in
JavaScript → back to Blocks (decompiled to 3 blocks) → the simulator screen turns red (pixel check) → save the
`.png` cartridge. Every request of the page, the simulator iframe and the workers is recorded; anything not on
127.0.0.1 is aborted and fails the test.

| Run | Outside 127.0.0.1 |
|---|---|
| unpatched, English | `POST https://dc.services.visualstudio.com/v2/track` (Application Insights telemetry, on page load, even though `ai.2.min.js` is served locally) |
| unpatched, `?lang=el` | the above + 68× `GET https://makecode.com/api/translations` ("live" translations) |
| patched (final build, `?lang=el`) | **0** (74 requests, all `127.0.0.1`) |

Final runs on the rebuilt slim package (`scripts/run-checks.sh`):

| Run | Result | Requests | External | CSP violations |
|---|---|---|---|---|
| editor, no CSP, service workers allowed | pass | 74 | 0 | – |
| editor, recommended CSP pair (`EDITOR_TIGHT=1`) | pass | 74 | 0 | 0 |
| same + games-hub security headers | pass | 74 | 0 | 0 |
| play-only page, play CSP | pass | 26 (incl. compile step) | 0 | 0 |
| play-only page, hub-like CSP everywhere | **fails as expected** (game blocked by missing `'unsafe-eval'`) | | | |

Console errors left (spec §9 wants 0, so the build must silence them): `Unable to determine region` from
`pxt.Cloud.initRegionAsync` (offline lookup, harmless), 404s for MakeCode home-gallery images, and with the hub's
`Permissions-Policy` two notices (`usb`, `microphone`: hardware/microphone features the lab does not use).

**What had to be patched:**
1. `patch-output.mjs`: remove the `<!-- include apptracking.html -->` block (App Insights loader + instrumentation
   key) from the HTML pages; delete `ai.2.min.js`.
2. `patch-target.mjs`: `appTheme.disableLiveTranslations = true` (otherwise any non-English language fetches from
   makecode.com; `?staticlang=1` is the URL-level equivalent and was used to test before the rebuild).

Not hit by the flow but present in the bundles (fire only on a user action): GitHub API (extensions / GitHub
repos), makecode.com share/cloud/sign-in, YouTube thumbnails, "Explain with AI". The CSP above blocks all of them
(`connect-src 'self'`, `img-src 'self' data:`); the UI entries (Sign in, Share, GitHub button, Extensions, AI help,
the MakeCode home page gallery) should be hidden for the children by `pxtarget.json` theme flags in the build
(follow-up; the lab opens the editor directly, not MakeCode's home page). The home gallery also has 404s for
`/static/...` images with absolute paths (cosmetic).

**Build-time** network (CI only, never the child's browser): GitHub (clone), npm registry, makecode.com cloud
compiler (hardware hex cache), cdn.makecode.com (`sim.css`), makecode.com translations API.

**Consequence.** Offline is achievable with two small, documented patches. The e2e "0 external requests" test is
the guard for every MakeCode upgrade.

## 5. Fonts

**Answer.** No Google Fonts or other remote font links in the editor or simulator. `grep` for
`fonts.googleapis|fonts.gstatic|typekit` over the package found one hit only, in a docs page
(`docs/hour-of-code/educators-2021.html`, not in the slim build). The UI uses system font stacks (`Segoe UI, ...,
Roboto, Helvetica Neue, sans-serif`) plus bundled icon fonts (`fonts/icons.*`, `brand-icons.*`, `outline-icons.*`,
and `data:` WOFF inside `semantic.css`/`icons.css`); `sim.css` has no `url()` at all.

**Consequence.** Nothing to remove for the slim build; `font-src 'self' data:`. Comfortaa (hub font) only on the
lab's own pages as the spec says.

## 6. Greek

**Answer.** Available but **incomplete**, and not enabled by default in Arcade.
- `el` is **not** in Arcade's `appTheme.availableLocales`; the bundled files are ignored without it →
  `patch-target.mjs` adds it. Translations are bundled at build time from the public (token-less) makecode.com
  API with `--locs-src` (`scripts/fetch-locs.mjs`); the browser loads `locales/el/*.json` from the same origin.
- Coverage (approved Crowdin strings, 2026-11-03, `fetch-locs.mjs` output):

| File | el | base | % |
|---|---|---|---|
| `strings.json` (editor UI, vs German as reference) | 1 171 | 2 442 | 48 % |
| `webstrings.json` (vs de) | 83 | 347 | 24 % |
| `arcade/game-strings.json` (Sprites/Game **block texts**) | 52 | 368 | 14 % |
| `arcade/base-strings.json` (loops, logic, math blocks) | 74 | 160 | 46 % |
| `arcade/target-strings.json` (categories, target UI) | 9 | 201 | 4 % |
| all files | 2 539 | 8 312 | **31 %** |

  For comparison German has 357/368 game blocks (97 %), French 316 (86 %); unapproved Greek strings add nothing.
- What a child sees (`?lang=el`): menus, dialogs, toolbox «Παιχνίδι», «Μουσική», «Βρόχοι», «Λογική», «Μεταβλητές»,
  «Μαθηματικά», «Επεκτάσεις», «Λήψη», «Μπλοκ», «κατά την έναρξη» in Greek; **«Sprites», «Controller», «Scene»,
  «Info», «Animation» and most game blocks (e.g. "set background color to") in English.**
- Default el with English as an option: the URL parameter wins over MakeCode's language cookie, so the lab page
  opens the editor with `index.html?lang=el` or `?lang=en` from its own setting (`game.kids-code-lab.v1`) and offers
  the switch in its top bar. `availableLocales` can be reduced to `["en", "el"]` so MakeCode's own language menu
  shows only those two (not done in the spike). `appTheme.defaultLocale` was not tested (it also changes which
  docs language counts as "built-in").

**Consequence.** Owner question §12.8 needs a second look: the editor shell is about half Greek, the game blocks
the children use most are mostly English. Options: accept (reading age 7+, English block words are short), or
contribute/keep our own `el` overrides for the ~370 `game-strings` (a local JSON merged at build time; a Crowdin
contribution helps everyone). The bundling path is proven either way.

## 7. Export format and play-only page

**Answer.**
- **`.png` cartridge** (the editor's save button; 12.9 KB for the test project, a `data:` URL download): the project
  **source** hidden in the image. It needs the compiler to run, so it is the backup and the cover image, not the
  thing the player loads. (`.mkcd` was not tested; it is also source.)
- **Compiled game = pxtc `BuiltSimJsInfo` JSON** (`{js, targetVersion, fnArgs, parts, usedBuiltinParts, ...}`),
  the same format MakeCode itself ships under `docs/static/builtjs/<id>.json`. The packaged runner produces it
  without the editor UI: `run.html?code=<url-encoded program>&sendBuilt=1` compiles in the browser and
  `postMessage`s the object to its parent (it can also take a whole project with `server=1` + a `simulateproject`
  message). Test project: **1.77 MB raw, 264 KB gzip**; MakeCode's bundled example game is 2.4 MB raw.
- **Play-only page works** with just `pxtsim.js` + `simulator.html` (+ `sim.js`, css): `pxsim.SimulatorDriver`
  in a 25-line script ([`scripts/player/play.js`](scripts/player/play.js)) fetches the JSON from the same origin
  and calls `driver.run(built.js, {fnArgs, parts, builtinParts})`. Proven by `e2e/play.spec.mjs`: compile with
  `run.html`, then `play.html` runs it, red screen + arrow keys, 10 requests, none of `main.js`/`target.js`/
  `pxtembed.js`/`pxtworker.js`, 0 external, 0 CSP violations under the play CSP.
- `run.html?code=` alone can also play from source, but loads 16.7 MB (`target.js` + `pxtembed.js`) and needs the
  compiler worker. `#sandbox`/`--embed`/`run.html?id=` expect makecode.com share ids (cloud) and are not usable.

**Consequence.** Publish = the lab page asks the editor for the project (editor host messages, e.g.
`saveproject`, with the editor in an iframe in controller mode; to be built and tested in the first work package)
or the child's cartridge, compiles it once with a hidden `run.html?server=1&sendBuilt=1` frame, and POSTs
**cartridge PNG (cover + source backup) + BuiltSimJsInfo JSON (binary)** to `POST /api/lab/games`. The player is
`play.html` + `GET /api/lab/games/<id>/binary`. The **2 MB cap of §12a.6 is too tight for the raw JSON** (a tiny game
is already 1.77 MB, a normal one 2.4 MB): store it gzip-compressed (a tiny game = 264 KB) and apply the 2 MB cap to
the compressed size, or raise the raw cap to about 6 MB. Owner decision.

## 8. Recommendation

MakeCode Arcade passes the spike: offline (0 external requests), no service worker, Greek possible, play-only page
possible. **It does not fit inside games-hub as a submodule or through the hub catalog**, for size and model
reasons (§1) and because the simulator frame needs `'unsafe-eval'` (§2). Use the **§12a.3 fallback: its own static
path on VM 106, LAN/tailnet only**:

1. CI (GitHub-hosted, public repo) runs `build.sh` with pinned versions, the slim step and precompression
   (`.gz`/`.br`), and attaches `kids-code-lab-<version>.tar.gz` (about 16 MB) to the release.
2. Infra unpacks a release into a versioned static folder on VM 106 and serves `/kids-code-lab/` from it with a
   file server (precompressed, per-path headers: the three CSP blocks above, `X-Frame-Options: SAMEORIGIN`,
   `Cache-Control` long for hashed assets), **same origin as the hub** on the LAN/tailnet hostname so the
   `__Host-` unlock cookie, CSRF origin check and `GET /api/profiles` work unchanged for the publish dialog.
3. games-hub keeps what is its own: the landing card, the shelf page, the player page (`/kids-code-lab/play/<id>`
   can also be part of the static path; the hub only serves the game JSON), and the `/api/lab/*` routes (ADR) with
   the cap on the compressed binary. Nothing of the lab or `/api/lab/*` goes on the Funnel allowlist (§12a.5).
4. ADR in games-hub: the lab's per-path CSP with `'unsafe-eval'` only for `simulator.html`, and `/api/lab/*`.

Alternative that avoids INFRA (not recommended): a second, file-backed static mount inside games-hub with its own
suffix list, precompressed files and the per-path CSP. It works technically but changes three core hub rules
(in-memory catalog, suffix list, no `'unsafe-eval'`) and makes the hub process serve 6.4 MB per editor load.

Open points for the first work package: hide cloud UI (sign-in, share, GitHub, extensions, AI) by theme flags;
reduce `availableLocales` to en/el; Greek overrides for `game-strings`; e2e of asset editor / music / tutorials
under the CSP; drop hardware variants so the build needs no makecode.com; `sim.css` licence or own file.

## 9. INFRA needs (to be filed by chat-Claude with the owner's GO; not filed by this spike)

1. **Static path on VM 106**: a folder for versioned lab releases (about 80 MB unpacked per version, keep 2) and a
   way to switch the active version (symlink).
2. **Serving `/kids-code-lab/`** from that folder on the **same LAN/tailnet origin as the hub** (Caddy
   `file_server` with `precompressed gzip br`, path route before the reverse proxy to games-hub `:8090`), with the
   per-path response headers from §2 (CSP per page kind, `X-Frame-Options: SAMEORIGIN`, the hub's other security
   headers). If the prod hub has no LAN/tailnet hostname behind Caddy today (prod is reached through the Funnel,
   which proxies straight to `127.0.0.1:8090`), this needs **one new LAN/tailnet-only hostname** for the hub +
   lab on VM 106 (no new port beyond Caddy's 443).
3. **Not on the Funnel**: neither `/kids-code-lab/` nor `/api/lab/*` (Funnel stays games-only; §12a.5).
4. **Staging** equivalent: `games.staging.homelab.lan/kids-code-lab/` (spec §10), same Caddy route behind the
   existing Authelia.
5. **Backup**: `kids-code-lab.sqlite` in the hub backup set (spec §6, §12a.7); the static folder needs no backup
   (rebuilt from the release).
