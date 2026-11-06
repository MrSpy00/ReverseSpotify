// ReverseSpotify — Inspect: Ctrl+Alt+I ile ReverseSpotify çalışma zamanı
// durumunu modalda gösterir (tema, pluginler, devre-dışı kayıtlar, hata kaydı).
// Destek/arıza ayıklama aracı; sadece okuma (perfClass: medium — tek anlık snapshot).
(function () {
  function ls(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function prettyJson(raw) {
    if (!raw) return "yok";
    try {
      return JSON.stringify(JSON.parse(raw), null, 1);
    } catch (e) {
      return raw;
    }
  }

  function snapshot() {
    var rs = window.ReverseSpotify || {};
    var settings = rs.settings || {};
    var lines = [];
    lines.push("tema (panel): " + (ls("rs:theme") || "yok"));
    lines.push("tema (config): " + (settings.theme || "yok"));
    lines.push("tema css etkin: " + (document.getElementById("rs-theme") ? "evet" : "hayır"));
    lines.push("arkaplan katmani: " + (document.getElementById("rs-bg") ? "evet" : "hayır"));
    lines.push(
      "kurulu plugin: " +
        (Array.isArray(settings.plugins) && settings.plugins.length
          ? settings.plugins.map(function (p) { return p.id; }).join(", ")
          : "yok")
    );
    var mods = rs.modules || {};
    lines.push("çalışan modül: " + ((mods.ran || []).join(", ") || "yok"));
    lines.push("başarısız modül: " + ((mods.failed || []).join(", ") || "yok"));
    lines.push("fallback: " + ((rs.fallbacks || []).join(", ") || "yok"));
    lines.push("devre-dışı: " + prettyJson(ls("rs:disabled")));
    lines.push("son hata: " + prettyJson(ls("rs:error")));
    lines.push("UI temizliği: " + prettyJson(ls("rs:ui")));
    return lines.join("\n");
  }

  ReverseSpotify.onReady(function () {
    window.addEventListener("keydown", function (ev) {
      if (!ev.ctrlKey || !ev.altKey || ev.metaKey || ev.code !== "KeyI") return;
      var t = ev.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      ev.preventDefault();
      ReverseSpotify.UI.modal({ title: "ReverseSpotify Durum", body: snapshot() });
    });
  });
})();
