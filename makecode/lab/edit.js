// KIDS-CODE-LAB: the editor page: MakeCode in a frame, the lab's top bar and the «Δημοσίευση» dialog.
// Publishing uses the hub's existing unlock session (cookie of the «Προφίλ» page); the lab never asks for a PIN.
import {
  PAYLOAD_TEXT, buildPublishPayload, cleanText, packBinary, publishErrorText, recordFirstProject, recordPublish,
  retryAfterSeconds, tutorialById, TITLE_MAX,
} from "./core.js";
import { el, initTheme, settings, store } from "./common.js";
import { compileProject, isHeaderId, listProjects, makeCartridge, publishedFiles, readProject } from "./mc.js";

initTheme(document.getElementById("theme"));

const frame = document.getElementById("editor-frame");
const params = new URLSearchParams(location.search);
const projectId = params.get("project");
const tutorial = tutorialById(params.get("tutorial"));
const isNew = params.get("new") === "1";

// MakeCode's hash commands open the right project; the editor's language is its own (language menu cookie, else
// Greek: makecode/patch-target.mjs). Inside a frame MakeCode would otherwise start in its read-only "sandbox"
// layout with an in-memory workspace (pxtlib shell.init: isIFrame() -> Sandbox; measured "workspace: mem",
// "Cannot edit in read-only editor"): editorlayout=ide gives the full editor, ws=browser its IndexedDB workspace,
// so the child's projects are kept and the lab can read them.
const EDITOR = "../index.html?editorlayout=ide&ws=browser";
frame.src = tutorial ? `${EDITOR}#tutorial:/tutorials/${tutorial.id}`
  : isNew ? `${EDITOR}#newproject`
    : isHeaderId(projectId) ? `${EDITOR}#header:${projectId}` : `${EDITOR}#editor`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- «Δημοσίευση» ----------
const dlg = document.getElementById("publish");
const form = document.getElementById("publish-form");
const prep = document.getElementById("prep-status");
const out = document.getElementById("publish-status");
const submit = document.getElementById("publish-submit");
const titleIn = document.getElementById("title");
const descIn = document.getElementById("description");
const profileSel = document.getElementById("profile");
const profileHint = document.getElementById("profile-hint");
const cover = document.getElementById("cover");

let prepared = null; // {cartridge, binary}
let sessionOk = false;

function say(node, text, kind = "") {
  node.className = `status ${kind}`.trim();
  node.replaceChildren(text);
}

function canSubmit() {
  submit.disabled = !(prepared && sessionOk);
}

async function loadProfiles() {
  profileSel.replaceChildren();
  profileHint.replaceChildren();
  sessionOk = false;
  let r;
  try {
    r = await fetch("/api/profiles", { credentials: "same-origin", headers: { Accept: "application/json" } });
  } catch {
    profileHint.append(publishErrorText(0));
    return;
  }
  if (r.status === 401) {
    profileHint.append("Χρειάζεται ο γονιός: ξεκλείδωσε πρώτα στη σελίδα ",
      el("a", { href: "/profiles", target: "_blank", rel: "noopener", text: "«Προφίλ» του hub" }),
      " και μετά πάτα ξανά «Δημοσίευση».");
    return;
  }
  if (!r.ok) {
    profileHint.append(publishErrorText(r.status));
    return;
  }
  let profiles = [];
  try {
    const body = await r.json();
    profiles = Array.isArray(body.profiles) ? body.profiles : [];
  } catch {
    profiles = [];
  }
  profiles = profiles.filter((p) => p && Number.isInteger(p.id) && p.id > 0 && typeof p.name === "string");
  if (!profiles.length) {
    profileHint.append("Δεν υπάρχει προφίλ ακόμα. Ο γονιός φτιάχνει ένα στη σελίδα ",
      el("a", { href: "/profiles", target: "_blank", rel: "noopener", text: "«Προφίλ»" }), ".");
    return;
  }
  for (const p of profiles) profileSel.append(el("option", { value: String(p.id), text: p.name }));
  sessionOk = true;
}

