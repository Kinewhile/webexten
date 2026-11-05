// Runs inside YouTube / WhatsApp / Telegram pages, but only when they are
// shown inside a window of this Desktop extension. Normal tabs are untouched.
(() => {
  const extOrigin = "chrome-extension://" + chrome.runtime.id;
  if (window === window.top) return;
  if (!location.ancestorOrigins || location.ancestorOrigins[0] !== extOrigin) return;

  const nav = window.navigation; // Navigation API: history of this frame only
  const quiet = (r) => {
    if (r && r.committed) r.committed.catch(() => {});
    if (r && r.finished) r.finished.catch(() => {});
  };

  let last = "";
  function report() {
    const state = {
      desktop: true,
      type: "state",
      url: location.href,
      title: document.title,
      canBack: !!(nav && nav.canGoBack),
      canForward: !!(nav && nav.canGoForward),
    };
    const sig = JSON.stringify(state);
    if (sig === last) return;
    last = sig;
    window.parent.postMessage(state, extOrigin);
  }

  window.addEventListener("message", (e) => {
    if (e.origin !== extOrigin || !e.data || e.data.desktop !== true) return;
    try {
      if (e.data.cmd === "back" && nav && nav.canGoBack) quiet(nav.back());
      else if (e.data.cmd === "forward" && nav && nav.canGoForward) quiet(nav.forward());
      else if (e.data.cmd === "reload") location.reload();
    } catch (err) {}
  });

  report();
  setInterval(report, 600);
})();
