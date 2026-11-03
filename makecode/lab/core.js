// KIDS-CODE-LAB: the lab's logic without DOM (unit-tested in node: tests/unit/core.test.mjs).
// Settings + GAME-STANDARD v1.3 §5a hub object in localStorage `game.kids-code-lab.v1`, the publish payload for
// POST /api/lab/games (games-hub ADR-0006), the size caps and the Greek texts of the server's answers.

export const KEY = "game.kids-code-lab.v1";
export const VERSION = 1;
export const MAX_MILESTONES = 50;
export const MILESTONE_RE = /^[a-z0-9-]{1,32}$/;
export const TITLE_MAX = 40;
export const DESCRIPTION_MAX = 140;
export const BINARY_GZIP_MAX = 2 * 1024 * 1024; // spec §12a.6: 2 MB, gzip-compressed
export const CARTRIDGE_MAX = 256 * 1024; // ADR-0006 contract: the cartridge PNG <= 256 KB
export const THEMES = ["light", "dark"];
export const LANGS = ["el", "en"];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** A fresh settings object. */
export function defaults() {
  return {
    version: VERSION,
    theme: null, // null = follow prefers-color-scheme
    lang: "el",
    publishCount: 0,
    published: {}, // { "<game id>": "<unpublish token>" }: bearer secrets, never in a URL, a log or the console
    hub: { schema: 1, completed: false, milestones: [] },
  };
}

/** The §5a hub object, cleaned: only schema/completed/completedAt/milestones, valid ids only, append order kept. */
export function cleanHub(raw) {
  const hub = { schema: 1, completed: false, milestones: [] };
  if (!isObj(raw)) return hub;
  const seen = new Set();
  for (const m of Array.isArray(raw.milestones) ? raw.milestones : []) {
    if (typeof m === "string" && MILESTONE_RE.test(m) && !seen.has(m) && hub.milestones.length < MAX_MILESTONES) {
      seen.add(m);
      hub.milestones.push(m);
    }
  }
  if (raw.completed === true) {
    hub.completed = true;
    if (isDate(raw.completedAt)) hub.completedAt = raw.completedAt;
  }
  return hub;
}

/** Settings from a JSON string (null, bad JSON, old or future version, wrong types: never throws). */
export function parseSettings(text) {
  const s = defaults();
  let raw;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    return s;
  }
  if (!isObj(raw)) return s;
  // version 0 (no version field, an early draft) is migrated field by field; a newer version is read the same way,
  // keeping only the fields this code knows.
  if (THEMES.includes(raw.theme)) s.theme = raw.theme;
  if (LANGS.includes(raw.lang)) s.lang = raw.lang;
  if (Number.isInteger(raw.publishCount) && raw.publishCount >= 0) s.publishCount = raw.publishCount;
  if (isObj(raw.published)) {
    for (const [id, token] of Object.entries(raw.published)) {
      if (/^[0-9]{1,9}$/.test(id) && typeof token === "string" && token.length > 0 && token.length <= 256) s.published[id] = token;
    }
  }
  s.hub = cleanHub(raw.hub);
  return s;
}

/** Load from a Storage-like object; any storage error = defaults. */
export function loadSettings(storage) {
  try {
    return parseSettings(storage.getItem(KEY));
  } catch {
    return defaults();
  }
}

/** Save; returns false when the storage refuses (private mode, quota): the lab keeps working. */
export function saveSettings(storage, settings) {
  try {
    storage.setItem(KEY, JSON.stringify({ ...settings, version: VERSION, hub: cleanHub(settings.hub) }));
    return true;
  } catch {
    return false;
  }
}

/** Append-only milestone; false if invalid, already there or the list is full. */
export function addMilestone(hub, id) {
  if (typeof id !== "string" || !MILESTONE_RE.test(id)) return false;
  if (hub.milestones.includes(id) || hub.milestones.length >= MAX_MILESTONES) return false;
  hub.milestones.push(id);
  return true;
}

