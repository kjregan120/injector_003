// listener.js — robust detection for "View Rates" activation on disneyworld.disney.go.com
(() => {
  // Normalize text helper
  const norm = (s) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();

  function isViewRatesNode(n) {
    if (!n || n.nodeType !== Node.ELEMENT_NODE) return false;
    const el = /** @type {Element} */ (n);
    const tag = el.tagName;
    if (tag === "WDPR-BUTTON" || tag === "BUTTON" || tag === "A" || el.getAttribute("role") === "button") {
      if (el.id === "findPricesButton") return true;
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

  function findViewRatesElement() {
    // Direct lookup (outside shadow roots)
    let el =
      document.getElementById("findPricesButton") ||
      document.querySelector("wdpr-button#findPricesButton") ||
      Array.from(document.querySelectorAll("wdpr-button,button,a,[role='button']"))
        .find((n) => isViewRatesNode(n));
    return el || null;
  }

  function runScan() {
    // Prefer calling an already-present scanner
    try {
      if (typeof window.__runRangeScan === "function") {
        console.log("[scanner] calling window.__runRangeScan()");
        window.__runRangeScan();
        return;
      }
    } catch (_) {}

    // Otherwise inject scan.js into the PAGE context
    const url = chrome.runtime.getURL("scan.js");
    const s = document.createElement("script");
    s.src = url;
    s.async = false;
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
    console.log("[scanner] injected scan.js");
  }

  function runScanWithDelays() {
    // Run immediately and again after a few delays to catch hydrated content
    runScan();
    setTimeout(runScan, 600);
    setTimeout(runScan, 1600);
    setTimeout(runScan, 3200);
  }

  // Global capture listeners (works through shadow DOM via composedPath)
  document.addEventListener(
    "click",
    (e) => {
      if (isViewRatesInPath(e)) {
        console.log("[scanner] View Rates click detected");
        runScanWithDelays();
      }
    },
    true
  );

  document.addEventListener(
    "keydown",
    (e) => {
      const k = e.key || e.code;
      if ((k === "Enter" || k === " ") && isViewRatesInPath(e)) {
        console.log("[scanner] View Rates key activation detected");
        runScanWithDelays();
      }
    },
    true
  );

  // Attach a direct listener when/if the element appears (handles cases where composedPath doesn't include custom element)
  const armDirectListener = () => {
    const btn = findViewRatesElement();
    if (btn && !btn.__scannerArmed) {
      btn.addEventListener("click", () => {
        console.log("[scanner] Direct listener: View Rates clicked");
        runScanWithDelays();
      }, true);
      btn.addEventListener("keydown", (e) => {
        const k = e.key || e.code;
        if (k === "Enter" || k === " ") {
          console.log("[scanner] Direct listener: View Rates key activation");
          runScanWithDelays();
        }
      }, true);
      btn.__scannerArmed = true;
      console.log("[scanner] Direct listener armed on View Rates element");
    }
  };

  // Observe DOM for late insertion
  const mo = new MutationObserver(() => armDirectListener());
  mo.observe(document.documentElement, { subtree: true, childList: true });
  // Try immediately and after short delays
  armDirectListener();
  setTimeout(armDirectListener, 800);
  setTimeout(armDirectListener, 2000);

  // Re-arm on SPA route changes
  ["popstate", "pushState", "replaceState"].forEach((evt) => {
    window.addEventListener(evt, () => setTimeout(armDirectListener, 0));
  });

  // Patch history methods to emit events on SPA navigations
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

  console.log("[scanner] listener armed for View Rates");
})();
