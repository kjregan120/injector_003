// listener.js — v4: logs frame location, works in embedded iframes across *.disney.go.com/*.go.com
(() => {
  const log = (...args) => console.log("[scanner]", ...args);

  // Announce which frame we're in for debugging
  try {
    log("listener armed for View Rates — frame:", location.href);
  } catch {
    log("listener armed for View Rates — frame: <unknown>");
  }

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

  function runScan() {
    try {
      if (typeof window.__runRangeScan === "function") {
        log("calling window.__runRangeScan()");
        window.__runRangeScan();
        return;
      }
    } catch {}
    const url = chrome.runtime.getURL("scan.js");
    const s = document.createElement("script");
    s.src = url;
    s.async = false;
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
    log("injected scan.js");
  }

  function startScanBurst(reason) {
    log("scan burst start:", reason);
    const delays = [0, 300, 800, 1500, 2500, 4000, 7000, 10000, 15000];
    delays.forEach(ms => setTimeout(runScan, ms));
  }

  // Capture listeners (even inside same-origin iframes)
  document.addEventListener("click", (e) => {
    if (isViewRatesInPath(e)) {
      log("View Rates click detected");
      startScanBurst("click");
    }
  }, true);

  document.addEventListener("keydown", (e) => {
    const k = e.key || e.code;
    if ((k === "Enter" || k === " ") && isViewRatesInPath(e)) {
      log("View Rates key activation detected");
      startScanBurst("key");
    }
  }, true);

  // Fallback: hotkey Alt+R to force a scan burst
  window.addEventListener("keydown", (e) => {
    if (e.altKey && (e.key?.toLowerCase?.() === "r")) {
      log("Alt+R hotkey -> scan burst");
      startScanBurst("hotkey");
    }
  }, true);
})();