export function today(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** The child saved a first project in the editor. */
export function recordFirstProject(settings) {
  return addMilestone(settings.hub, "first-project");
}

/** A 201 from POST /api/lab/games on this device: token kept, milestones, completion written once. */
export function recordPublish(settings, id, token, date = new Date()) {
  if (/^[0-9]{1,9}$/.test(String(id)) && typeof token === "string" && token) settings.published[String(id)] = token;
  settings.publishCount += 1;
  addMilestone(settings.hub, "first-publish");
  if (settings.publishCount >= 5) addMilestone(settings.hub, "publish-5");
  if (!settings.hub.completed) {
    settings.hub.completed = true;
    settings.hub.completedAt = today(date);
  } else if (!settings.hub.completedAt) {
    settings.hub.completedAt = today(date);
  }
  return settings;
}

/** A successful «Απόσυρση» (204): the token is no longer needed. Milestones stay (append-only). */
export function recordUnpublish(settings, id) {
  delete settings.published[String(id)];
  return settings;
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g;
/** Text as the child typed it, without control/bidi characters, trimmed, whitespace runs collapsed. */
export function cleanText(s) {
  return String(s ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}
const length = (s) => Array.from(s).length; // code points, so «ά» or an emoji counts once

/**
 * The JSON body of POST /api/lab/games. Title 1..40, description 0..140 (code points, after cleanText), profile =
 * an integer id from GET /api/profiles, cartridge = base64 PNG <= 256 KB, binary = base64 of the gzipped game JSON
 * <= 2 MB. The text is never HTML-escaped here: it goes out as JSON and every page shows it with textContent.
 */
export function buildPublishPayload({ title, description, profile, cartridge, cartridgeBytes, binary, binaryGzipBytes }) {
  const errors = [];
  const t = cleanText(title);
  const d = cleanText(description);
  if (length(t) < 1) errors.push("title-empty");
  if (length(t) > TITLE_MAX) errors.push("title-long");
  if (length(d) > DESCRIPTION_MAX) errors.push("description-long");
  if (!Number.isInteger(profile) || profile <= 0) errors.push("profile");
  if (typeof cartridge !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(cartridge)) errors.push("cartridge");
  else if (!(cartridgeBytes > 0) || cartridgeBytes > CARTRIDGE_MAX) errors.push("cartridge-big");
  if (typeof binary !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(binary)) errors.push("binary");
  else if (!(binaryGzipBytes > 0) || binaryGzipBytes > BINARY_GZIP_MAX) errors.push("binary-big");
  if (errors.length) return { ok: false, errors };
  return { ok: true, body: JSON.stringify({ title: t, description: d, profile, cartridge, binary }) };
}

/** Greek messages for the payload errors above. */
export const PAYLOAD_TEXT = {
  "title-empty": "Γράψε έναν τίτλο για το παιχνίδι.",
  "title-long": `Ο τίτλος θέλει έως ${TITLE_MAX} γράμματα.`,
  "description-long": `Η περιγραφή θέλει έως ${DESCRIPTION_MAX} γράμματα.`,
  profile: "Διάλεξε ποιος έφτιαξε το παιχνίδι.",
  cartridge: "Δεν βρήκα την εικόνα του παιχνιδιού.",
  "cartridge-big": "Η εικόνα του παιχνιδιού είναι πολύ μεγάλη.",
  binary: "Το παιχνίδι δεν μεταφράστηκε. Δοκίμασε ξανά.",
  "binary-big": "Το παιχνίδι είναι πολύ μεγάλο για το ράφι (έως 2 MB).",
};

/** Greek text for an answer of POST /api/lab/games (or DELETE). */
export function publishErrorText(status) {
  switch (status) {
    case 401: return "Χρειάζεται ο γονιός: ξεκλείδωσε πρώτα στη σελίδα «Προφίλ» του hub.";
    case 403: return "Η δημοσίευση γίνεται μόνο από το εργαστήρι μέσα στο σπίτι.";
    case 404: return "Αυτό το παιχνίδι δεν είναι πια στο ράφι.";
    case 409: return "Το ράφι είναι γεμάτο (100 παιχνίδια). Ζήτα από τον γονιό να αφαιρέσει ένα.";
    case 413: return "Το παιχνίδι είναι πολύ μεγάλο για το ράφι (έως 2 MB).";
    case 415: return "Το παιχνίδι ή η εικόνα του δεν έχουν τη σωστή μορφή.";
    case 422: return "Κάτι λείπει: έλεγξε τον τίτλο, την περιγραφή και το προφίλ.";
    case 429: return "Πολλές προσπάθειες. Περίμενε λίγο και δοκίμασε ξανά.";
    case 503: return "Η αποθήκευση στο σπίτι δεν είναι ενεργή τώρα. Δοκίμασε αργότερα.";
    default: return "Κάτι δεν πήγε καλά. Δοκίμασε ξανά.";
  }
}

/** Seconds from a Retry-After header (delta-seconds only), or null. */
export function retryAfterSeconds(value) {
  return /^\d{1,6}$/.test(String(value ?? "").trim()) ? Number(value) : null;
}

/** gzip with the platform CompressionStream (browsers, node >= 18). */
export async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The compiled game (pxtc BuiltSimJsInfo) as gzip bytes + base64, with the client-side cap check. */
export async function packBinary(built) {
  if (!built || typeof built.js !== "string" || !built.js) return { ok: false, error: "binary" };
  const json = JSON.stringify({ js: built.js, fnArgs: built.fnArgs ?? {}, parts: built.parts ?? [], usedBuiltinParts: built.usedBuiltinParts ?? [] });
  const gz = await gzip(new TextEncoder().encode(json));
  if (gz.length > BINARY_GZIP_MAX) return { ok: false, error: "binary-big", gzipBytes: gz.length };
  return { ok: true, base64: toBase64(gz), gzipBytes: gz.length, rawBytes: json.length };
}

/** The player's only accepted query: exactly one parameter, id, 1-9 digits. */
export function parseGameId(search) {
  const params = new URLSearchParams(search);
  const keys = Array.from(params.keys());
  const id = params.get("id");
  return keys.length === 1 && keys[0] === "id" && id && /^[0-9]{1,9}$/.test(id) ? id : null;
}

/** «Μαθήματα»: built-in MakeCode tutorials that ship in the offline build (docs/tutorials/<id>.md). */
export const TUTORIALS = [
  { id: "intro", title: "Το πρώτο μου παιχνίδι", text: "Ένας ήρωας που κινείται με τα βελάκια." },
  { id: "chase-the-pizza", title: "Κυνήγα την πίτσα", text: "Μάζεψε πόντους πριν τελειώσει ο χρόνος." },
  { id: "collect-the-clovers", title: "Μάζεψε τα τριφύλλια", text: "Τρέξε, μάζεψε και πρόσεχε τους εχθρούς." },
  { id: "maze", title: "Λαβύρινθος", text: "Βρες τον δρόμο προς την έξοδο." },
  { id: "happy-flower", title: "Χαρούμενο λουλούδι", text: "Ζωγράφισε και κίνησε ένα λουλούδι." },
];
export const tutorialById = (id) => TUTORIALS.find((t) => t.id === id) || null;
