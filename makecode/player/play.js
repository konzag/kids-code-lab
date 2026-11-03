// Play-only page (spike, SPIKE-REPORT.md §7): loads a compiled game (pxtc BuiltSimJsInfo JSON: js, fnArgs, parts,
// usedBuiltinParts) from the same origin and runs it in the Arcade simulator. In the product the URL would be
// GET /api/lab/games/<id>/binary; here ?src= (same-origin path only).
(async function () {
  const status = document.getElementById("status");
  const src = new URLSearchParams(location.search).get("src") || "game.json";
  const url = new URL(src, location.href);
  if (url.origin !== location.origin) { status.textContent = "Λάθος διεύθυνση παιχνιδιού"; return; }
  const resp = await fetch(url, { credentials: "omit" });
  if (!resp.ok) { status.textContent = "Το παιχνίδι δεν βρέθηκε"; return; }
  const built = await resp.json();
  const driver = new pxsim.SimulatorDriver(document.getElementById("player"), {
    simUrl: new URL("../simulator.html", location.href).toString(),
    onSimulatorReady: () => {},
  });
  driver.run(built.js, {
    fnArgs: built.fnArgs,
    parts: built.parts,
    builtinParts: built.usedBuiltinParts,
    single: true,
    autofocus: true,
  });
  status.textContent = "";
  window.__kclPlayer = driver;
})();
