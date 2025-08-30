// scan.js — exposes window.__runRangeScan and also runs immediately when injected
(() => {
  function* iterAllNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      yield /** @type {Element} */ (node);
      // Recurse into shadow roots if present
      // (we depth-first traverse by pushing a new walker for the shadow root)
      const sr = /** @type {Element} */ (node).shadowRoot;
      if (sr) {
        yield* iterAllNodes(sr);
      }
      node = walker.nextNode();
    }
  }

  function toISO(sec) {
    return sec && !Number.isNaN(sec) ? new Date(sec * 1000).toISOString() : null;
  }

  function scanDocument(doc, frameUrl, out) {
    try {
      for (const el of iterAllNodes(doc)) {
        const tag = el.tagName?.toLowerCase?.() || "";
        const hasRangeAttrs =
          (/** @type {Element} */ (el)).hasAttribute?.("date-from") &&
          (/** @type {Element} */ (el)).hasAttribute?.("date-to");

        if (tag === "range-datepicker-cell" || hasRangeAttrs) {
          const sSec = Number((/** @type {Element} */ (el)).getAttribute("date-from"));
          const eSec = Number((/** @type {Element} */ (el)).getAttribute("date-to")); // often exclusive
          out.all.push({
            frameUrl,
            tag,
            id: (/** @type {Element} */ (el)).id || null,
            startSec: sSec,
            endSec: eSec,
            startUTC: toISO(sSec),
            endExclusiveUTC: toISO(eSec),
            endInclusiveUTC: eSec ? new Date(eSec * 1000 - 1).toISOString() : null,
            days:
              sSec && eSec
                ? Math.max(1, Math.round((eSec - sSec) / 86400))
                : null,
          });
        }
      }
    } catch (err) {
      console.warn("[scanner] scanDocument error:", err);
    }
  }

  async function runRangeScan() {
    console.log("[scanner] runRangeScan started");
    const out = { all: [], unique: [], blocked: [] };

    // Scan root document
    scanDocument(document, location.href, out);

    // Scan accessible iframes
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

    const key = r => `${r.startSec}-${r.endSec}`;
    const map = new Map();
    for (const r of out.all) {
      const k = key(r);
      if (!map.has(k)) map.set(k, { ...r, count: 1 });
      else map.get(k).count++;
    }
    out.unique = Array.from(map.values()).sort((a, b) => (b.count || 0) - (a.count || 0));

    // Console output
    if (out.unique.length) {
      console.table(
        out.unique.map(
          ({ frameUrl, tag, id, startUTC, endInclusiveUTC, days, count }) => ({
            frameUrl,
            tag,
            id,
            startUTC,
            endInclusiveUTC,
            days,
            count,
          })
        )
      );
      console.log("[scanner] Most common range:", out.unique[0]);
    } else {
      console.log("[scanner] No date-range elements found (yet).");
    }

    if (out.blocked.length) {
      console.table(out.blocked);
    }

    // Stash for inspection
    window.__pickerRanges = out;

    // If we found nothing yet, retry briefly while app hydrates
    if (out.all.length === 0) {
      const START = Date.now();
      const MAX_MS = 6000;
      let timer = null;

      const runDebounced = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const out2 = { all: [], unique: [], blocked: [] };
          scanDocument(document, location.href, out2);
          for (const frame of Array.from(document.querySelectorAll("iframe"))) {
            try {
              const src = frame.src || "about:blank";
              const doc = frame.contentDocument;
              if (doc) scanDocument(doc, src, out2);
            } catch (err) {
              const blocked = { src: frame.src || null, reason: String(err) };
              try { blocked.sandbox = frame.getAttribute("sandbox") || null; } catch {}
              try { blocked.referrerpolicy = frame.getAttribute("referrerpolicy") || null; } catch {}
              out2.blocked.push(blocked);
            }
          }
          const m2 = new Map();
          for (const r of out2.all) {
            const k = key(r);
            if (!m2.has(k)) m2.set(k, { ...r, count: 1 });
            else m2.get(k).count++;
          }
          out2.unique = Array.from(m2.values()).sort((a, b) => (b.count || 0) - (a.count || 0));

          if (out2.unique.length) {
            console.table(
              out2.unique.map(({ frameUrl, tag, id, startUTC, endInclusiveUTC, days, count }) => ({
                frameUrl, tag, id, startUTC, endInclusiveUTC, days, count
              }))
            );
            console.log("[scanner] Most common range:", out2.unique[0]);
            if (out2.blocked.length) console.table(out2.blocked);
            window.__pickerRanges = out2;
            obs.disconnect();
          } else if (Date.now() - START > MAX_MS) {
            obs.disconnect();
          }
        }, 150);
      };

      const obs = new MutationObserver(runDebounced);
      obs.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
      });

      setTimeout(runDebounced, 500);
      setTimeout(runDebounced, 1500);
      setTimeout(runDebounced, 3000);
      setTimeout(runDebounced, 5000);
    }

    return window.__pickerRanges;
  }

  // Expose callable entrypoint
  try { window.__runRangeScan = runRangeScan; } catch {}

  // Also auto-run when this file is injected
  runRangeScan();
})();
