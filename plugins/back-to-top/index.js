// ReverseSpotify — Back to Top: kaydırma600px'i geçince beliren yukarı butonu.
// Hafif: tek passive scroll dinleyicisi + rAF throttle; observer/timer yok (perfClass: light).
(function () {
  var btn = null;

  function ensure() {
    if (btn && btn.isConnected) return btn;
    ReverseSpotify.UI.addStyle(
      ".rs-totop{position:fixed;right:16px;bottom:150px;width:38px;height:38px;border:0;" +
        "border-radius:50%;background:#1ed760;color:#000;cursor:pointer;display:none;" +
        "align-items:center;justify-content:center;z-index:99998;padding:0;" +
        "box-shadow:0 4px 14px rgba(0,0,0,.45);transition:transform .15s ease,opacity .15s ease}" +
        ".rs-totop:hover{transform:scale(1.07)}" +
        ".rs-totop:active{transform:scale(.96)}" +
        ".rs-totop:focus-visible{outline:2px solid #fff;outline-offset:2px}",
      "rs-totop-style"
    );
    btn = document.createElement("button");
    btn.className = "rs-totop";
    btn.type = "button";
    btn.setAttribute("aria-label", "Sayfanın başına çık");
    btn.innerHTML =
      '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M8 13V3.5M3.5 8L8 3.5L12.5 8"/></svg>';
    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    document.body.appendChild(btn);
    return btn;
  }

  ReverseSpotify.onReady(function () {
    var raf = 0;
    window.addEventListener(
      "scroll",
      function () {
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          var y = window.scrollY || document.documentElement.scrollTop || 0;
          ensure().style.display = y > 600 ? "flex" : "none";
        });
      },
      { passive: true }
    );
  });
})();
