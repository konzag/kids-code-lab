# BUILD: the offline MakeCode Arcade site of the code lab

How the lab's static site is built, what is changed in MakeCode and why, and how it is checked. The measurements
behind these choices are in [spike/SPIKE-REPORT.md](spike/SPIKE-REPORT.md) (spec §4).

## Build

Needs Node >= 20, git, tar and bash (Linux, or Git Bash on Windows). Nothing is installed globally; everything goes
into the build folder `WORK` (default `.build/`, git-ignored).

```
npm ci                                   # Playwright for the checks
WORK=.build bash makecode/build.sh       # about 3 minutes, plus the first npm install of pxt-arcade
```

Steps of [`makecode/build.sh`](../makecode/build.sh):

1. Shallow clone of `microsoft/pxt-arcade` at the pinned tag (`ARCADE_TAG`, default `v4.2.1`; that tag pins
   `pxt-core` 13.2.1 and `pxt-common-packages` 14.1.4 exactly), `npm install` inside the clone.
2. Simulator: the compiled simulator `built/sim.js` + `sim-strings.json` are copied from the npm package
   `pxt-arcade@<same version>` (MIT). Its source repo `microsoft/pxt-arcade-sim` is private, so it cannot be built.
   The frame page and stylesheet are **ours**: [`makecode/sim/simulator.html`](../makecode/sim/simulator.html) and
   [`makecode/sim/sim.css`](../makecode/sim/sim.css) (see [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)).
   Nothing is downloaded from the MakeCode CDN.
3. [`makecode/patch-target.mjs`](../makecode/patch-target.mjs) patches `pxtarget.json` / `targetconfig.json`.
4. [`makecode/fetch-locs.mjs`](../makecode/fetch-locs.mjs) downloads the approved Greek Crowdin translations from the
   public makecode.com API (build time only) and prints the coverage table (`$WORK/locs-el.tsv`).
5. `pxt staticpkg --route /kids-code-lab --locs-src ../locs --no-appcache`.
6. [`makecode/patch-output.mjs`](../makecode/patch-output.mjs) patches the output and copies the **slim** site
   (`$WORK/slim`, about 76 MB, 1 580 files); the play page is added (`slim/play/`);
   [`makecode/pack.mjs`](../makecode/pack.mjs) writes `.gz` and `.br` next to every text file (for a file server
   with precompressed support) and the release tarball `$WORK/kids-code-lab-<version>.tar.gz`.

Build-time network: GitHub (clone), the npm registry, makecode.com translations API. **No makecode.com cloud
compiler** any more (the hardware variants are removed, see below); CI fails if the build log shows a cloud compile.

## Patches and why

