// KIDS-CODE-LAB: shell keys from inside the sandboxed simulator frame (GAME-STANDARD v1.3 §3: P/Esc stop, M sound,
// F full screen). The frame has an opaque origin and keeps the keyboard focus while a child plays, so the play page
// never sees these keys. This script forwards them, and only them, to the parent page by postMessage; the parent
// accepts the message only from its own frame (event.source) and only in this exact shape.
// - Only on the play page: the player loads simulator.html#kcl-player; in the editor this script does nothing.
// - The key is NOT swallowed (no preventDefault, no stopPropagation): the game still receives it. The Arcade default
//   keymap does not use M, F or Esc; P is Arcade's screenshot key (its message is ignored by the play page).
// - Not while typing (a game's text prompt is an <input>), not with Ctrl/Alt/Meta, not on key repeat.
(function () {
  "use strict";
  if (window.location.hash.indexOf("kcl-player") < 0) return;
  var ACTIONS = { p: "stop", escape: "stop", m: "mute", f: "fullscreen" };
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    var action = ACTIONS[String(e.key).toLowerCase()];
    if (!action) return;
    // "*": this frame cannot name the parent's origin (the parent is the lab's origin, the frame is opaque);
    // the message holds nothing but the action name.
    window.parent.postMessage({ type: "kcl-shell-key", action: action }, "*");
  }, true);
})();
