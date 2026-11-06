// ReverseSpotify — Shortcuts Help: "?" tuşu ReverseSpotify + yerleşik kısayol
// listesini modal olarak açar. Hafif: tek keydown dinleyicisi, DOM kalıcılığı yok
// (modal kapalıyken sıfır maliyet) (perfClass: light).
(function () {
  var LINES = [
    "Ctrl+Shift+,  — ReverseSpotify panelini aç / kapat",
    "ESC  — paneli kapat",
    "?  — bu kısayol listesi",
    "Ctrl+Alt+C  — çalan şarkıyı panoya kopyala",
    "Ctrl+Alt+I  — ReverseSpotify durum bilgisi",
    "Ctrl+Left / Ctrl+Right  — parçada 15sn ileri / geri",
    "Alt+Left / Alt+Right  — önceki / sonraki parça",
    "Space  — çal / duraklat",
  ];

  ReverseSpotify.onReady(function () {
    window.addEventListener("keydown", function (ev) {
      if (ev.key !== "?" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var t = ev.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      ev.preventDefault();
      ReverseSpotify.UI.modal({ title: "Kısayollar", body: LINES.join("\n") });
    });
  });
})();
