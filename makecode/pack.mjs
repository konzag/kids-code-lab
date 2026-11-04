// The release artefact (APP-REPLY 2026-11-03 §2c):
//   kids-code-lab-<version>.tar.gz          one top directory kids-code-lab-<version>/ holding
//       www/                                  the tree served at /kids-code-lab/, .br and .gz next to each text file
//       kcl-headers.json                      page kinds, editor script hashes, CORP files (makecode/manifest.mjs)
//   kids-code-lab-<version>.tar.gz.sha256   sha256sum format: "<hash>  kids-code-lab-<version>.tar.gz"
// Usage: node pack.mjs <site dir> <work dir> <version without leading v>
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { buildManifest } from "./manifest.mjs";

const [site, work, rawVersion] = process.argv.slice(2);
const version = String(rawVersion || "").replace(/^v/, "");
if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) throw new Error(`pack: bad version "${rawVersion}"`);
const name = `kids-code-lab-${version}`;
const stage = join(work, "release");
const top = join(stage, name);
const www = join(top, "www");

rmSync(stage, { recursive: true, force: true });
mkdirSync(top, { recursive: true });
cpSync(site, www, { recursive: true });
for (const f of readdirSync(www, { recursive: true })) if (/\.(br|gz)$/.test(String(f))) rmSync(join(www, String(f)));

// precompression for a file server with "precompressed" support
const TEXT = /\.(html|js|css|json|md|svg|txt|webmanifest|map|xml)$/i;
let n = 0, raw = 0, gz = 0, br = 0;
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!TEXT.test(e.name)) continue;
    const body = readFileSync(p);
    if (body.length < 1024) continue;
    const g = gzipSync(body, { level: 9 });
    const b = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } });
    writeFileSync(`${p}.gz`, g);
    writeFileSync(`${p}.br`, b);
    n++; raw += body.length; gz += g.length; br += b.length;
  }
};
walk(www);
const mb = (x) => (x / 1048576).toFixed(1);
console.log(`pack: ${n} text files ${mb(raw)} MB -> gzip ${mb(gz)} MB, brotli ${mb(br)} MB`);

// the manifest from the tree as shipped (not served: next to www/)
const manifest = buildManifest(www);
writeFileSync(join(top, "kcl-headers.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`pack: kcl-headers.json editor ${manifest.editor.paths.join(" ")} (${manifest.editor.script_hashes.length} hashes), simulator ${manifest.simulator.paths.join(" ")}, player ${manifest.player.paths.join(" ")}, corp ${manifest.corp_cross_origin.join(" ")}`);

// tarball (system tar: GNU tar on Linux, bsdtar on Windows) with relative paths, then its .sha256
const tarball = `${name}.tar.gz`;
execFileSync("tar", ["-czf", join("..", tarball), name], { cwd: stage, stdio: "inherit" });
const hash = createHash("sha256").update(readFileSync(join(work, tarball))).digest("hex");
writeFileSync(join(work, `${tarball}.sha256`), `${hash}  ${tarball}\n`);
rmSync(stage, { recursive: true, force: true });
console.log(`pack: ${join(work, tarball)} ${mb(statSync(join(work, tarball)).size)} MB sha256 ${hash}`);
