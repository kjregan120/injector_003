// tap.js — pinned to /resorts/grouped-resort-pricing for minimal overhead
(() => {
  const log = (...a) => console.log("[scanner:tap]", ...a);

  // ---- Tunables ----
  const CAPTURE_WINDOW_MS = 6000;     // how long to inspect after arming
  const MAX_MATCHES = 1;              // stop after first hit
  const ENDPOINT_PREFIX = "/resorts/grouped-resort-pricing"; // <— pinned endpoint
  const ALLOW_KEYS = /(check.?in|check.?out|arrival|departure|start(date)?|end(date)?|from|to)/i;

  let armUntil = 0;
  let matches = 0;

  const isArmed = () => Date.now() < armUntil && matches < MAX_MATCHES;

  function urlAllowed(u) {
    try {
      const s = typeof u === "string" ? u : u.href;
      // Accept exact path or path with query
      const url = new URL(s, location.href);
      return url.pathname.startsWith(ENDPOINT_PREFIX);
    } catch { return false; }
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

  // Shallow extractor for allowed keys (top-level + one nested)
  function extractDatesShallow(obj) {
    const hits = [];
    const visit = (k, v) => {
      if (!ALLOW_KEYS.test(String(k))) return;
      const iso = toISO(v);
      if (iso) hits.push({ key: k, value: v, iso });
    };
    try {
      if (obj && typeof obj === "object") {
        for (const [k, v] of Object.entries(obj)) {
          visit(k, v);
          if (v && typeof v === "object" && !Array.isArray(v)) {
            for (const [k2, v2] of Object.entries(v)) visit(k2, v2);
          }
        }
      }
    } catch {}
    return hits;
  }

  function report(source, info) {
    matches++;
    const detail = { source, ...info };
    console.log("[scanner:dates]", detail);
    try {
      window.__scannerNetwork = window.__scannerNetwork || [];
      window.__scannerNetwork.push(detail);
    } catch {}
    if (!isArmed()) armUntil = 0;
  }

  // Arm via postMessage from the content script / listener
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (d && d.__scannerArm === true) {
      armUntil = Date.now() + (Number(d.ms) || CAPTURE_WINDOW_MS);
      matches = 0;
      log("armed for", (armUntil - Date.now()), "ms (endpoint pinned:", ENDPOINT_PREFIX, ")");
    }
  }, true);

  // Hooks
  try {
    const _fetch = window.fetch;
    window.fetch = async function(input, init) {
      if (!isArmed()) return _fetch.apply(this, arguments);
      const req = new Request(input, init);
      if (!urlAllowed(req.url)) return _fetch.apply(this, arguments);

      try {
        const url = new URL(req.url);
        const params = Object.fromEntries(url.searchParams.entries());
        const qpHits = extractDatesShallow(params);
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
              const bodyHits = extractDatesShallow(body);
              if (bodyHits.length) report("fetch:body", { url: req.url, hits: bodyHits });
            }
          }
        } catch {}
      }
      return _fetch.apply(this, arguments);
    };
    log("fetch hook ready (pinned)");
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
        if (info.url && urlAllowed(info.url)) {
          try {
            const u = new URL(info.url, location.href);
            const params = Object.fromEntries(u.searchParams.entries());
            const qpHits = extractDatesShallow(params);
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
            const hits = extractDatesShallow(parsed);
            if (hits.length) report("xhr:body", { url: info.url || "<unknown>", hits });
          }
        }
      } catch {}
      return _send.apply(this, arguments);
    };
    log("xhr hook ready (pinned)");
  } catch (e) {
    log("xhr hook failed", e);
  }

  try {
    const _post = window.postMessage;
    window.postMessage = function(message, targetOrigin, transfer) {
      if (isArmed() && message && typeof message === "object") {
        const hits = extractDatesShallow(message);
        if (hits.length) report("postMessage:out", { targetOrigin, hits });
      }
      return _post.apply(this, arguments);
    };
    window.addEventListener("message", (ev) => {
      if (!isArmed()) return;
      const data = ev.data;
      if (data && typeof data === "object") {
        const hits = extractDatesShallow(data);
        if (hits.length) report("postMessage:in", { origin: ev.origin, hits });
      }
    }, true);
    log("postMessage hook ready (pinned)");
  } catch (e) {
    log("postMessage hook failed", e);
  }
})();
