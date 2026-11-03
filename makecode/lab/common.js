// KIDS-CODE-LAB: shared DOM helpers of the lab pages (theme switch, settings access, small DOM builders).
import { loadSettings, saveSettings, THEMES } from "./core.js";

export function settings() {
  return loadSettings(window.localStorage);
}
export function store(s) {
  return saveSettings(window.localStorage, s);
}

/** Applies the remembered theme, else the system preference; wires the switch button (aria-pressed = dark). */
export function initTheme(button) {
  const apply = () => {
    const s = settings();
    const dark = s.theme ? s.theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    if (button) {
      button.setAttribute("aria-pressed", String(dark));
      button.textContent = dark ? "☀️ Φωτεινό" : "🌙 Σκοτεινό";
    }
  };
  apply();
  if (button) {
    button.addEventListener("click", () => {
      const s = settings();
      const dark = document.documentElement.dataset.theme === "dark";
      s.theme = THEMES[dark ? 0 : 1];
      store(s);
      apply();
    });
  }
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", apply);
}

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "text") e.textContent = v;
    else if (k === "class") e.className = v;
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c) e.append(c);
  return e;
}

export function dateEl(ms) {
  if (!ms) return "";
  const d = new Date(ms > 1e12 ? ms : ms * 1000);
  return d.toLocaleDateString("el-GR", { day: "numeric", month: "long", year: "numeric" });
}
