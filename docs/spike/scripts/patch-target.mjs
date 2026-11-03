// Patches pxtarget.json of pxt-arcade before `pxt staticpkg` (SPIKE-REPORT.md §4, §6).
// Usage: node patch-target.mjs <pxtarget.json> "<space separated extra locales>"
import { readFileSync, writeFileSync } from "node:fs";

const [file, langs = ""] = process.argv.slice(2);
const t = JSON.parse(readFileSync(file, "utf8"));
const th = t.appTheme;

// §6 Greek: "el" is not in Arcade's availableLocales; without it the editor ignores the bundled el files.
for (const l of langs.split(/\s+/).filter(Boolean)) if (!th.availableLocales.includes(l)) th.availableLocales.push(l);

// §4 offline: with a non-English language the editor fetches "live" translations from
// https://makecode.com/api/translations unless disableLiveTranslations is set (or ?staticlang=1 is in the URL).
th.disableLiveTranslations = true;

writeFileSync(file, JSON.stringify(t, null, 4) + "\n");
console.log(`patched ${file}: availableLocales=${th.availableLocales.join(",")}`);