| Where | Change | Why |
|---|---|---|
| pxtarget `appTheme.availableLocales` | `["en", "el"]` | `el` is not in Arcade's list (the bundled Greek files would be ignored); only the two family languages in MakeCode's language menu |
| pxtarget `appTheme.defaultLocale` | `"el"` | Greek by default. Order in the editor: `?lang=` > MakeCode's `PXT_LANG` cookie (its language menu) > `defaultLocale`, so English chosen in the menu is remembered on the device |
| pxtarget `appTheme.disableLiveTranslations` | `true` | otherwise a non-English UI fetches `makecode.com/api/translations` (68 requests per load in the spike) |
| pxtarget `cloud.*` | `sharing, thumbnails, importing, packages, publishing, githubPackages, showBadges = false`, `cloudProviders = {}` | no share links, no cloud import, no Extensions category or extension search, no badges, no sign-in providers |
| pxtarget `appTheme` | `identity, githubEditor, qrCode, shareToKiosk, allowPackageExtensions, forceEnableAiErrorHelp, showOpenInVscode = false`, `hideShareEmbed = true` | no sign-in, no GitHub repos, no QR/kiosk sharing, no editor extensions, no AI error help, no "Open in VS Code" (vscode.dev) |
| pxtarget `appTheme.allowParentController` | removed (never set) | with it MakeCode switches to its "iframe" workspace and stores projects in the parent page (measured: the editor never opened). The lab drives the editor with hash commands instead |
| pxtarget `appTheme` | remove `githubUrl, feedbackUrl, logoUrl, organizationUrl, privacyUrl, termsOfUseUrl, ocvFrameUrl, homeScreenHero, homeScreenHeroGallery, socialOptions`; `docMenu = []` | no links out of the site (makecode.com, Microsoft terms/privacy, GitHub, forum), no hero carousel (its images had absolute `/static/` paths, 404) |
| targetconfig `galleries = {}`, `hardwareOptions = []`, `shareLinks.approved = []` | | the home page shows only "My Projects" + "New Project"; no hardware dialog |
| pxtarget hardware | remove `variants`, the `libs/hw---*` board packages and the hardware project templates `libs/d5prj, f4prj, rpiprj`; `compile.webUSB = false`, `checkForHwVariantWebUSB = false`, `preferWebUSBDownload = false` | spec §11 (no hardware flashing). The hardware hex cache was the only reason the build called the makecode.com cloud compiler (25 polls, 7 min); WebUSB probing caused a `usb` Permissions-Policy error under the hub headers |
| pxtarget `simulator.dynamicBoardDefinition` | `false` | the Download options menu showed «Επιλέξτε Υλικό» / "Choose Hardware" whenever it is set, opening an empty list (no hardware variants). Test first: the check failed on wp1 with `download menu: Επιλέξτε Υλικό \| Λήψη ως αρχείο` |
| output HTML | remove the `<!-- include apptracking.html -->` block; delete `ai.2.min.js` | Application Insights telemetry POSTed to `dc.services.visualstudio.com` on every load |
| output HTML `pxtConfig.cdnUrl` | `""` | `pxt.Cloud.initRegionAsync()` did `new URL("geo", "/kids-code-lab/")` and logged "Unable to determine region" (console error); with an empty `cdnUrl` it returns "unknown" silently. `cdnUrl` is otherwise only used for cloud docs and the hardware hex cache |
| output `locales/<lang>/sim-strings.json` | `{}` when missing | there are no approved Greek simulator strings; the simulator requested the file on every run (HTTP 404) |
| output `pxtsim.js`, `pxtembed.js`, `pxtapp.js` | simulator iframe `allow="autoplay;microphone"` -> `allow="autoplay"` | no microphone feature in the lab; under the hub's `Permissions-Policy: microphone=()` Chrome logged a policy violation on every run |
| output `pxtsim.js`, `pxtembed.js`, `pxtapp.js` | editor simulator frame `sandbox="allow-scripts"` (no `allow-same-origin`); driver posts to it with targetOrigin `*`; accepts origin `null` only from its own simulator frames (`ev.source`) | the child's compiled game runs with `'unsafe-eval'` in that frame; with an opaque origin it cannot reach the site's cookies, storage, parent page or `/api/*`. See "Player security". The build fails if the three code patterns are not found (pxt-core upgrade) |
| output files | delete `serviceworker.js`, `simulatorserviceworker.js`, `release.manifest` | GAME-STANDARD: no service worker, no offline cache. The static build never registers one (`isStatic`), the deletion makes sure nothing can |
| slim copy | keep editor, simulator, runner, locales, Blockly/Monaco assets, tutorials as markdown; drop the docs site media, skillmap, teacher tool, kiosk, multiplayer and the other sub-apps | 464 MB -> 76 MB |

## Languages

Greek is the default, English is in MakeCode's own language menu (settings ⚙ > language), and the lab page can force
one with `index.html?lang=el|en`. Greek coverage is partial (spike §6: about 48 % of the editor UI, 14 % of the
Arcade game blocks; `$WORK/locs-el.tsv` has the table of every build), so «Sprites», «Controller», «Scene» and most
game blocks stay in English.

## The lab's own pages

