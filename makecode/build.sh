#!/usr/bin/env bash
# KIDS-CODE-LAB: reproducible static/offline build of MakeCode Arcade (docs/BUILD.md).
# Runs in Linux (CI) or Git Bash (Windows) with Node >= 20, git, tar. Nothing global is installed.
# Usage: WORK=<build folder outside the repo> bash makecode/build.sh
# Output: $WORK/slim/                         the lab's static site, served at $ROUTE (default /kids-code-lab/)
#         $WORK/kids-code-lab-<version>.tar.gz (+ .sha256)  the release artefact: kids-code-lab-<version>/{www/,kcl-headers.json}
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$HERE/../.build}"
ARCADE_TAG="${ARCADE_TAG:-v4.2.1}"          # pins pxt-core 13.2.1 and pxt-common-packages 14.1.4 (package.json)
ROUTE="${ROUTE:-/kids-code-lab}"
VERSION="${VERSION:-$(git -C "$HERE" describe --tags --always 2>/dev/null || echo dev)}"
VERSION="${VERSION#v}"                     # release contract: <version> = the tag without its leading v

mkdir -p "$WORK" && cd "$WORK"
WORK="$(pwd)"

# 1. sources (pinned tag, shallow)
[ -d pxt-arcade ] || git clone -q --depth 1 --branch "$ARCADE_TAG" https://github.com/microsoft/pxt-arcade.git
cd pxt-arcade
# pxt-arcade has no lockfile; the two pxt packages are pinned exactly in its package.json. The optional
# dependency github:microsoft/pxt-arcade-sim is a private repo and is skipped (see step 2).
npm install --no-audit --no-fund

# 2. simulator. The compiled simulator (built/sim.js, sim-strings.json) is only published in the npm package
#    pxt-arcade@<same version> (MIT). simulator.html and sim.css are ours (makecode/sim/, THIRD-PARTY-NOTICES.md).
VER="${ARCADE_TAG#v}"
mkdir -p "$WORK/npmpkg"
[ -f "$WORK/npmpkg/pxt-arcade-$VER.tgz" ] || (cd "$WORK/npmpkg" && npm pack "pxt-arcade@$VER" --silent >/dev/null)
tar -xzf "$WORK/npmpkg/pxt-arcade-$VER.tgz" -C "$WORK/npmpkg"
mkdir -p built sim/public public          # public/: empty; pxt-core scans <simDir>/public and simDir is "" here
cp "$WORK/npmpkg/package/built/sim.js" "$WORK/npmpkg/package/built/sim-strings.json" built/
rm -f sim/public/sim.css sim/public/sim-shell.css
cp "$HERE/sim/simulator.html" "$HERE/sim/sim.css" "$HERE/sim/sim-keys.js" sim/public/

# 3. target patches: languages, cloud UI off, hardware off (docs/BUILD.md "Patches")
node "$HERE/patch-target.mjs" .

# 4. Greek translations from the public makecode.com API (build time only), bundled with --locs-src
rm -rf "$WORK/locs"
node "$HERE/fetch-locs.mjs" . "$WORK/locs" el de | tee "$WORK/locs-el.tsv"

# 5. package. MSYS_NO_PATHCONV: Git Bash would rewrite the route "/kids-code-lab" into a Windows path;
#    the relative --locs-src avoids the same problem in the other direction. No effect on Linux.
MSYS_NO_PATHCONV=1 node node_modules/pxt-core/built/pxt.js staticpkg --route "$ROUTE" --locs-src ../locs --no-appcache

# 6. output patches + slim copy + play page + precompression + tarball
OUT="built/packaged${ROUTE}"
node "$HERE/patch-output.mjs" "$OUT" --slim "$WORK/slim"
# play page (/kids-code-lab/play/?id=) and the lab's own pages (/kids-code-lab/lab/)
rm -rf "$WORK/slim/play" "$WORK/slim/lab"
mkdir -p "$WORK/slim/play" "$WORK/slim/lab" && cp "$HERE"/player/* "$WORK/slim/play/" && cp "$HERE"/lab/* "$WORK/slim/lab/"
node "$HERE/pack.mjs" "$WORK/slim" "$WORK" "$VERSION"
du -sh "$OUT" "$WORK/slim"
