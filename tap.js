// tap.js — PAGE CONTEXT: hook fetch, XHR, postMessage to surface check-in/out dates
(() => {
  const log = (...args) => console.log("[scanner:tap]", ...args);
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

  function extractDates(obj) {
    const hits = [];
    const visit = (k, v) => {
      const key = (k || "").toLowerCase();
      if (/check.?in|arrival|start(date)?|from/.test(key) || /check.?out|depart|end(date)?|to/.test(key)) {
        const iso = toISO(v);
        if (iso) hits.push({ key, value: v, iso });
      }
    };
    try {
      const stack = [{ k: "", v: obj }];
      const seen = new WeakSet();
      while (stack.length) {
        const { k, v } = stack.pop();
        if (v && typeof v === "object") {
          if (seen.has(v)) continue;
          seen.add(v);
          if (Array.isArray(v)) {
            v.forEach((x, i) => stack.push({ k: `${k}[${i}]`, v: x }));
          } else {
            for (const [kk, vv] of Object.entries(v)) {
              visit(kk, vv);
              if (vv && typeof vv === "object") stack.push({ k: kk, v: vv });
            }
          }
        } else {
          visit(k, v);
        }
      }
    } catch {}
    return hits;
  }

  function report(source, info) {
    const detail = { source, ...info };
    console.log("[scanner:dates]", detail);
    try {
      window.__scannerNetwork = window.__scannerNetwork || [];
      window.__scannerNetwork.push(detail);
    } catch {}
  }

  // Hook fetch
  try {
    const _fetch = window.fetch;
    window.fetch = async function(input, init) {
      const req = new Request(input, init);
      try {
        const url = new URL(req.url);
        const params = Object.fromEntries(url.searchParams.entries());
        const qpHits = extractDates(params);
        if (qpHits.length) report("fetch:query", { url: url.href, hits: qpHits });
      } catch {}

      if (req.method !== "GET") {
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
              if (bodyHits.length) report("fetch:body", { url: req.url, hits: bodyHits, body });
            }
          }
        } catch {}
      }

      return _fetch.apply(this, arguments);
    };
    log("fetch hooked");
  } catch (e) {
    log("fetch hook failed", e);
  }

  // Hook XHR
  try {
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__tap = { method, url };
      return _open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      try {
        const info = this.__tap || {};
        if (info.url) {
          try {
            const u = new URL(info.url, location.href);
            const params = Object.fromEntries(u.searchParams.entries());
            const qpHits = extractDates(params);
            if (qpHits.length) report("xhr:query", { url: u.href, hits: qpHits });
          } catch {}
        }
        if (body) {
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
            if (hits.length) report("xhr:body", { url: info.url || "<unknown>", hits, body: parsed });
          }
        }
      } catch {}
      return _send.apply(this, arguments);
    };
    log("XMLHttpRequest hooked");
  } catch (e) {
    log("xhr hook failed", e);
  }

  // Hook postMessage
  try {
    const _post = window.postMessage;
    window.postMessage = function(message, targetOrigin, transfer) {
      try {
        const hits = extractDates(message);
        if (hits.length) report("postMessage:out", { targetOrigin, hits, message });
      } catch {}
      return _post.apply(this, arguments);
    };
    window.addEventListener("message", (ev) => {
      try {
        const hits = extractDates(ev.data);
        if (hits.length) report("postMessage:in", { origin: ev.origin, hits, data: ev.data });
      } catch {}
    }, true);
    log("postMessage hooked");
  } catch (e) {
    log("postMessage hook failed", e);
  }

  // Optionally sniff localStorage/sessionStorage for obvious keys
  try {
    const keys = [];
    for (let i=0;i<localStorage.length;i++){ keys.push(localStorage.key(i)); }
    const snapshot = {};
    keys.forEach(k => { try { snapshot[k] = localStorage.getItem(k); } catch {} });
    const hits = extractDates(snapshot);
    if (hits.length) report("localStorage", { hits, snapshot });
  } catch {}
})();