async function prepare() {
  prepared = null;
  cover.hidden = true;
  say(prep, "Ετοιμάζω το παιχνίδι…");
  // MakeCode saves a project a moment after each change (IndexedDB); give the last change time to land
  await sleep(1500);
  const projects = await listProjects();
  const current = isHeaderId(projectId) && projects.some((p) => p.id === projectId) && !isNew ? projectId : projects[0]?.id;
  const project = current ? await readProject(current) : null;
  const pub = project ? publishedFiles(project.files) : null;
  if (!pub) throw new Error("no project");
  const s = settings();
  if (recordFirstProject(s)) store(s);
  if (!titleIn.value) titleIn.value = Array.from(cleanText(project.header.name)).slice(0, TITLE_MAX).join("");
  const built = await compileProject(pub);
  const packed = await packBinary(built);
  if (!packed.ok) throw Object.assign(new Error(packed.error), { payloadError: packed.error });
  const cart = await makeCartridge(frame.contentWindow, { header: project.header, config: pub.config, files: pub.files }, titleIn.value || project.header.name);
  cover.src = cart.dataUrl;
  cover.hidden = false;
  prepared = { cartridge: cart.base64, cartridgeBytes: cart.bytes, binary: packed.base64, binaryGzipBytes: packed.gzipBytes };
  say(prep, `Έτοιμο: ${Math.max(1, Math.round(packed.gzipBytes / 1024))} KB από τα 2048 KB.`);
}

document.getElementById("publish-open").addEventListener("click", async () => {
  say(out, "");
  submit.disabled = true;
  dlg.showModal();
  titleIn.focus();
  await Promise.all([
    loadProfiles(),
    prepare().catch((e) => {
      console.warn("kcl prepare:", e && e.message); // no user data in it: step name only
      say(prep, e.payloadError ? PAYLOAD_TEXT[e.payloadError] : "Δεν μπόρεσα να ετοιμάσω το παιχνίδι. Αποθήκευσε και δοκίμασε ξανά.", "error");
    }),
  ]);
  canSubmit();
});

document.getElementById("publish-cancel").addEventListener("click", () => dlg.close());

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!prepared || !sessionOk) return;
  const payload = buildPublishPayload({
    title: titleIn.value,
    description: descIn.value,
    profile: Number(profileSel.value),
    ...prepared,
  });
  if (!payload.ok) {
    say(out, payload.errors.map((e) => PAYLOAD_TEXT[e]).join(" "), "error");
    return;
  }
  submit.disabled = true;
  say(out, "Δημοσίευση…");
  let r;
  try {
    r = await fetch("/api/lab/games", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: payload.body,
    });
  } catch {
    say(out, publishErrorText(0), "error");
    canSubmit();
    return;
  }
  if (r.status === 201) {
    let body = {};
    try {
      body = await r.json();
    } catch {
      body = {};
    }
    const id = /^[0-9]{1,9}$/.test(String(body.id)) ? String(body.id) : null;
    const s = recordPublish(settings(), id ?? "", typeof body.unpublish_token === "string" ? body.unpublish_token : "");
    store(s);
    const done = el("span", { text: "Το παιχνίδι μπήκε στο ράφι του hub. " });
    if (id) done.append(el("a", { href: `../play/?id=${id}`, text: "Παίξε το" }));
    say(out, done, "ok");
    return; // the dialog stays open on the success message; «Άκυρο» closes it
  }
  let text = publishErrorText(r.status);
  if (r.status === 429) {
    const sec = retryAfterSeconds(r.headers.get("Retry-After"));
    if (sec) text += ` (σε ${sec} δευτερόλεπτα)`;
  }
  if (r.status === 401) {
    say(out, el("span", { text: `${text} ` }, el("a", { href: "/profiles", target: "_blank", rel: "noopener", text: "Άνοιγμα «Προφίλ»" })), "error");
    sessionOk = false;
  } else {
    say(out, text, "error");
  }
  canSubmit();
});
