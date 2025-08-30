// probe.js — content script: injects tap.js into the PAGE context to hook fetch/XHR/postMessage.
(() => {
  const url = chrome.runtime.getURL("tap.js");
  const s = document.createElement("script");
  s.src = url;
  s.async = false;
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
  console.log("[scanner] network/message probe injected");
})();
