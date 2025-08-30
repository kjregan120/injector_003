// listener.js — sets pre-arm flag across navigation and arms on View Rates
(() => {
  const log = (...args) => console.log("[scanner]", ...args);
  const norm = (s) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();

  function isViewRatesNode(n) {
    if (!n || n.nodeType !== Node.ELEMENT_NODE) return false;
    const el = /** @type {Element} */ (n);
    if (el.id === "findPricesButton") return true;
    const roleIsButton = el.getAttribute("role") === "button";
    const tag = el.tagName;
    if (tag === "WDPR-BUTTON" || tag === "BUTTON" || tag === "A" || roleIsButton) {
      const txt = norm(el.textContent);
      if (/view rates/.test(txt)) return true;
    }
    return false;
  }

  function isViewRatesInPath(e) {
    if (!e || typeof e.composedPath !== "function") return false;
    const path = e.composedPath();
    return path.some(isViewRatesNode);
  }

  function arm(reason) {
    // Arm now
    window.postMessage({ __scannerArm: true, ms: 12000 }, "*");
    // Pre-arm next page (handle SPA route or full navigation)
    try {
      sessionStorage.setItem("scanner.prearmUntil", String(Date.now() + 12000));
    } catch {}
    log("armed network/message capture for 12s due to", reason, "(and pre-armed next page)");
  }

  document.addEventListener("click", (e) => {
    if (isViewRatesInPath(e)) arm("click");
  }, true);

  document.addEventListener("keydown", (e) => {
    const k = e.key || e.code;
    if ((k === "Enter" || k === " ") && isViewRatesInPath(e)) arm("key");
  }, true);

  try { log("listener armed for View Rates — frame:", location.href); } catch { log("listener armed for View Rates"); }
})();
