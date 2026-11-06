// ReverseSpotify örnek plugin — Key Highlight:
// basılan tuşu sağ altta350ms gösterir. Hafif: tek keydown dinleyicisi,
// observer/timer/backdrop yok (perfClass: light).
(function () {
  var el = null;
  var hideTimer = null;

  function ensure() {
    if (el && el.isConnected) return el;
    el = document.createElement("div");
    ReverseSpotify.UI.addStyle(
      ".rs-keyhl{position:fixed;right:16px;bottom:76px;min-width:34px;height:34px;padding:0 10px;" +
        "display:none;align-items:center;justify-content:center;background:#1ed760;color:#000;" +
        "font:600 14px/1 system-ui,sans-serif;border-radius:8px;z-index:99999;pointer-events:none}",
      "rs-keyhl-style"
    );
    el.className = "rs-keyhl";
    document.body.appendChild(el);
    return el;
  }

  function show(key) {
    var e = ensure();
    e.textContent = key === " " ? "SPACE" : key.toUpperCase();
    e.style.display = "flex";
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      e.style.display = "none";
    }, 350);
  }

  ReverseSpotify.onReady(function () {
    window.addEventListener("keydown", function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      show(ev.key);
    });
  });
})();
