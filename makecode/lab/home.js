// KIDS-CODE-LAB: «Αρχική του εργαστηρίου».
import { TUTORIALS, publishErrorText, recordFirstProject, recordUnpublish } from "./core.js";
import { dateEl, el, initTheme, settings, store } from "./common.js";
import { listProjects } from "./mc.js";

initTheme(document.getElementById("theme"));

// «Τα παιχνίδια μου»: MakeCode's own local projects (read-only)
(async () => {
  const list = document.getElementById("projects");
  const projects = await listProjects();
  if (!projects.length) {
    list.append(el("li", { class: "empty", text: "Δεν έχεις φτιάξει ακόμα παιχνίδι. Πάτα «Νέο παιχνίδι»." }));
    return;
  }
  const s = settings();
  if (recordFirstProject(s)) store(s);
  for (const p of projects) {
    const a = el("a", { class: "title", href: `edit.html?project=${encodeURIComponent(p.id)}`, text: p.name || "Χωρίς όνομα" });
    list.append(el("li", { class: "card" }, a, el("span", { class: "meta", text: `Αλλαγή: ${dateEl(Math.max(p.modified, p.recent))}` })));
  }
})();

// «Μαθήματα»
{
  const list = document.getElementById("tutorials");
  for (const t of TUTORIALS) {
    list.append(el("li", { class: "card" },
      el("a", { class: "title", href: `edit.html?tutorial=${encodeURIComponent(t.id)}`, text: t.title }),
      el("span", { class: "meta", text: t.text })));
  }
}

// published from this device: titles from the public list, «Απόσυρση» with the device's token
const status = document.getElementById("pub-status");
const confirmDlg = document.getElementById("confirm");

async function renderPublished() {
  const list = document.getElementById("published");
  list.replaceChildren();
  const s = settings();
  const ids = Object.keys(s.published);
  if (!ids.length) {
    list.append(el("li", { class: "empty", text: "Δεν έχεις δημοσιεύσει ακόμα παιχνίδι από αυτή τη συσκευή." }));
    return;
  }
  let games = [];
  try {
    const r = await fetch("/api/lab/games", { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (r.ok) {
      const body = await r.json();
      games = Array.isArray(body.games) ? body.games : [];
    }
  } catch {
    /* hub not reachable: show the ids only */
  }
  for (const id of ids) {
    const g = games.find((x) => String(x.id) === id);
    const title = g && typeof g.title === "string" ? g.title : `Παιχνίδι ${id}`;
    const play = el("a", { class: "title", href: `../play/?id=${encodeURIComponent(id)}`, text: title });
    const btn = el("button", { type: "button", class: "btn danger", text: "Απόσυρση" });
    btn.addEventListener("click", () => askUnpublish(id, title));
    list.append(el("li", { class: "card" }, play, g ? el("span", { class: "meta", text: dateEl(Date.parse(g.created_at)) }) : null, btn));
  }
}

function askUnpublish(id, title) {
  document.getElementById("confirm-text").textContent = `Το «${title}» θα φύγει από το ράφι του hub. Στη συσκευή σου μένει.`;
  const yes = document.getElementById("confirm-yes");
  const no = document.getElementById("confirm-no");
  const close = () => { yes.onclick = null; no.onclick = null; confirmDlg.close(); };
  no.onclick = close;
  yes.onclick = async () => {
    close();
    await unpublish(id);
  };
  confirmDlg.showModal();
  no.focus();
}

async function unpublish(id) {
  const s = settings();
  const token = s.published[id];
  if (!token) return;
  status.className = "status";
  status.textContent = "Απόσυρση…";
  let r;
  try {
    r = await fetch(`/api/lab/games/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "X-Lab-Unpublish": token },
    });
  } catch {
    status.className = "status error";
    status.textContent = publishErrorText(0);
    return;
  }
  if (r.status === 204 || r.status === 404) {
    store(recordUnpublish(settings(), id));
    status.className = "status ok";
    status.textContent = r.status === 204 ? "Το παιχνίδι αποσύρθηκε από το ράφι." : publishErrorText(404);
    await renderPublished();
  } else {
    status.className = "status error";
    status.textContent = publishErrorText(r.status);
  }
}

renderPublished();
