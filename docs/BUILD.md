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
| pxtarget `appTheme` | `identity, githubEditor, qrCode, shareToKiosk, allowPackageExtensions, forceEnableAiErrorHelp = false`, `hideShareEmbed = true` | no sign-in, no GitHub repos, no QR/kiosk sharing, no editor extensions, no AI error help |
| pxtarget `appTheme` | remove `githubUrl, feedbackUrl, logoUrl, organizationUrl, privacyUrl, termsOfUseUrl, ocvFrameUrl, homeScreenHero, homeScreenHeroGallery, socialOptions`; `docMenu = []` | no links out of the site (makecode.com, Microsoft terms/privacy, GitHub, forum), no hero carousel (its images had absolute `/static/` paths, 404) |
| targetconfig `galleries = {}`, `hardwareOptions = []`, `shareLinks.approved = []` | | the home page shows only "My Projects" + "New Project"; no hardware dialog |
| pxtarget hardware | remove `variants`, the `libs/hw---*` board packages and the hardware project templates `libs/d5prj, f4prj, rpiprj`; `compile.webUSB = false`, `checkForHwVariantWebUSB = false`, `preferWebUSBDownload = false` | spec §11 (no hardware flashing). The hardware hex cache was the only reason the build called the makecode.com cloud compiler (25 polls, 7 min); WebUSB probing caused a `usb` Permissions-Policy error under the hub headers |
| output HTML | remove the `<!-- include apptracking.html -->` block; delete `ai.2.min.js` | Application Insights telemetry POSTed to `dc.services.visualstudio.com` on every load |
| output HTML `pxtConfig.cdnUrl` | `""` | `pxt.Cloud.initRegionAsync()` did `new URL("geo", "/kids-code-lab/")` and logged "Unable to determine region" (console error); with an empty `cdnUrl` it returns "unknown" silently. `cdnUrl` is otherwise only used for cloud docs and the hardware hex cache |
| output `locales/<lang>/sim-strings.json` | `{}` when missing | there are no approved Greek simulator strings; the simulator requested the file on every run (HTTP 404) |
| output `pxtsim.js`, `pxtembed.js`, `pxtapp.js` | simulator iframe `allow="autoplay;microphone"` -> `allow="autoplay"` | no microphone feature in the lab; under the hub's `Permissions-Policy: microphone=()` Chrome logged a policy violation on every run |
| output files | delete `serviceworker.js`, `simulatorserviceworker.js`, `release.manifest` | GAME-STANDARD: no service worker, no offline cache. The static build never registers one (`isStatic`), the deletion makes sure nothing can |
| slim copy | keep editor, simulator, runner, locales, Blockly/Monaco assets, tutorials as markdown; drop the docs site media, skillmap, teacher tool, kiosk, multiplayer and the other sub-apps | 464 MB -> 76 MB |

## Languages

Greek is the default, English is in MakeCode's own language menu (settings ⚙ > language), and the lab page can force
one with `index.html?lang=el|en`. Greek coverage is partial (spike §6: about 48 % of the editor UI, 14 % of the
Arcade game blocks; `$WORK/locs-el.tsv` has the table of every build), so «Sprites», «Controller», «Scene» and most
game blocks stay in English.

## Checks

[`playwright.config.mjs`](../playwright.config.mjs) serves the slim site with
[`makecode/serve.mjs`](../makecode/serve.mjs) on `127.0.0.1` only and runs Chromium. Every request of the page, its
frames and workers is recorded; anything not on 127.0.0.1 is aborted and fails the test.

| Spec | Checks |
|---|---|
| [`tests/e2e/editor.spec.mjs`](../tests/e2e/editor.spec.mjs) | new project, JavaScript -> blocks, the simulator runs it (pixel check), the `.png` cartridge downloads; 0 external requests, 0 service workers (with service workers allowed), 0 CSP violations, 0 console errors. No cloud UI: no sign-in, no share, no GitHub button, no Extensions category or menu entry, no AI error help, home page with "My Projects" only and no links out of the site. Languages: Greek by default, exactly en + el in the language menu, English chosen there is remembered after reload, `?lang=el` forces Greek |
| [`tests/e2e/play.spec.mjs`](../tests/e2e/play.spec.mjs) | compiles a program with the packaged runner (`run.html?code=...&sendBuilt=1`), then the play page runs it without the editor at 1280x800 (keyboard), 820x1180 and 1180x820 (on-screen d-pad moves the sprite); no editor/compiler files loaded, 0 external, 0 CSP violations, 0 console errors |

Environment of the checks: `PKG` (site folder), `CSP=none|strict|editor|play` (CSP blocks in
[`makecode/csp.mjs`](../makecode/csp.mjs); `EDITOR_TIGHT=1` = the recommended editor pair), `SW=allow`,
`HUB_HEADERS=1` (the games-hub security headers incl. `X-Frame-Options: DENY` and `Permissions-Policy`).

```
SW=allow npx playwright test tests/e2e/editor.spec.mjs
CSP=editor EDITOR_TIGHT=1 HUB_HEADERS=1 npx playwright test tests/e2e/editor.spec.mjs
CSP=play HUB_HEADERS=1 npx playwright test tests/e2e/play.spec.mjs
CSP=strict npx playwright test tests/e2e/play.spec.mjs --grep desktop   # must FAIL: the game needs 'unsafe-eval'
```

## CI

[`.github/workflows/build.yml`](../.github/workflows/build.yml): GitHub-hosted `ubuntu-24.04`, actions pinned by
commit SHA, `permissions: contents: read`, no secrets. Job `build`: the build, the "no cloud compiler" check, the
three Playwright runs above plus the strict-CSP negative check, then the tarball as the artifact `kids-code-lab`
and the check results (`test-results/*.json`, build log, Greek coverage table) as `check-results`. Job `release`
(only for `v*` tags, `permissions: contents: write` in that job only): attaches the tarball to the GitHub release.

## Known limits

- The simulator is used as compiled by Microsoft (`sim.js` from npm); a MakeCode upgrade = new `ARCADE_TAG`, a new
  build and the checks; the simulator page's ids/classes must still match what `sim.js` looks up.
- The tarball is about 43 MB because it carries the `.gz` and `.br` files next to the originals (16 MB without them).
- MakeCode's own home page is kept (My Projects, New Project, Import from file); the lab's pages come in the next work
  package.
