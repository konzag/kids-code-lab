# SPEC KIDS-CODE-LAB: «Εργαστήρι Κώδικα», the kids make their own games with MakeCode Arcade

Status: APPROVED by the owner 02/11 20:11 (all 9 answers in §12a). Queue item L1-27, IN PROGRESS since 2026-11-03,
written by W1 (Claude Code) on Mon 2026-11-02. Binding: GAME-STANDARD v1.3 §1, §3, §3a, §4, §5, §5a, §6, §7, §9;
TEST-STANDARD v1 (template-app `docs/TEST-STANDARD.md`); games-hub ADR-0001 (public, auth-less hub, per-page CSP).

## 1. Existing material (checked 2026-11-02)
- `konzag/kids-code-lab` existed, private and **empty** (no commit). Dependabot alerts on (L1-02).
- Owner answer 29/10: «KIDS-CODE-LAB: MakeCode Arcade, self-hosted, publish behind family PIN». The repo was made
  private then; superseded 02/11 by §12a.1 (public).
- Owner brief 29/10: «Scratch or MakeCode Arcade (open source, self-hosted, no accounts). Default: MakeCode Arcade;
  publish to the hub behind the family PIN».
- No earlier spec, draft or handoff section.
- Context that matters: GAME-STANDARD §9: the old four games (ariana, napoleon, konstantinos, cybele) are the kids'
  first programming projects; this lab is the next step for them. They are never rewritten.

## 2. Purpose
A place in «Τα Παιχνίδια μας» where the children build small arcade games with blocks (and later JavaScript/Python
in the same editor), play them on the PC or tablet, and, with a parent's family code, **publish** a finished game to
a «Τα παιχνίδια μας που φτιάξαμε» shelf in the hub, where the whole family can play it. No accounts, no cloud, nothing
leaves the house.

## 3. Users
- The family's kids (the players of the hub games: Αριάνα, Ναπολέων and their siblings; reading age from about 7).
  Blocks first; a child who reads well can switch to JavaScript or Python inside MakeCode.
