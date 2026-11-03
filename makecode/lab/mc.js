// KIDS-CODE-LAB: the bridge to the packaged MakeCode editor (same origin, /kids-code-lab/).
// - reads MakeCode's own local projects (IndexedDB, read-only): «Τα παιχνίδια μου» and the project to publish;
// - opens projects in the editor frame with MakeCode's hash commands (#newproject, #header:<id>, #tutorial:<path>);
// - compiles a project with the packaged runner (run.html, data-code/data-assets, sendBuilt=1) into the pxtc
//   BuiltSimJsInfo that the player runs;
// - makes the .png cartridge exactly as MakeCode does (lzma-compressed project hidden in the image), with the
//   editor's own pxt functions, so the cartridge can be imported back into the editor.

const DB = "__pxt_idb_workspace_arcade___default";
const HEADER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isHeaderId = (id) => typeof id === "string" && HEADER_ID.test(id);

function openDb() {
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB);
    } catch {
      resolve(null);
      return;
    }
    // never create or upgrade MakeCode's database from here
    req.onupgradeneeded = () => {
      req.transaction.abort();
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function readAll(store) {
  const db = await openDb();
  if (!db) return [];
  try {
    if (!db.objectStoreNames.contains(store)) return [];
    return await new Promise((resolve) => {
      const r = db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => resolve([]);
    });
  } finally {
    db.close();
  }
}

/** MakeCode's projects on this device, newest first: [{id, name, modified}] (deleted ones left out). */
export async function listProjects() {
  const headers = await readAll("headers");
  return headers
    .filter((h) => h && !h.isDeleted && isHeaderId(h.id) && h.target === "arcade")
    .map((h) => ({ id: h.id, name: String(h.name || "").slice(0, 80), modified: Number(h.modificationTime) || 0, recent: Number(h.recentUse) || 0, editor: h.editor }))
    .sort((a, b) => Math.max(b.modified, b.recent) - Math.max(a.modified, a.recent));
}

/** One project's header and files, or null. */
export async function readProject(id) {
  if (!isHeaderId(id)) return null;
  const [headers, texts] = await Promise.all([readAll("headers"), readAll("texts")]);
  const header = headers.find((h) => h.id === id && !h.isDeleted);
  const text = texts.find((t) => t.id === id);
  if (!header || !text || !text.files) return null;
  return { header, files: text.files };
}

/** The files MakeCode publishes: pxt.json and the files it lists (not the editor history). */
export function publishedFiles(files) {
  let cfg;
  try {
    cfg = JSON.parse(files["pxt.json"]);
  } catch {
    return null;
  }
  const out = { "pxt.json": files["pxt.json"] };
  for (const f of Array.isArray(cfg.files) ? cfg.files : []) if (typeof files[f] === "string") out[f] = files[f];
  return { config: cfg, files: out };
}

// ---------- compile with the packaged runner ----------
/** Compiles {config, files} with run.html in a hidden frame; resolves with the pxtc BuiltSimJsInfo. */
export function compileProject(project, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const deps = Object.entries(project.config.dependencies || {})
      .filter(([k, v]) => /^[a-z0-9-]+$/i.test(k) && typeof v === "string")
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    const assets = {};
    for (const [name, text] of Object.entries(project.files)) if (/\.(ts|jres)$/.test(name) && name !== "main.ts") assets[name] = text;
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = "compile";
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("data-code", encodeURIComponent(project.files["main.ts"] || ""));
    frame.setAttribute("data-assets", encodeURIComponent(JSON.stringify(assets)));
    const timer = setTimeout(() => done(new Error("compile timeout")), timeoutMs);
    function done(err, built) {
      clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      frame.remove();
      if (err) reject(err);
      else resolve(built);
    }
    function onMsg(ev) {
      if (ev.source !== frame.contentWindow || ev.origin !== location.origin) return;
      const d = ev.data;
      if (d && typeof d.js === "string" && d.js.length > 0) done(null, d);
    }
    window.addEventListener("message", onMsg);
    frame.src = `../run.html?sendBuilt=1&nofooter=1&hideSimButtons=1${deps ? `&deps=${encodeURIComponent(deps)}` : ""}`;
    document.body.appendChild(frame);
  });
}

// ---------- cartridge ----------
/** The cover drawn by the lab: chalkboard, title, a block-joystick, 160x120 like the Arcade screen. */
export function drawCover(doc, title) {
  const c = doc.createElement("canvas");
  c.width = 160;
  c.height = 120;
  const g = c.getContext("2d");
  g.fillStyle = "#2f5d50";
  g.fillRect(0, 0, 160, 120);
  g.fillStyle = "#e8833a";
  for (const [x, y] of [[64, 34], [80, 34], [48, 50], [64, 50], [80, 50], [96, 50], [64, 66], [80, 66]]) g.fillRect(x, y, 14, 14);
  g.fillStyle = "#f6efe0";
  g.font = "bold 12px sans-serif";
  g.textAlign = "center";
  g.fillText(String(title).slice(0, 24), 80, 104, 150);
  return c;
}

/**
 * The .png cartridge as MakeCode makes it (Save button): lzma(JSON project) encoded into the image's pixels, using
 * the editor frame's own pxt functions (same origin). Returns {dataUrl, base64, bytes}.
 */
export async function makeCartridge(editorWindow, project, title) {
  const pxt = editorWindow.pxt;
  if (!pxt || typeof pxt.lzmaCompressAsync !== "function" || !pxt.Util || typeof pxt.Util.encodeBlobAsync !== "function") {
    throw new Error("cartridge tools missing");
  }
  const json = {
    meta: {
      cloudId: `${pxt.CLOUD_ID || "pxt/"}${pxt.appTarget.id}`,
      targetVersions: pxt.appTarget.versions,
      editor: project.header.editor || "blocksprj",
      name: project.config.name || project.header.name,
    },
    source: JSON.stringify(project.files, null, 2),
  };
  const blob = await pxt.lzmaCompressAsync(JSON.stringify(json, null, 2));
  if (!blob) throw new Error("lzma failed");
  const cover = drawCover(editorWindow.document, title);
  const canvas = pxt.Util.encodeBlobAsync(cover, blob);
  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return { dataUrl, base64, bytes: Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0) };
}
