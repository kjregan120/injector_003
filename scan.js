// scan.js — v3: aggressive candidate discovery, richer logs, longer retries
(() => {
  const log = (...args) => console.log("[scanner]", ...args);

  function* iterAllNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      yield /** @type {Element} */ (node);
      const sr = /** @type {Element} */ (node).shadowRoot;
      if (sr) {
        yield* iterAllNodes(sr);
      }
      node = walker.nextNode();
    }
  }

  const toISO = (sec) => (sec && !Number.isNaN(sec) ? new Date(sec * 1000).toISOString() : null);

  function pickNumericAttr(el, names) {
    for (const n of names) {
      if (el.hasAttribute && el.hasAttribute(n)) {
        const v = Number(el.getAttribute(n));
        if (!Number.isNaN(v) && Number.isFinite(v)) return v;
      }
    }
    return null;
  }

  function scanDocument(doc, frameUrl, out, dbg) {
    try {
      for (const el of iterAllNodes(doc)) {
        const tag = el.tagName?.toLowerCase?.() || "";
        const attrs = el.getAttributeNames ? el.getAttributeNames() : [];
        const attrStr = attrs.join(",");
        const hasKnownAttrs = attrs.includes("date-from") && attrs.includes("date-to");
        const hasAltAttrs = (attrs.includes("data-from") && attrs.includes("data-to")) ||
                            (attrs.includes("from") && attrs.includes("to")) ||
                            (attrs.includes("start") && attrs.includes("end"));
        const aria = el.getAttribute?.("aria-label") || "";
        const looksLikeCheckRange =
          /check.?in|check.?out|date.?range/i.test(aria) ||
          /(date-?(from|to)|data-?(from|to)|from|to|start|end)/i.test(attrStr);

        const qualifies = tag === "range-datepicker-cell" || hasKnownAttrs || hasAltAttrs || looksLikeCheckRange;

        if (qualifies) {
          const sSec = pickNumericAttr(/** @type {Element} */ (el), ["date-from", "data-from", "from", "start"]);
          const eSec = pickNumericAttr(/** @type {Element} */ (el), ["date-to", "data-to", "to", "end"]);
          const candidate = {
            frameUrl,
            tag,
            id: (/** @type {Element} */ (el)).id || null,
            attrs: attrStr,
            aria,
            startSec: sSec,
            endSec: eSec,
            startUTC: toISO(sSec),
            endExclusiveUTC: toISO(eSec),
            endInclusiveUTC: eSec ? new Date(eSec * 1000 - 1).toISOString() : null,
            days: sSec && eSec ? Math.max(1, Math.round((eSec - sSec) / 86400)) : null,
          };
          out.candidates.push(candidate);
          if (sSec || eSec) out.all.push(candidate);
        }
      }
    } catch (err) {
      console.warn("[scanner] scanDocument error:", err);
    }
  }

  async function runRangeScan() {
    log("runRangeScan started");
    const out = { all: [], candidates: [], unique: [], blocked: [], stats: {} };

    const t0 = performance.now();
    scanDocument(document, location.href, out);

    for (const frame of Array.from(document.querySelectorAll("iframe"))) {
      try {
        const src = frame.src || "about:blank";
        const doc = frame.contentDocument;
        if (doc) scanDocument(doc, src, out);
      } catch (err) {
        const blocked = { src: frame.src || null, reason: String(err) };
        try { blocked.sandbox = frame.getAttribute("sandbox") || null; } catch {}
        try { blocked.referrerpolicy = frame.getAttribute("referrerpolicy") || null; } catch {}
        out.blocked.push(blocked);
      }
    }
    const t1 = performance.now();
    out.stats.scanMs = Math.round(t1 - t0);
    out.stats.totalCandidates = out.candidates.length;
    out.stats.totalWithNumbers = out.all.length;

    const key = r => `${r.startSec}-${r.endSec}`;
    const map = new Map();
    for (const r of out.all) {
      const k = key(r);
      if (!map.has(k)) map.set(k, { ...r, count: 1 });
      else map.get(k).count++;
    }
    out.unique = Array.from(map.values()).sort((a, b) => (b.count || 0) - (a.count || 0));

    // Logs
    log(`scan finished in ${out.stats.scanMs}ms; candidates=${out.stats.totalCandidates}; withNumbers=${out.stats.totalWithNumbers}`);

    if (out.unique.length) {
      console.table(
        out.unique.map(({ frameUrl, tag, id, startUTC, endInclusiveUTC, days, count }) => ({
          frameUrl, tag, id, startUTC, endInclusiveUTC, days, count
        }))
      );
      log("Most common range:", out.unique[0]);
    } else {
      log("No elements with numeric date-from/to found.");
      // Print top 5 candidates (by having promising attrs) to aid debugging
      const sample = out.candidates.slice(0, 5).map(c => ({
        frameUrl: c.frameUrl,
        tag: c.tag,
        id: c.id,
        attrs: c.attrs,
        aria: c.aria?.slice(0,120) || null
      }));
      if (sample.length) {
        console.table(sample);
        log("Shown up to 5 candidate elements that look like date range containers (but without numeric epoch attributes).");
      }
    }

    if (out.blocked.length) {
      console.table(out.blocked);
    }

    window.__pickerRanges = out;

    if (out.all.length === 0) {
      // Longer retry window
      const START = Date.now();
      const MAX_MS = 16000;
      let timer = null;

      const runDebounced = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          runRangeScan();
        }, 250);
      };

      const obs = new MutationObserver(runDebounced);
      obs.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
      });

      // Seed a few retries
      [600, 1600, 3200, 6000, 10000, 14000].forEach(ms => setTimeout(() => {
        if (Date.now() - START < MAX_MS) runRangeScan();
      }, ms));

      setTimeout(() => obs.disconnect(), MAX_MS);
    }

    return window.__pickerRanges;
  }

  // Expose debugging helpers
  try {
    window.__runRangeScan = runRangeScan;
    window.__debugScanCandidates = () => (window.__pickerRanges?.candidates || []);
  } catch {}

  // Also auto-run when this file is injected
  runRangeScan();
})();
