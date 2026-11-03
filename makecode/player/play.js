// Play-only page: runs one published game in the Arcade simulator, without the editor.
//
// Security model (docs/BUILD.md "Player security"): a published game is compiled JavaScript made by a child in the
// editor; the hub only trusts it as "a game the family published". So:
// - the page takes ONLY ?id=<1-9 digits> and builds the URL itself (GET /api/lab/games/<id>/binary); no other
//   parameter, no free path, no absolute URL;
// - the game runs in <iframe sandbox="allow-scripts"> WITHOUT allow-same-origin: the frame has an opaque origin,
//   so the game cannot read the hub's cookies or localStorage, nor call /api/* with the family's unlock session;
// - this page and the frame talk only by postMessage; messages from anything but that frame's window are ignored
//   and the few message types used here are checked for shape.
// This page itself needs no 'unsafe-eval' and loads no MakeCode script (only the frame runs pxtsim.js + sim.js).
(function () {
  "use strict";
  var ID_RE = /^[0-9]{1,9}$/;
  var GAME_URL = function (id) { return "/api/lab/games/" + id + "/binary"; };
  var SIM_URL = "../simulator.html";

  var status = document.getElementById("status");
  var player = document.getElementById("player");
  function say(text) { status.textContent = text; }

  // exactly one parameter, "id", made of 1-9 digits
  var params = new URLSearchParams(location.search);
  var keys = Array.from(params.keys());
  var id = params.get("id");
  if (keys.length !== 1 || keys[0] !== "id" || !id || !ID_RE.test(id)) {
    say("Αυτό το παιχνίδι δεν υπάρχει. Γύρνα στο ράφι και διάλεξε ένα παιχνίδι.");
    return;
  }

  function validGame(g) {
    return g && typeof g === "object" && typeof g.js === "string" && g.js.length > 0 &&
      (g.fnArgs === undefined || (typeof g.fnArgs === "object" && g.fnArgs !== null)) &&
      (g.parts === undefined || Array.isArray(g.parts)) &&
      (g.usedBuiltinParts === undefined || Array.isArray(g.usedBuiltinParts));
  }

  var frame = null;
  var game = null;
  var runs = 0;

  function postRun() {
    runs += 1;
    // the "run" message of pxsim's SimulatorDriver, reduced to what a single Arcade game needs
    frame.contentWindow.postMessage({
      type: "run",
      source: "pxtdriver",
      id: "kcl-" + runs,
      frameCounter: runs,
      code: game.js,
      fnArgs: game.fnArgs,
      parts: game.parts || [],
      builtinParts: game.usedBuiltinParts || [],
      single: true,
      options: { theme: "green" },
    }, "*"); // the frame's origin is opaque ("null"); the target is pinned by the window reference
  }

  function onMessage(ev) {
    if (!frame || ev.source !== frame.contentWindow) return; // only our simulator frame
    var msg = ev.data;
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
    if (msg.type === "ready") {
      postRun();
      enableShell();
    } else if (msg.type === "simulator" && (msg.command === "restart" || msg.command === "reload")) {
      postRun(); // the console's restart button
    }
    // everything else (status, serial, audio state, screenshots...) is ignored
  }

  // ---------- hub shell buttons: ⏸ pause, 🔊 sound, ⛶ full screen, 🏠 back to the games ----------
  var pauseBtn = document.getElementById("pause");
  var muteBtn = document.getElementById("mute");
  var fullBtn = document.getElementById("full");
  var paused = false;
  var muted = false;
  function post(msg) { if (frame) frame.contentWindow.postMessage(msg, "*"); }
  function enableShell() {
    pauseBtn.disabled = false;
    muteBtn.disabled = false;
  }
  pauseBtn.addEventListener("click", function () {
    paused = !paused;
    // The MakeCode simulator has no pause message (its debugger pause needs a debug build, and the Arcade
    // "TogglePause" key only flips an unused flag): ⏸ stops the game, ▶ starts it again from the beginning.
    // A real pause inside the game is its own «Menu» button (Arcade system menu).
    if (paused) post({ type: "stop", source: "pxtdriver" });
    else postRun();
    pauseBtn.setAttribute("aria-pressed", String(paused));
    pauseBtn.firstChild.textContent = paused ? "▶" : "⏸";
    pauseBtn.title = paused ? "Ξανά από την αρχή" : "Σταμάτημα";
    pauseBtn.querySelector(".sr").textContent = paused ? "Ξανά από την αρχή" : "Σταμάτημα";
    say(paused ? "Το παιχνίδι σταμάτησε. Πάτα ▶ για να ξεκινήσει ξανά από την αρχή." : "");
    if (!paused && frame) frame.focus();
  });
  muteBtn.addEventListener("click", function () {
    muted = !muted;
    post({ type: "mute", mute: muted, source: "pxtdriver" });
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.firstChild.textContent = muted ? "🔇" : "🔊";
    muteBtn.querySelector(".sr").textContent = muted ? "Ήχος" : "Σίγαση";
    if (frame) frame.focus();
  });
  fullBtn.addEventListener("click", function () {
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
  });

  fetch(GAME_URL(id), { credentials: "omit", cache: "no-cache", headers: { Accept: "application/json" } })
    .then(function (resp) {
      if (!resp.ok) throw new Error("http " + resp.status);
      return resp.json();
    })
    .then(function (g) {
      if (!validGame(g)) throw new Error("shape");
      game = g;
      window.addEventListener("message", onMessage);
      frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("allow", "autoplay");
      frame.setAttribute("title", "Παιχνίδι");
      frame.src = SIM_URL + "#kcl-player";
      player.appendChild(frame);
      say("");
      frame.focus();
    })
    .catch(function () {
      say("Δεν μπόρεσα να φορτώσω το παιχνίδι. Δοκίμασε ξανά αργότερα.");
    });
})();