Copied by `build.sh` from [`makecode/lab/`](../makecode/lab/) to `/kids-code-lab/lab/` and from
[`makecode/player/`](../makecode/player/) to `/kids-code-lab/play/`. No inline script, no inline style, no build step
(ES modules). The hub card links to `/kids-code-lab/lab/`.

| File | What |
|---|---|
| `lab/core.js` | logic without DOM, unit-tested: settings + §5a `hub` object in `game.kids-code-lab.v1` (version, try/catch, migration, milestones `[a-z0-9-]` ≤ 32, ≤ 50, append-only, `completedAt` once), publish payload (title 1..40 and description ≤ 140 in code points, control/bidi characters removed, no HTML escaping: pages render with `textContent`), caps (cartridge ≤ 256 KB, binary ≤ 2 MB gzip via `CompressionStream`), Greek texts of every server answer, `?id=` parser, the «Μαθήματα» list |
| `lab/index.html`, `home.js` | «Αρχική του εργαστηρίου»: new game, MakeCode's local projects (read-only from its IndexedDB `__pxt_idb_workspace_arcade___default`), tutorials, games published from this device with «Απόσυρση» (`DELETE /api/lab/games/<id>`, header `X-Lab-Unpublish`) |
| `lab/edit.html`, `edit.js` | top bar («🏠 Πίσω», «Δημοσίευση στο hub») and the editor in a frame: `../index.html?editorlayout=ide&ws=browser#newproject` / `#header:<id>` / `#tutorial:/tutorials/<id>`. In a frame MakeCode would otherwise start in its read-only "sandbox" layout with an in-memory workspace (measured "workspace: mem", "Cannot edit in read-only editor"). The «Δημοσίευση» dialog: profiles from `GET /api/profiles` (401 = link to the hub «Προφίλ» page, never a PIN field), compile, cartridge, `POST /api/lab/games` |
| `lab/mc.js` | the MakeCode bridge: projects from IndexedDB (never creates or upgrades MakeCode's database), compile with the packaged runner (`run.html?sendBuilt=1` in a hidden frame, `data-code` = `main.ts`, `data-assets` = the other `.ts`/`.jres` files, `deps` from `pxt.json`), the `.png` cartridge made like MakeCode's Save button (lzma of the project encoded into the image with the editor frame's own `pxt.lzmaCompressAsync` / `pxt.Util.encodeBlobAsync`, so it can be imported back) on a cover drawn by the lab |
| `lab/lab.css`, `icon.svg` | Comfortaa from the hub (`/static/fonts/comfortaa.css`), text ≥ 18 px, light + dark (remembered switch, else `prefers-color-scheme`), workshop orange + chalkboard green |
| `play/index.html`, `play.js`, `play.css` | the player (see "Player security"), hub shell buttons ⏸ 🔊 ⛶ 🏠. ⏸ stops the game and ▶ starts it again from the beginning: the MakeCode simulator has no external pause (its debugger pause needs a debug build; the Arcade "TogglePause" key only flips an unused flag; tested) |

**API contract** (games-hub ADR-0006 and the contract of 2026-11-03, faked in
[`tests/e2e/fake-hub.mjs`](../tests/e2e/fake-hub.mjs) with Playwright routes, no port):
`POST /api/lab/games` JSON `{title, description, profile, cartridge (base64 PNG), binary (base64 of the gzipped game
JSON)}` → 201 `{id, unpublish_token}`; 401 / 403 / 409 / 413 / 415 / 422 / 429 (+`Retry-After`) / 503 are shown in
Greek. The `unpublish_token` is kept per game id in `game.kids-code-lab.v1` and sent only in the
`X-Lab-Unpublish` header (never in a URL, a log or the console; the e2e test checks the request URLs and the console).
`GET /api/lab/games/<id>/binary` = the gzip bytes with `Content-Encoding: gzip` (the browser decodes them; the fake
returns the decoded JSON because Playwright's `route.fulfill` does not decode).

## Checks

[`playwright.config.mjs`](../playwright.config.mjs) serves the slim site with
[`makecode/serve.mjs`](../makecode/serve.mjs) on `127.0.0.1` only and runs Chromium. Every request of the page, its
frames and workers is recorded; anything not on 127.0.0.1 is aborted and fails the test.

| Spec | Checks |
|---|---|
| [`tests/e2e/editor.spec.mjs`](../tests/e2e/editor.spec.mjs) | new project, JavaScript -> blocks, the simulator runs it (pixel check) in a frame with `sandbox="allow-scripts"` where cookies, storage, the parent page and `/api/profiles` are blocked, the `.png` cartridge downloads; 0 external requests, 0 service workers (with service workers allowed), 0 CSP violations, 0 console errors. No cloud UI: no sign-in, no share, no GitHub button, no Extensions category or menu entry, no AI error help, home page with "My Projects" only and no links out of the site. Languages: Greek by default, exactly en + el in the language menu, English chosen there is remembered after reload, `?lang=el` forces Greek |
| [`tests/e2e/play.spec.mjs`](../tests/e2e/play.spec.mjs) | compiles a program with the packaged runner (`run.html?code=...&sendBuilt=1`), then `play.html?id=1` (the test answers `/api/lab/games/1/binary`) runs it without the editor at 1280x800 (keyboard), 820x1180 and 1180x820 (on-screen d-pad moves the sprite); the frame is `sandbox="allow-scripts"` and inside it `document.cookie`, `localStorage`, `window.parent.document` and `fetch('/api/profiles')` all fail; no editor/compiler files loaded, 0 external, 0 CSP violations, 0 console errors. Refusals: `?src=...`, `?id=../x`, `?id=1x`, an absolute URL, 10 digits, an extra parameter and no parameter fetch nothing, create no frame and show «Αυτό το παιχνίδι δεν υπάρχει...» |

| [`tests/e2e/lab.spec.mjs`](../tests/e2e/lab.spec.mjs) | lab home at 1280 / 820x1180 / 1180x820 / 360 in light and dark (Greek, `lang="el"`, sections, text ≥ 18 px, no horizontal scroll, axe 0 serious/critical), remembered theme switch, editor bar and framed editor, 360 px note, the publish flow against the fake hub (binary gzip-JSON + PNG cartridge received, 201, token kept and never in a URL or the console, `completed`/`completedAt`/milestones, the published game plays sandboxed, shell buttons, «Απόσυρση» with the token), every error answer in Greek, no session = link to «Προφίλ» and no PIN field, client-side 2 MB gzip cap; 0 external, 0 CSP violations, 0 console errors |
| [`tests/unit/core.test.mjs`](../tests/unit/core.test.mjs) | `node --test`: KCL-U01..U12 (settings load/save with bad JSON, missing `hub`, old version, broken storage; milestone rules; `completedAt` once; payload caps and cleaning; gzip cap; Greek answers; `?id=` parser). Red against an empty module (`KCL_CORE=<empty module>`: 12 of 12 fail) |

Environment of the checks: `PKG` (site folder), `CSP=none|strict|editor|play|adr` (`adr` = games-hub ADR-0006 per page kind: editor, simulator frame, player, lab pages; blocks in
[`makecode/csp.mjs`](../makecode/csp.mjs); `EDITOR_TIGHT=1` = the recommended editor pair), `SW=block` (default: service workers allowed, so "0 registered" is meaningful; Playwright's block mode also throws a console error inside sandboxed frames),
`HUB_HEADERS=1` (the games-hub security headers incl. `X-Frame-Options: DENY` and `Permissions-Policy`).

```
npx playwright test tests/e2e/editor.spec.mjs
CSP=editor EDITOR_TIGHT=1 HUB_HEADERS=1 npx playwright test tests/e2e/editor.spec.mjs
CSP=play HUB_HEADERS=1 npx playwright test tests/e2e/play.spec.mjs
CSP=strict npx playwright test tests/e2e/play.spec.mjs --grep desktop   # must FAIL: the game needs 'unsafe-eval'
```

## CI

[`.github/workflows/build.yml`](../.github/workflows/build.yml): GitHub-hosted `ubuntu-24.04`, actions pinned by
commit SHA, `permissions: contents: read`, no secrets. Job `build`: the build, the "no cloud compiler" check, the
unit tests, the editor checks without a CSP, every Playwright spec under `CSP=adr HUB_HEADERS=1` (the ADR-0006 headers incl. `X-Frame-Options: SAMEORIGIN` and CORP), the strict-CSP negative check, then the tarball as the artifact `kids-code-lab`
and the check results (`test-results/*.json`, build log, Greek coverage table) as `check-results`. Job `release`
(only for `v*` tags, `permissions: contents: write` in that job only): attaches the tarball to the GitHub release.

## Player security

A published game is compiled JavaScript made by a child in the editor. The hub trusts it only as "a game the family
published", never as code that may act for the family. Therefore:


- **Only `?id=<1-9 digits>`.** [`makecode/player/play.js`](../makecode/player/play.js) accepts exactly one query
  parameter, `id`, matching `^[0-9]{1,9}$`, and builds the URL itself: `/api/lab/games/<id>/binary`. There is no
  `src` parameter, no path and no absolute URL; anything else shows a Greek message and fetches nothing.
- **Sandboxed simulator frame.** Player and editor run the game in `<iframe sandbox="allow-scripts">` without
  `allow-same-origin`: the frame has an opaque origin (`null`), so the game's code (which runs with `'unsafe-eval'`
  in that frame) cannot read the site's cookies (the `__Host-` unlock session) or localStorage, cannot touch the
  parent page, and its `fetch` to `/api/*` is cross-origin without cookies (and blocked by the frame's
  `connect-src 'none'`). The play page loads no MakeCode script of its own: it talks to the frame only by
  `postMessage`, ignores messages whose `event.source` is not its frame, and handles only `ready` and the restart
  command, with shape checks. The editor's simulator works sandboxed too (patch in "Patches and why"); measured in
  both specs: `document.cookie`, `localStorage`, `window.parent.document` throw `SecurityError`, `fetch('/api/profiles')`
  fails, and the game still runs (pixel check, keys, on-screen d-pad).
- **Headers this needs on the lab paths:** the frame's own files (`simulator.html`, `pxtsim.js`, `sim.js`, `sim.css`)
  are loaded by an opaque origin, i.e. cross-origin, so the hub's `Cross-Origin-Resource-Policy: same-origin` blocks
  them (`net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`, measured). These four public static files need
  `Cross-Origin-Resource-Policy: cross-origin` (`makecode/serve.mjs --hub-headers` does exactly that); all other lab
  files keep `same-origin`.
- **Server side (games-hub ADR-0006, `/api/lab/*`):** the binary is trusted only as "a game the family published".
  At publish time the hub checks its size (2 MB gzip cap, spec §12a.6), its JSON shape (`js` string, `fnArgs` object,
  `parts` / `usedBuiltinParts` arrays) and stores its sha256; it serves it as `application/json` with `nosniff`.
  Compiling games on the server is out of scope.

## Known limits

- The simulator is used as compiled by Microsoft (`sim.js` from npm); a MakeCode upgrade = new `ARCADE_TAG`, a new
  build and the checks; the simulator page's ids/classes must still match what `sim.js` looks up, and the sandbox
  patch must still find its three code patterns (the build stops otherwise).
- The tarball is about 43 MB because it carries the `.gz` and `.br` files next to the originals (16 MB without them).
- MakeCode's own home page is kept (My Projects, New Project, Import from file); the lab's pages come in the next work
  package. The Download button's menu still shows a "Choose hardware" entry (it opens an empty hardware list); the
  child's backup is the save button (the `.png` cartridge).
- The play page and the simulator frame work under the hub CSP blocks of `makecode/csp.mjs` (play mode), with the
  CORP exception above.
