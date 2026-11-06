// ReverseSpotify — Copy Now Playing: Ctrl+Alt+C ile çalan parçayı
// "Sanatçı — Başlık" biçiminde panoya kopyalar, sağ altta onay gösterir.
// Hafif: tek keydown dinleyicisi; kopyalama anlık (perfClass: light).
(function () {
  var toast = null;
  var hideTimer = null;

  function trackText() {
    var w = document.querySelector('[data-testid="now-playing-widget"]');
    if (w) {
      var lines = (w.innerText || "")
        .split("\n")
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
      if (lines.length >= 2) return lines[0] + " — " + lines[1];
      if (lines.length === 1) return lines[0];
    }
    var title = (document.title || "")
      .replace(/^\s*(Şimdi çalıyor|Now playing|Playing)\s*[:–-]\s*/i, "")
      .replace(/\s*\|\s*Spotify\s*$/i, "")
      .trim();
    return title || null;
  }

  function showToast(ok, msg) {
    if (!toast || !toast.isConnected) {
      ReverseSpotify.UI.addStyle(
        ".rs-cnp-toast{position:fixed;right:16px;bottom:196px;z-index:99999;padding:9px 14px;" +
          "border-radius:8px;font:600 12.5px/1.3 system-ui,sans-serif;color:#000;" +
          "background:#1ed760;box-shadow:0 4px 14px rgba(0,0,0,.45);max-width:280px;" +
          "opacity:0;transition:opacity .18s ease;pointer-events:none}" +
          ".rs-cnp-toast.err{background:#f59e0b}" +
          ".rs-cnp-toast.on{opacity:1}",
        "rs-cnp-style"
      );
      toast = document.createElement("div");
      toast.className = "rs-cnp-toast";
      document.body.appendChild(toast);
    }
    toast.className = "rs-cnp-toast" + (ok ? "" : " err");
    toast.textContent = msg;
    // force reflow: opacity geçişi her gösterimde yeniden tetiklensin
    void toast.offsetWidth;
    toast.classList.add("on");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (toast && toast.isConnected) toast.classList.remove("on");
    }, 1800);
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
      } catch (e) {
        reject(e);
      } finally {
        ta.remove();
      }
    });
  }

  ReverseSpotify.onReady(function () {
    window.addEventListener("keydown", function (ev) {
      if (!ev.ctrlKey || !ev.altKey || ev.metaKey || ev.code !== "KeyC") return;
      var t = ev.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      ev.preventDefault();
      var text = trackText();
      if (!text) {
        showToast(false, "Çalan parça bulunamadı");
        return;
      }
      copy(text).then(
        function () {
          showToast(true, "Kopyalandı: " + text);
        },
        function () {
          showToast(false, "Kopyalanamadı");
        }
      );
    });
  });
})();
