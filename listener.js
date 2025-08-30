// listener.js — auto-runs on disneyworld.disney.go.com
// When the <wdpr-button id="findPricesButton"> is activated, run the scanner.

(() => {
  function isViewRatesInPath(e) {
    if (!e || typeof e.composedPath !== "function") return false;
    const path = e.composedPath();
    return path.some(
      n =>
        n &&
        n.nodeType === Node.ELEMENT_NODE &&
        n.tagName === "WDPR-BUTTON" &&
        n.id === "findPricesButton"
    );
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

  // Mouse/touch activation
  document.addEventListener(
    "click",
    (e) => {
      if (isViewRatesInPath(e)) runScan();
    },
    true // capture to traverse custom element/shadow boundaries reliably
  );

  // Keyboard activation (Enter/Space)
  document.addEventListener(
    "keydown",
    (e) => {
      const k = e.key || e.code;
      if ((k === "Enter" || k === " ") && isViewRatesInPath(e)) runScan();
    },
    true
  );

  console.log("[scanner] listener armed for View Rates");
})();
