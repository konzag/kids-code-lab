// Patches microsoft/pxt-arcade before `pxt staticpkg` (docs/BUILD.md "Patches"). Idempotent.
// Usage: node patch-target.mjs <pxt-arcade dir>
// Env: KCL_LOCALES (default "en el"), KCL_DEFAULT_LOCALE (default "el"), KCL_KEEP_HW=1 keeps the hardware variants.
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir] = process.argv.slice(2);
const locales = (process.env.KCL_LOCALES ?? "en el").split(/\s+/).filter(Boolean);
const defaultLocale = process.env.KCL_DEFAULT_LOCALE ?? "el";
const keepHw = process.env.KCL_KEEP_HW === "1";

const pxtargetPath = join(dir, "pxtarget.json");
const t = JSON.parse(readFileSync(pxtargetPath, "utf8"));
const th = t.appTheme;
const changes = [];
const set = (obj, key, value, label) => {
  if (JSON.stringify(obj[key]) !== JSON.stringify(value)) { obj[key] = value; changes.push(label ?? key); }
};
const del = (obj, key, label) => { if (key in obj) { delete obj[key]; changes.push(`-${label ?? key}`); } };

// --- Languages: only English + Greek, Greek first. "el" is not in Arcade's list, so the bundled el files would be
// ignored without it. disableLiveTranslations: otherwise a non-English UI fetches makecode.com/api/translations.
set(th, "availableLocales", locales);
set(th, "disableLiveTranslations", true);
// crowdinProject shows "Translate the editor" (in-context translation, loads Crowdin) and a /translate link in
// MakeCode's language dialog. The build bundles translations with --locs-src and does not need it.
del(th, "crowdinProject");
// Default language when neither ?lang= nor MakeCode's PXT_LANG cookie (set by its language menu) says otherwise.
// (main.js: lang = urlLang || userPref || cookie || appTheme.defaultLocale || navigator.language)
set(th, "defaultLocale", defaultLocale);

// --- Cloud UI off: sign-in, share, GitHub, extensions, cloud import, publishing, badges.
t.cloud = t.cloud ?? {};
for (const k of ["sharing", "thumbnails", "importing", "packages", "publishing", "githubPackages", "showBadges"]) {
  set(t.cloud, k, false, `cloud.${k}`);
}
set(t.cloud, "cloudProviders", {}, "cloud.cloudProviders");
set(th, "identity", false);
set(th, "githubEditor", false);
set(th, "qrCode", false);
set(th, "shareToKiosk", false);
set(th, "hideShareEmbed", true);
set(th, "allowPackageExtensions", false);
set(th, "forceEnableAiErrorHelp", false);
del(th, "githubUrl");
del(th, "feedbackUrl");
// links out of the site (footer of the home page, help menu, feedback frame): a child stays inside the lab.
// homeUrl/embedUrl stay: they only build share URLs, and sharing is off.
for (const k of ["logoUrl", "organizationUrl", "privacyUrl", "termsOfUseUrl", "ocvFrameUrl"]) del(th, k);
if (Array.isArray(th.docMenu) && th.docMenu.length) set(th, "docMenu", [], "docMenu");
// MakeCode home page: no hero carousel / galleries (images are absolute /static/... paths and link to the cloud);
// the home page keeps "My Projects" and "New Project".
del(th, "homeScreenHero");
del(th, "homeScreenHeroGallery");
del(th, "socialOptions");
// NOT allowParentController: with it MakeCode switches to the "iframe" workspace and stores projects in the
// parent page (measured: "workspace: iframe", the editor never opened). The lab drives the editor with MakeCode's
// hash commands instead (#newproject, #header:<id>, #tutorial:<path>).
if (th.allowParentController) del(th, "allowParentController");

// --- Hardware off (spec §11: no flashing). Without the hardware variants and the *prj/hw---* packages the build
// needs no makecode.com cloud compiler, and the editor never touches WebUSB.
if (!keepHw) {
  if (t.variants) { del(t, "variants"); }
  // hardware board packages (libs/hw---*) and hardware project templates (libs/d5prj, f4prj, rpiprj); the browser
  // project template libs/blocksprj stays. pxt also builds every libs/*prj folder it finds, so the folders of the
  // (throw-away) clone are removed as well.
  const HW = (d) => /(^|\/)hw---/.test(d) || /(^|\/)(d5|f4|rpi)prj$/.test(d);
  const before = t.bundleddirs.length;
  t.bundleddirs = t.bundleddirs.filter((d) => !HW(d));
  if (t.bundleddirs.length !== before) changes.push(`bundleddirs -${before - t.bundleddirs.length}`);
  for (const name of readdirSync(join(dir, "libs"))) {
    if (HW(`libs/${name}`)) { rmSync(join(dir, "libs", name), { recursive: true, force: true }); changes.push(`rm libs/${name}`); }
  }
  if (t.staticpkgdirs) set(t.staticpkgdirs, "base", [], "staticpkgdirs.base");
  set(t.compile, "webUSB", false, "compile.webUSB");
  set(th, "checkForHwVariantWebUSB", false);
  set(th, "preferWebUSBDownload", false);
  // The Download options menu shows «Επιλέξτε Υλικό» / "Choose Hardware" whenever
  // simulator.dynamicBoardDefinition is set (main.js: y = simulator.dynamicBoardDefinition); with no hardware
  // variants it opened an empty list. Off: the editor uses the default Arcade board only.
  if (t.simulator) set(t.simulator, "dynamicBoardDefinition", false, "simulator.dynamicBoardDefinition");
}

writeFileSync(pxtargetPath, JSON.stringify(t, null, 4) + "\n");

// --- targetconfig.json (shipped as-is in the package): no galleries, no hardware download dialog, no share list.
const tcPath = join(dir, "targetconfig.json");
const tc = JSON.parse(readFileSync(tcPath, "utf8"));
const tcChanges = [];
for (const [k, v] of [["galleries", {}], ["hardwareOptions", []], ["shareLinks", { approved: [] }]]) {
  if (JSON.stringify(tc[k]) !== JSON.stringify(v)) { tc[k] = v; tcChanges.push(k); }
}
writeFileSync(tcPath, JSON.stringify(tc, null, 4) + "\n");

console.log(`patch-target: pxtarget.json [${changes.join(", ") || "no change"}]; targetconfig.json [${tcChanges.join(", ") || "no change"}]`);
