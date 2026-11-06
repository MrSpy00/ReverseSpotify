// ReverseSpotify — Remaining Time: parçanın kalan süresini oynatma çubuğunun
// üzerinde canlı gösterir (Spotify varsayılan olarak yalnız yüzdelik verir).
// 1s interval (lint bütçesi >=100ms); seçici bulunamazsa chip gizli kalır, hata yok.
(function () {
  var chip = null;
  var interval = 0;

  function ensureStyle() {
    ReverseSpotify.UI.addStyle(
      ".rs-rem{position:fixed;bottom:98px;left:50%;transform:translateX(-50%);" +
        "z-index:99997;padding:3px 9px;border-radius:999px;background:rgba(0,0,0,.72);" +
        "color:#b3b3b3;font:600 11px/1.4 ui-monospace,Consolas,monospace;" +
        "font-variant-numeric:tabular-nums;pointer-events:none;display:none;" +
        "border:1px solid rgba(255,255,255,.1)}" +
        ".rs-rem.on{display:block}",
      "rs-rem-style"
    );
  }

  function parseClock(s) {
    var m = /^(\d+):(\d{2})$/.exec(String(s || "").trim());
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function fmt(sec) {
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  var POS = {
    "alt-orta": { bottom: "98px", top: "auto", left: "50%", right: "auto", transform: "translateX(-50%)" },
    "sag-alt": { bottom: "150px", top: "auto", left: "auto", right: "16px", transform: "none" },
    "sol-alt": { bottom: "150px", top: "auto", left: "16px", right: "auto", transform: "none" },
    "ust-orta": { top: "12px", bottom: "auto", left: "50%", right: "auto", transform: "translateX(-50%)" },
  };

  function applyPos() {
    var key = "alt-orta";
    try {
      if (ReverseSpotify.getSetting) key = ReverseSpotify.getSetting("position", "alt-orta");
    } catch (e) {}
    var p = POS[key] || POS["alt-orta"];
    for (var k in p) {
      if (Object.prototype.hasOwnProperty.call(p, k)) chip.style[k] = p[k];
    }
  }

  function tick() {
    if (!chip || !chip.isConnected) return;
    applyPos();
    var posEl = document.querySelector('[data-testid="playback-position"]');
    var durEl = document.querySelector('[data-testid="playback-duration"]');
    var pos = posEl ? parseClock(posEl.textContent) : null;
    var dur = durEl ? parseClock(durEl.textContent) : null;
    if (pos === null || dur === null || dur <= pos) {
      chip.classList.remove("on");
      return;
    }
    var left = dur - pos;
    chip.textContent = "-" + fmt(left);
    chip.classList.add("on");
  }

  ReverseSpotify.onReady(function () {
    ensureStyle();
    chip = document.createElement("div");
    chip.className = "rs-rem";
    chip.setAttribute("aria-hidden", "true");
    document.body.appendChild(chip);
    interval = window.setInterval(tick, 1000);
    tick();
  });
})();