- A parent (the owner): unlocks publishing with the family code (the hub's existing `POST /api/unlock`), removes a
  published game. Claude never asks for, stores or prints the code.
- Everyone in the family: plays published games from the hub (no code needed to play).

## 4. What MakeCode Arcade gives and what has to be checked first (spike, before any build)
MakeCode Arcade (`microsoft/pxt-arcade` + `microsoft/pxt`, MIT) can be built as a **static offline site**
(`pxt staticpkg`). Projects live in the browser (IndexedDB) of the device; no login. Unknowns that decide the design,
to be answered by a one-day spike on a branch (report, no deploy):
1. Size of the static build (expected hundreds of MB with the simulator, sounds and the blocks library) and whether
   it can be served by games-hub as a submodule or needs its own static folder on VM 106.
2. CSP: the editor uses web workers, iframes for the simulator and, very likely, `eval` / `new Function` for the
   compiled game. The hub CSP (GAME-STANDARD §4: no eval, one `<script>`) cannot hold. Plan: the lab gets its own
   per-path CSP in the hub (ADR in games-hub), the published-game player page the narrowest CSP that still runs.
3. Service worker: MakeCode registers one for offline use. GAME-STANDARD rule «no service worker / no offline»
   (GAMES-OFFLINE dropped 29/10 item 12): the static build must run with the service worker disabled.
4. External calls: the offline build must make **zero** calls to makecode.com, the Microsoft CDN, telemetry or
   cloud share. Checked by a Playwright test that fails on any request outside the hub origin.
5. Fonts: MakeCode ships its own UI fonts; any Google Fonts link is removed in the build (self-hosted only).
6. Greek: MakeCode has a Greek (el) UI translation from Crowdin; check its completeness in Arcade. Default language
   el, English fallback.
7. Export format: a project downloads as a `.png` cartridge (project embedded in the image) or as `.mkcd`; the
   published player needs the compiled binary JS. Check which artefact a static «play only» page can load without
   the editor (`--embed` player or the editor in `#sandbox` play mode).
If the spike shows the CSP or the size cannot be made to fit the hub, the fallback is its own small static service
(see §10, question 3). Scratch (TurboWarp packager) is the alternative the owner named first; only if MakeCode fails.

## 5. Screens (Greek UI)
1. **Hub card** «Εργαστήρι Κώδικα» (own icon: a joystick made of blocks; own colour world, not the generic look):
   «Φτιάξε το δικό σου παιχνίδι». Opens `/kids-code-lab/`.
2. **Αρχική του εργαστηρίου**: «Νέο παιχνίδι», «Τα παιχνίδια μου» (the projects stored on this device), «Μαθήματα»
   (a short list of the MakeCode tutorials that ship in the offline build, el where translated), «🏠 Πίσω στα
   παιχνίδια». Light + dark switch.
3. **Επεξεργαστής**: the MakeCode Arcade editor itself (blocks / JavaScript / Python, simulator on the left).
   MakeCode's own UI; the lab only adds a top bar with «🏠 Πίσω» and «Δημοσίευση στο hub».
4. **Δημοσίευση** (dialog): game title (max 40 characters, no names of people suggested by the placeholder), the
   creator's profile (existing hub profiles, `GET /api/profiles`, profile name only), a short description (max 140),
   preview of the cover image (the cartridge). «Δημοσίευση» needs the hub unlock (existing «Προφίλ» unlock form and
   limiter; the lab never shows its own PIN field). Result: «Το παιχνίδι μπήκε στο ράφι του hub».
5. **Ράφι στο hub** «Παιχνίδια που φτιάξαμε»: cards of the published games (title, creator profile, date), «Παίξε».
   Parent view after unlock: «Αφαίρεση» per card (confirm dialog).
6. **Player** `/kids-code-lab/play/<id>`: the game in full screen with the hub shell buttons (⏸, 🔊, ⛶, 🏠). Keyboard
   and touch from MakeCode's own controller (on-screen pad on touch).

## 6. Data and storage
- **Projects being edited**: in the device browser (MakeCode IndexedDB, MakeCode's own keys). The lab does not copy
  them. A «Λήψη αρχείου» button (MakeCode's download) is the backup; the README says that clearing the browser
  deletes unpublished projects.
- **Lab settings** (theme, last tutorial): localStorage `game.kids-code-lab.v1`, JSON with `version`, in try/catch,
  plus the GAME-STANDARD v1.3 §5a object (below). Key and origin stay fixed.
- **Hub progress object** (§5a), only these fields:
  `{"hub": {"schema": 1, "completed": <bool>, "completedAt": "YYYY-MM-DD" | absent, "milestones": [...]}}`.
  «Completion» for a game without an end (README states it): the child **published the first game**.
  Milestones (README «Badges» table): `first-project` (first project saved), `tutorial-1` .. `tutorial-5` (finished
  built-in tutorials, if the editor reports it; else dropped), `first-publish`, `publish-5`. Only `[a-z0-9-]`, max 32
  characters, max 50, append-only. No names, no play time, no free text.
- **Published games**: server side, under the hub's level-B save API style, one SQLite of its own
  (`kids-code-lab.sqlite`), table `published(id, title, description, profile, created_at, cartridge BLOB,
  binary BLOB, sha256)`. Size cap per game (proposal 2 MB, question 6), max 100 games. Title/description are the only
  free text, length-capped, shown escaped; a parent can remove a game. New hub routes (games-hub ADR needed):
  `GET /api/lab/games` (public list, no cookie), `GET /api/lab/games/<id>/binary` (public),
  `POST /api/lab/games` and `DELETE /api/lab/games/<id>` (both need the `__Host-` unlock cookie, CSRF, rate limit,
  401 without unlock, 413 above the cap, 503 when the save API is off). No PIN in any body, log or URL.
- Backups: the hub SQLite files are already in the hub backup (check with infra, question 7).

## 7. Hub integration (GAME-STANDARD v1.3)
- Lives at `/kids-code-lab/` of games-hub (§1), as a git submodule pinned to a SHA (§2) **or** as a static build
  artefact copied in by the hub deploy (decided by the spike, §4.1). Hub card with «Συνέχεια» when the lab key exists.
- Badges from `game.kids-code-lab.v1` `hub` only (§5a); the lab never calls the hub for badges.
- Publish uses the existing unlock cookie and limiter; profiles through `GET /api/profiles`.
- The published shelf is a hub page (`/kids-code-lab/shelf/` or a section on the landing; question 4).
- Public reach: the hub is reachable through Tailscale Funnel without login (§1). Published games become public
  with it. Question 5 asks whether the shelf and player stay tailnet/LAN only.

## 8. UI rule
- Sizes: 1280 desktop; 820x1180 and 1180x820 touch; 360 phone (editor at 360: shows «Το εργαστήρι θέλει tablet ή
  υπολογιστή» with a «Παίξε» shelf still usable; the player works at 360).
- Light + dark on the lab's own pages and the shelf (prefers-color-scheme + remembered switch); the MakeCode editor
  keeps its own theme (high-contrast mode available inside it).
- WCAG AA on every page the lab owns (axe 0 serious/critical); MakeCode's own editor is measured and its findings
  listed in the README «Γνωστοί περιορισμοί», not patched upstream.
- Fonts self-hosted only (Comfortaa from the hub for the lab pages; MakeCode's bundled fonts inside the editor).
- Own identity: block-joystick icon, its own colour world (warm workshop orange + chalkboard green), no purple-blue
  gradient, no emoji headings, no em dashes or buzzwords in UI copy. Greek copy, `lang="el"`, text >= 18 px.

## 9. Tests (TEST-STANDARD v1, written first, shown red on broken code)
- Unit: lab settings load/save (bad JSON, missing `hub`, old version), milestone id validation, `completedAt`
  written once, publish payload builder (caps, escaping).
- API (games-hub, pytest): `POST /api/lab/games` 401 without unlock, 403 without CSRF, 429 above the limit, 413 above
  the cap, 415 for a non-cartridge, 503 with the save API off; list/binary public; DELETE needs unlock; no PIN or
  cookie value in any log line; DB round trip.
- e2e (Playwright, Chromium + the matrix): the lab opens with 0 console errors and **0 requests outside the hub
  origin**; no service worker registered; a fixture project compiles in the simulator; publish flow with a fake unlock
  on a throw-away SQLite; the shelf shows the card; the player runs 10 s with keys and with touch; 1280 / 820x1180 /
  1180x820 / 360, light + dark, axe on the lab pages; CSP of the lab paths served with 0 violations.
- README test list `KCL-01..` (GAME-STANDARD §2a) and acceptance rows in homelab-acceptance (catalog).
- Coverage floors of games-hub never lowered; the lab repo starts with its own floor from the first green run.

## 10. Hosting and CI
- Repo `konzag/kids-code-lab`. GAME-STANDARD and the List 1 rules say game repos are **public** with
  **GitHub-hosted runners** only; the owner made this repo **private** on 29/10 (item 14). A private repo runs CI
  on the homelab runner (4 slots) and cannot be a hub submodule fetched without a deploy key. Question 1 decides.
- Build: the MakeCode static build runs in CI (Node, pinned pxt versions, `npm ci`), the artefact is attached to the
  release; no build on the hub VM.
- The hub serves the lab under its own CSP block (games-hub ADR); the published-game API is part of games-hub.
- Staging first (games.staging.homelab.lan/kids-code-lab/), family test on a tablet, owner approval, then main.

## 11. Non-goals
- No accounts, no cloud share links, no makecode.com, no telemetry, no hardware (micro:bit, Meowbit) flashing.
- No multiplayer, no chat, no comments or likes on published games.
- No editing of the old four games; no import of their code.
- No offline/service worker (GAME-STANDARD rule), no Scratch unless MakeCode fails the spike.
- No personal data: profile names only, no photos, no real names in titles (README guidance for the parent).

## 12. Questions for the owner
1. Repo visibility: GAME-STANDARD says game repos are public with GitHub-hosted runners; you made kids-code-lab
   private on 29/10. Keep it private (homelab runner, hub needs a deploy key for the submodule) or make it public?
2. Who uses it first and from which age (blocks only, or also JavaScript/Python for the older child)?
3. If MakeCode's size or CSP does not fit inside games-hub: is a separate static path or a separate small service
   on VM 106 acceptable (one more hostname/port for infra)?
4. Where does the shelf of published games live: a section on the hub landing or its own page?
5. Published games: public through the Funnel like the other games, or LAN/tailnet only?
6. Size cap per published game (proposal 2 MB) and max games (proposal 100). Can a child unpublish their own game
   without the parent, or only the parent?
7. Should published games be in the backup (hub SQLite), or are they disposable?
8. Is the Greek MakeCode translation good enough, or do you want English UI inside the editor?
9. Badge for «completion»: is «first published game» right?

## 12a. Owner answers (02/11 20:11, all approved) — binding
1. Public repo per GAME-STANDARD (GitHub-hosted runners, no deploy key). Visibility switches when the build starts,
   after gitleaks shows the repo clean.
2. Both children (Αριάνα, Ναπολέων), blocks only at first; JavaScript for Αριάνα later.
3. If MakeCode does not fit games-hub (size or CSP): separate static path or a small service on VM 106, LAN/tailnet
   only. Any new hostname/port or Caddy change = INFRA-REQUEST to chat-Claude (needs the owner's GO).
4. Published games on their own page, with a card on the hub landing.
5. LAN/tailnet only, no Funnel.
6. Max 2 MB per game, max 100 games. A child can unpublish only their own game; only the parent deletes.
7. Yes, in the backup (hub SQLite).
8. Greek, with an English option.
9. Badge: «πρώτο δημοσιευμένο παιχνίδι».
