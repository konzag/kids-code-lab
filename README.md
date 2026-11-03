# kids-code-lab: «Εργαστήρι Κώδικα»

The family's kids make their own small arcade games with blocks (MakeCode Arcade, built as a static offline site),
play them on the PC or tablet and, with a parent's family code, publish a finished game to a shelf in «Τα Παιχνίδια
μας» (games-hub). No accounts, no cloud, nothing leaves the house.

**Status: work package 1 of L1-27 (build, no deploy yet).** The approved spec is
[docs/specs/KIDS-CODE-LAB.md](docs/specs/KIDS-CODE-LAB.md). The spike of spec §4 is done
([docs/spike/SPIKE-REPORT.md](docs/spike/SPIKE-REPORT.md)): MakeCode Arcade runs fully offline from a static folder and
gets its own static path on VM 106 (spec §12a.3), not a games-hub submodule.

Done in work package 1:
- reproducible offline build of MakeCode Arcade with our own simulator page and stylesheet, Greek by default with
  English selectable, the cloud UI (sign-in, share, GitHub, extensions, AI help) and the hardware variants removed,
  no telemetry, no service worker ([docs/BUILD.md](docs/BUILD.md));
- a small play-only page for published games (`makecode/player/`);
- CI on GitHub-hosted runners: build, Playwright checks (0 requests outside the site, no service worker, editor and
  simulator work, play page on desktop and tablet, the CSPs for the hub ADR), the release tarball as an artifact and,
  on a `v*` tag, on the GitHub release.

Not yet: the lab pages (home, publish dialog), the hub shelf and `/api/lab/*` (games-hub ADR), the deploy (infra
request), the README sections of GAME-STANDARD v1.3 §2a (test list `KCL-01..`).

Third-party code and licences: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
