// Precompresses the text files of the slim site (<file>.gz and <file>.br next to each, for a file server with
// "precompressed" support) and writes the release tarball. Usage: node pack.mjs <site dir> <out .tar.gz>
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, dirname, basename } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";

const [site, tarball] = process.argv.slice(2);
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
    writeFileSync(p + ".gz", g);
    writeFileSync(p + ".br", b);
    n++; raw += body.length; gz += g.length; br += b.length;
  }
};
walk(site);
const mb = (x) => (x / 1048576).toFixed(1);
console.log(`pack: ${n} text files ${mb(raw)} MB -> gzip ${mb(gz)} MB, brotli ${mb(br)} MB`);
// tar with relative paths; system tar (GNU tar on Linux, bsdtar/GNU tar in Git Bash)
execFileSync("tar", ["-czf", basename(tarball), "-C", relative(dirname(tarball), site) || ".", "."], { cwd: dirname(tarball), stdio: "inherit" });
console.log(`pack: ${tarball} ${mb(statSync(tarball).size)} MB`);
