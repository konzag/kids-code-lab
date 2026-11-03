#!/usr/bin/env bash
# KIDS-CODE-LAB spike (L1-27): reproducible static/offline build of MakeCode Arcade.
# Runs in Git Bash (Windows) or Linux with Node >= 20 and git. Everything stays under $WORK; nothing global.
# Usage: WORK=/d/Git/.worktrees/kcl-spike-build bash build.sh
# Output: $WORK/pxt-arcade/built/packaged/kids-code-lab/  (served at /kids-code-lab/)
set -euo pipefail

WORK="${WORK:?set WORK to the build folder (outside the repo)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ARCADE_TAG="${ARCADE_TAG:-v4.2.1}"          # microsoft/pxt-arcade tag; pins pxt-core 13.2.1, pxt-common-packages 14.1.4
ROUTE="${ROUTE:-/kids-code-lab}"
LANGS="${LANGS:-el}"
# sim.css of the hosted Arcade simulator (not in the public repo nor the npm package), pinned by hash
SIM_CSS_URL="https://cdn.makecode.com/blob/24326aca0059a26d983a6c1d026ec1ae0aadfe3a/sim.css"
SIM_CSS_SHA256="ce974478870c8c4e7d6a227bf94f19d34707e9a6e1a485a917007cb450ae598b"

mkdir -p "$WORK" && cd "$WORK"

# 1. sources
[ -d pxt-arcade ] || git clone -q --depth 1 --branch "$ARCADE_TAG" https://github.com/microsoft/pxt-arcade.git
cd pxt-arcade
# optional dependency pxt-arcade-sim (github:microsoft/pxt-arcade-sim) is a PRIVATE repo: npm skips it silently
npm install --no-audit --no-fund

# 2. simulator: the compiled sim (built/sim.js, sim-strings.json) is only in the npm package pxt-arcade@<same version>
VER="${ARCADE_TAG#v}"
mkdir -p "$WORK/npmpkg" && (cd "$WORK/npmpkg" && [ -f "pxt-arcade-$VER.tgz" ] || npm pack "pxt-arcade@$VER" --silent)
tar -xzf "$WORK/npmpkg/pxt-arcade-$VER.tgz" -C "$WORK/npmpkg"
mkdir -p built sim/public public          # public/: empty, pxt-core scans <simDir>/public and simDir is "" here
cp "$WORK/npmpkg/package/built/sim.js" "$WORK/npmpkg/package/built/sim-strings.json" built/
cp "$HERE/sim/simulator.html" "$HERE/sim/sim-shell.css" sim/public/
[ -f sim/public/sim.css ] || curl -fsSL -o sim/public/sim.css "$SIM_CSS_URL"
echo "$SIM_CSS_SHA256  sim/public/sim.css" | sha256sum -c -

# 3. target patches (offline / Greek). Keep this list short and documented in SPIKE-REPORT.md §4.
node "$HERE/patch-target.mjs" pxtarget.json "$LANGS"

# 4. translations from the public makecode.com API (build time only), bundled with --locs-src
rm -rf "$WORK/locs"
for l in $LANGS; do node "$HERE/fetch-locs.mjs" . "$WORK/locs" "$l" de | tee "$WORK/locs-$l.tsv"; done

# 5. package. NOTE: pxt builds the hardware hex cache (stm32/samd/nrf52/rp2040) through the makecode.com cloud
#    compiler (build time only, ~7 min the first time, cached in built/hexcache afterwards).
# MSYS_NO_PATHCONV: Git Bash would rewrite the route "/kids-code-lab" into a Windows path (C:/Program Files/Git/...);
# the relative --locs-src avoids the same problem in the other direction.
MSYS_NO_PATHCONV=1 node node_modules/pxt-core/built/pxt.js staticpkg --route "$ROUTE" --locs-src ../locs --no-appcache

# 6. post-package patches on the output (see SPIKE-REPORT.md §3 and §4)
OUT="built/packaged${ROUTE}"
node "$HERE/patch-output.mjs" "$OUT" --slim "../slim"   # ../slim = $WORK/pxt-arcade/../slim
# 7. play-only page prototype (SPIKE-REPORT.md §7) next to the slim editor
mkdir -p ../slim/play && cp "$HERE"/player/play.* ../slim/play/
echo "packaged into $(pwd)/$OUT"
du -sh "$OUT" ../slim
