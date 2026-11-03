#!/usr/bin/env bash
# KIDS-CODE-LAB spike (L1-27): the Playwright checks behind SPIKE-REPORT.md, in the order they were run.
# Needs build.sh first. Chromium only; servers bind 127.0.0.1. Results: test-results/*-requests.json (not committed).
set -euo pipefail
cd "$(dirname "$0")"
WORK="${WORK:-D:/Git/.worktrees/kcl-spike-build}"
npm ci --no-audit --no-fund
npx playwright install chromium

# §3 + §4 + §6: slim editor, Greek, no CSP header, service workers ALLOWED in the browser -> 0 external, 0 SW
PKG="$WORK/slim" CSP=none SW=allow QS="?lang=el" npx playwright test editor
# §2: editor with the recommended CSP pair (editor page hub-like, simulator frame + 'unsafe-eval')
PKG="$WORK/slim" CSP=editor EDITOR_TIGHT=1 QS="?lang=el" npx playwright test editor
# §2: same with the games-hub security headers (X-Frame-Options DENY etc.)
PKG="$WORK/slim" CSP=editor EDITOR_TIGHT=1 HUB_HEADERS=1 QS="?lang=el" npx playwright test editor
# §7: play-only page with the play CSP
PKG="$WORK/slim" CSP=play npx playwright test play
# §2 negative check: the hub-like CSP everywhere (no 'unsafe-eval' in the simulator) must FAIL (game never runs)
if PKG="$WORK/slim" CSP=strict npx playwright test play; then echo "UNEXPECTED: strict CSP passed"; exit 1; fi
echo "all spike checks done"
