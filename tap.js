// tap.js — discovery + pinned endpoint support with pre-arm across navigations
(() => {
  const log = (...a) => console.log("[scanner:tap]", ...a);

  // ---- CONFIG ----
  const CAPTURE_WINDOW_MS = 12000;     // arm duration
  const MAX_MATCHES = 1;               // stop after first hit
  const PINNED_SUBSTRING = "/resorts/grouped-resort-pricing"; // try this first, but allow discovery if no hit
  const DISCOVERY_LIMIT_URLS = 50;     // during an arm window, at most this many URLs logged (paths only, no bodies)
  const MAX_OBJECT_DEPTH = 3;          // deeper search, still bounded
  const KEY_REGEX = /(check.?in|check.?out|arrival|departure|start(date)?|end(date)?|from(date)?|to(date)?)/i;
  const KEY_WHITELIST = ["checkInDate","checkOutDate","checkin","checkout","arrivalDate","departureDate","startDate","endDate","from","to","dateFrom","dateTo"];

  // ---- State ----
  let armUntil = 0;
  let matches = 0;
  let learnedEndpoint = null;
  let learnedKeys = null;
  const seenUrls = new Set(); // for discovery summary

  // Pre-arm: if sessionStorage flag set by listener (to handle navigations)
  try {
    const pre = sessionStorage.getItem("scanner.prearmUntil");
    if (pre && Number(pre) > Date.now()) {
      armUntil = Number(pre);
      log("pre-armed from previous page for", Math.max(0, armUntil - Date.now()), "ms");
    }
  } catch {}

  // Learn persisted per-tab
  try {
    learnedEndpoint = sessionStorage.getItem("scanner.endpoint") || null;
    const keysJson = sessionStorage.getItem("scanner.keys");
    learnedKeys = keysJson ? JSON.parse(keysJson) : null;
  } catch {}

  const isArmed = () => Date.now() < armUntil && matches < MAX_MATCHES;

  // Decide if URL should be inspected
  function urlAllowed(u) {
    try {
      const s = typeof u === "string" ? u : u.href;
      const url = new URL(s, location.href);
      const path = url.pathname.toLowerCase();
      if (learnedEndpoint) return (url.origin + url.pathname).startsWith(learnedEndpoint);
      if (PINNED_SUBSTRING && path.includes(PINNED_SUBSTRING.toLowerCase())) return true;
      // In discovery mode, allow anything under disney/go.com, but we won't parse bodies unless armed.
      return /\.go\.com$/i.test(url.hostname) || /disney/i.test(url.hostname);
    } catch { return false; }
  }

  function keyAllowed(k) {
    if (!k) return false;
    if (learnedKeys && learnedKeys.length) return learnedKeys.includes(k);
    if (KEY_WHITELIST.includes(k)) return true;
    return KEY_REGEX.test(String(k));
  }

  const toISO = (v) => {
    if (v == null) return null;
    if (typeof v === "number") {
      const ms = v > 1e12 ? v : v * 1000;
      const d = new Date(ms);
      return isNaN(+d) ? null : d.toISOString();
    }
    if (typeof v === "string") {
      const s = v.trim();
      const n = Number(s);
      if (!Number.isNaN(n) && Number.isFinite(n)) return toISO(n);
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const d = new Date(s);
        return isNaN(+d) ? null : d.toISOString();
      }
      const d = new Date(s);
      return isNaN(+d) ? null : d.toISOString();
    }
    return null;
  };

  function extractDates(obj, depth = 0) {
    const hits = [];
    const visit = (k, v) => {
      if (!keyAllowed(k)) return;
      const iso = toISO(v);
      if (iso) hits.push({ key: k, value: v, iso });
    };
    try {
      if (obj && typeof obj === "object" && depth <= MAX_OBJECT_DEPTH) {
        for (const [k, v] of Object.entries(obj)) {
          visit(k, v);
          if (v && typeof v === "object" && !Array.isArray(v)) {
            const nestedHits = extractDates(v, depth + 1);
            for (const h of nestedHits) hits.push(h);
          }
        }
      }
    } catch {}
    return hits;
  }

  function noteUrl(u) {
    try {
      const url = new URL(u, location.href);
      const key = url.origin + url.pathname;
      if (seenUrls.size < DISCOVERY_LIMIT_URLS) seenUrls.add(key);
    } catch {}
  }

  function discoverySummary() {
    if (seenUrls.size) {
      console.table(Array.from(seenUrls).map(u => ({ endpoint: u })));
      log("Discovery summary: endpoints seen during arm window (paths only). If no dates captured, tell me which one carries the dates.");
    }
  }

  function report(source, info) {
    matches++;
    const detail = { source, ...info };
    console.log("[scanner:dates]", detail);

    // Learn and persist
    try {
      if (!learnedEndpoint && info && info.url) {
        const u = new URL(info.url, location.href);
        learnedEndpoint = u.origin + u.pathname;
        sessionStorage.setItem("scanner.endpoint", learnedEndpoint);
      }
      if (!learnedKeys && info && Array.isArray(info.hits) && info.hits.length) {
        learnedKeys = Array.from(new Set(info.hits.map(h => h.key))).slice(0, 6);
        sessionStorage.setItem("scanner.keys", JSON.stringify(learnedKeys));
      }
      if (learnedEndpoint || learnedKeys) {
        log("learned filters:", { learnedEndpoint, learnedKeys });
      }
    } catch {}

    try {
      window.__scannerNetwork = window.__scannerNetwork || [];
      window.__scannerNetwork.push(detail);
    } catch {}

    if (!isArmed()) {
      armUntil = 0;
      log("disarmed");
    }
  }

  // Arm via postMessage
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (d && d.__scannerArm === true) {
      const ms = Number(d.ms) || CAPTURE_WINDOW_MS;
      armUntil = Date.now() + ms;
      matches = 0;
      seenUrls.clear();
      log("armed for", ms, "ms", learnedEndpoint ? "(learned filters active)" : "(pinned/discovery)");
      setTimeout(() => {
        if (isArmed()) return; // will disarm on hit
        discoverySummary();
      }, ms + 50);
    }
    if (d && d.__scannerReset === true) {
      sessionStorage.removeItem("scanner.endpoint");
      sessionStorage.removeItem("scanner.keys");
      learnedEndpoint = null;
      learnedKeys = null;
      log("learned filters cleared");
    }
  }, true);

  // Hooks
  try {
    const _fetch = window.fetch;
    window.fetch = async function(input, init) {
      if (!isArmed()) return _fetch.apply(this, arguments);
      const req = new Request(input, init);
      if (!urlAllowed(req.url)) { noteUrl(req.url); return _fetch.apply(this, arguments); }

      noteUrl(req.url);
      try {
        const url = new URL(req.url);
        const params = Object.fromEntries(url.searchParams.entries());
        const qpHits = extractDates(params);
        if (qpHits.length) report("fetch:query", { url: url.href, hits: qpHits });
      } catch {}

      if ((req.method || "GET").toUpperCase() !== "GET") {
        try {
          const clone = req.clone();
          const text = await clone.text();
          if (text) {
            let body;
            try { body = JSON.parse(text); } catch {}
            if (!body && text.includes("=")) {
              const usp = new URLSearchParams(text);
              body = Object.fromEntries(usp.entries());
            }
            if (body) {
              const bodyHits = extractDates(body);
              if (bodyHits.length) report("fetch:body", { url: req.url, hits: bodyHits });
            }
          }
        } catch {}
      }
      return _fetch.apply(this, arguments);
    };
    log("fetch hook ready");
  } catch (e) {
    log("fetch hook failed", e);
  }

  try {
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__tap = { method, url };
      return _open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      if (!isArmed()) return _send.apply(this, arguments);
      try {
        const info = this.__tap || {};
        if (info.url) {
          if (!urlAllowed(info.url)) { noteUrl(info.url); return _send.apply(this, arguments); }
          noteUrl(info.url);
          try {
            const u = new URL(info.url, location.href);
            const params = Object.fromEntries(u.searchParams.entries());
            const qpHits = extractDates(params);
            if (qpHits.length) report("xhr:query", { url: u.href, hits: qpHits });
          } catch {}
        }
        if (body && info.url && urlAllowed(info.url)) {
          let parsed = null;
          if (typeof body === "string") {
            try { parsed = JSON.parse(body); } catch {}
            if (!parsed && body.includes("=")) {
              const usp = new URLSearchParams(body);
              parsed = Object.fromEntries(usp.entries());
            }
          } else if (body instanceof URLSearchParams) {
            parsed = Object.fromEntries(body.entries());
          }
          if (parsed) {
            const hits = extractDates(parsed);
            if (hits.length) report("xhr:body", { url: info.url || "<unknown>", hits });
          }
        }
      } catch {}
      return _send.apply(this, arguments);
    };
    log("xhr hook ready");
  } catch (e) {
    log("xhr hook failed", e);
  }

  try {
    const _post = window.postMessage;
    window.postMessage = function(message, targetOrigin, transfer) {
      if (isArmed() && message && typeof message === "object") {
        const hits = extractDates(message);
        if (hits.length) report("postMessage:out", { targetOrigin, hits });
      }
      return _post.apply(this, arguments);
    };
    window.addEventListener("message", (ev) => {
      if (!isArmed()) return;
      const data = ev.data;
      if (data && typeof data === "object") {
        const hits = extractDates(data);
        if (hits.length) report("postMessage:in", { origin: ev.origin, hits });
      }
    }, true);
    log("postMessage hook ready");
  } catch (e) {
    log("postMessage hook failed", e);
  }

  // Expose helpers
  try {
    window.__scannerLearned = () => ({ learnedEndpoint, learnedKeys, armUntil });
    window.__scannerReset = () => window.postMessage({ __scannerReset: true }, "*");
  } catch {}
})();
