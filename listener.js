// listener.js — v3 robust hooks for "View Rates" and follow-on async UI/network
(() => {
  const log = (...args) => console.log("[scanner]", ...args);
  const norm = (s) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();

  function isViewRatesNode(n) {
    if (!n || n.nodeType !== Node.ELEMENT_NODE) return false;
    const el = /** @type {Element} */ (n);
    if (el.id === "findPricesButton") return true;
    const tag = el.tagName;
    if (tag === "WDPR-BUTTON" || tag === "BUTTON" || tag === "A" || el.getAttribute("role") === "button") {
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
    } catch (_) {}
    const url = chrome.runtime.getURL("scan.js");
    const s = document.createElement("script");
    s.src = url;
    s.async = false;
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
    log("injected scan.js");
  }

  function startScanBurst(label) {
    log("scan burst start:", label);
    const delays = [0, 300, 800, 1500, 2500, 4000, 7000, 10000, 15000];
    delays.forEach(ms => setTimeout(runScan, ms));

    // Patch fetch and XHR for ~10s to run scan after responses (new content)
    const until = Date.now() + 10000;
    try {
      const _fetch = window.fetch;
      window.fetch = async function() {
        const res = await _fetch.apply(this, arguments);
        if (Date.now() < until) setTimeout(runScan, 120);
        return res;
      };
    } catch {}
    try {
      const _open = XMLHttpRequest.prototype.open;
      const _send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(){ this.__scanner = true; return _open.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function(){
        if (this.__scanner) this.addEventListener("loadend", () => { if (Date.now() < until) setTimeout(runScan, 120); });
        return _send.apply(this, arguments);
      };
    } catch {}

    // Watch for dialogs/modals opening
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n && n.nodeType === Node.ELEMENT_NODE) {
            const el = /** @type {Element} */ (n);
            if (el.getAttribute("role") === "dialog" || el.getAttribute("aria-modal") === "true") {
              log("dialog detected -> scan");
              runScan();
            }
          }
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 15000);
  }

  // Global capture listeners
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

  // SPA navigation support: re-arm after route changes
  const rearm = () => log("listener armed for View Rates");
  ["popstate", "pushState", "replaceState"].forEach((evt) => {
    window.addEventListener(evt, rearm);
  });
  const _ps = history.pushState;
  history.pushState = function () {
    const r = _ps.apply(this, arguments);
    window.dispatchEvent(new Event("pushState"));
    return r;
  };
  const _rs = history.replaceState;
  history.replaceState = function () {
    const r = _rs.apply(this, arguments);
    window.dispatchEvent(new Event("replaceState"));
    return r;
  };

  rearm();
})();
