// ReverseSpotify loader çekirdeği — tek dosya, IIFE, defer.
// Asla throw fırlatmaz; her modül bootModules üzerinden izoledir.
"use strict";

// ---- Saf mantık (node:test bunları doğrudan dener) ----

function bootModules(modules, registry) {
  const ran = [];
  const failed = [];
  for (const m of modules) {
    try {
      if (registry && registry.isDisabled && registry.isDisabled(m.name)) continue;
    } catch (e) {
      // isDisabled kendi hatası: modülü çalıştırma, güvenli tarafta kal
      failed.push(m.name);
      continue;
    }
    try {
      const ret = m.run();
      if (ret && typeof ret.then === "function") {
        // Async modül: promise settle OLMADAN ran'a girmez (yanlış "N/N" telemetri engeli)
        ret.then(
          () => {
            ran.push(m.name);
          },
          (e) => {
            failed.push(m.name);
            try {
              registry && registry.disable && registry.disable(m.name, e);
            } catch (_) {}
            if (typeof console !== "undefined") {
              console.error("[ReverseSpotify] modül async çöktü:", m.name, e);
            }
          }
        );
      } else {
        ran.push(m.name);
      }
    } catch (e) {
      failed.push(m.name);
      try {
        registry && registry.disable && registry.disable(m.name, e);
      } catch (_) {}
      if (typeof console !== "undefined") {
        console.error("[ReverseSpotify] modül çöktü:", m.name, e);
      }
    }
  }
  return { ran, failed };
}

function createDisableRegistry(storage) {
  const KEY = "rs:disabled";
  function read() {
    try {
      return new Set(JSON.parse(storage.getItem(KEY) || "[]"));
    } catch (_) {
      return new Set();
    }
  }
  return {
    isDisabled(name) {
      return read().has(name);
    },
    disable(name) {
      try {
        const s = read();
        s.add(name);
        storage.setItem(KEY, JSON.stringify(Array.from(s)));
      } catch (_) {}
    },
    remove(name) {
      try {
        const s = read();
        s.delete(name);
        storage.setItem(KEY, JSON.stringify(Array.from(s)));
      } catch (_) {}
    },
  };
}

// config.resetDisabled: CLI enable/add, rs:disabled'taki kırık kaydı config'e yazar;
// boot bunları temizler — "asla sessiz bozulma yok" (review Important)
function applyResetDisabled(registry, settings) {
  if (!registry || !registry.remove || !settings || !Array.isArray(settings.resetDisabled)) return;
  for (const name of settings.resetDisabled) {
    if (typeof name === "string") registry.remove(name);
  }
}

// Panel/CLI ortak plugin durumu: CLI config mi, runtime disable mı, aktif mi
function pluginRuntimeState(p, registry) {
  if (!p || p.enabled === false) return "cli-pasif";
  const name = "plugin:" + p.id;
  if (registry && registry.isDisabled && registry.isDisabled(name)) return "runtime-kapali";
  return "aktif";
}

// ---- Tarayıcı yolu (CEF/xpui) ----

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickChunkGlobal(win) {
  // Spotify1.3.8: Rspack'e geçiş (rspackChunk); eski sürümler webpackChunk*
  for (const k of Object.keys(win)) {
    if (/^(rspackChunk|webpackChunk)/.test(k)) {
      const g = win[k];
      if (Array.isArray(g)) return g;
    }
  }
  return null;
}

async function waitForRequire(win, timeoutMs) {
  const t0 = Date.now();
  // 1) chunk global'ini bekle (bundle henüz koşmamış olabilir)
  let g = null;
  while (!(g = pickChunkGlobal(win)) && Date.now() - t0 < timeoutMs) {
    await sleep(100);
  }
  if (!g) return null;
  // 2) probe kuyruğa al: runtime henüz kurulmamışsa kurulunca çalışır
  let req = null;
  try {
    g.push([
      ["__rs_probe__"],
      {},
      (r) => {
        req = r;
      },
    ]);
  } catch (_) {
    return null;
  }
  while (!req && Date.now() - t0 < timeoutMs) await sleep(100);
  return req;
}

function candidateModules(sources) {
  const out = { react: [], platform: [], router: [] };
  for (const [id, src] of Object.entries(sources)) {
    if (/createElement/.test(src) && /useState|useMemo|useCallback/.test(src)) out.react.push(id);
    if (/getAppState|getURI|getVolumeState/.test(src)) out.platform.push(id);
    if (/useLocation|createHashRouter/.test(src)) out.router.push(id);
  }
  return out;
}

// ---- Tema motoru (T5) ----

function applyThemeCss(doc, css) {
  // Tek style tag (#rs-theme): ikinci çağrıda replace — DOM'a kopya yığmaz.
  let el = doc.getElementById("rs-theme");
  if (!el) {
    el = doc.createElement("style");
    el.id = "rs-theme";
    (doc.head || doc.documentElement).appendChild(el);
  }
  el.textContent = css;
}

// Panel (localStorage rs:theme) > config (CLI). "" = panel override ile temayı kapatma.
function resolveTheme(win, settings) {
  let t = null;
  try {
    t = win.localStorage.getItem("rs:theme");
  } catch (_) {}
  if (t === null || t === undefined) return (settings && settings.theme) || null;
  return t || null;
}

function themeEngineModule(win, fetchFn) {
  const f = fetchFn || ((...a) => (win.fetch || fetch)(...a));
  return {
    name: "theme-engine",
    async run() {
      const api = win.ReverseSpotify;
      const theme = resolveTheme(win, api && api.settings);
      if (!theme) return;
      // 404/ager reddetme: kaçak hata kalıcı disable'a yol açmasın (rs:disabled kalıcıdır)
      let css = null;
      try {
        const res = await f("/reverse/themes/" + encodeURIComponent(theme) + "/theme.css");
        if (res && res.ok) css = await res.text();
      } catch (_) {}
      if (css === null) {
        if (api && api.log) api.log("tema css alınamadı:", theme);
        return;
      }
      api.applyTheme(css);
    },
  };
}

// ---- Plugin runner (T6) ----

function makePluginApi(api, registry, id, perms, storage) {
  const name = "plugin:" + id;
  const has = (p) => Array.isArray(perms) && perms.indexOf(p) !== -1;

  function record(e) {
    try {
      registry && registry.disable && registry.disable(name);
    } catch (_) {}
    try {
      storage &&
        storage.setItem(
          "rs:error",
          JSON.stringify({ plugin: id, error: String(e), at: Date.now() })
        );
    } catch (_) {}
    if (typeof console !== "undefined") {
      console.error("[ReverseSpotify] plugin hatası:", id, e);
    }
  }

  let styleSeq = 0;
  const facade = {
    get React() {
      return api.React;
    },
    get Platform() {
      return api.Platform;
    },
    get Router() {
      return api.Router;
    },
    log: (...a) => console.log("[ReverseSpotify][plugin:" + id + "]", ...a),
    onReady(cb) {
      api.onReady((a) => {
        try {
          cb(a);
        } catch (e) {
          record(e);
        }
      });
    },
    onRouteChange(cb) {
      api.onRouteChange((loc) => {
        try {
          cb(loc);
        } catch (e) {
          record(e);
        }
      });
    },
  };

  if (has("settings")) {
    facade.settings = {
      get: (k) => api.settings[k],
      set: (k, v) => {
        api.settings[k] = v;
      },
    };
  }
  if (has("ui")) {
    facade.UI = {
      addStyle(css, styleId) {
        const doc = document;
        const id2 = styleId || "rs-style-" + id + "-" + ++styleSeq;
        let el = doc.getElementById(id2);
        if (!el) {
          el = doc.createElement("style");
          el.id = id2;
          (doc.head || doc.documentElement).appendChild(el);
        }
        el.textContent = css;
        return id2;
      },
      modal(opts) {
        const doc = document;
        facade.UI.addStyle(
          ".rs-modal-back{position:fixed;inset:0;background:#000000aa;z-index:999998;display:flex;align-items:center;justify-content:center}" +
            ".rs-modal-panel{background:#181818;color:#fff;border-radius:10px;padding:18px 20px;min-width:280px;max-width:440px;box-shadow:0 8px 30px #0009}" +
            ".rs-modal-title{font:700 16px/1.3 system-ui,sans-serif;margin-bottom:8px}" +
            ".rs-modal-body{font:400 14px/1.5 system-ui,sans-serif;color:#b3b3b3;white-space:pre-wrap}" +
            ".rs-modal-panel button{margin-top:14px;background:#fff;color:#000;border:0;border-radius:999px;padding:8px 18px;font:600 13px system-ui,sans-serif;cursor:pointer}",
          "rs-modal-style"
        );
        const back = doc.createElement("div");
        back.className = "rs-modal-back";
        const panel = doc.createElement("div");
        panel.className = "rs-modal-panel";
        const title = doc.createElement("div");
        title.className = "rs-modal-title";
        title.textContent = (opts && opts.title) || "";
        const body = doc.createElement("div");
        body.className = "rs-modal-body";
        if (opts && opts.body) body.textContent = String(opts.body);
        const btn = doc.createElement("button");
        btn.type = "button";
        btn.textContent = "Kapat";
        panel.appendChild(title);
        panel.appendChild(body);
        panel.appendChild(btn);
        back.appendChild(panel);
        const close = () => {
          try {
            back.remove();
          } catch (_) {}
        };
        btn.addEventListener("click", close);
        back.addEventListener("click", (e) => {
          if (e.target === back) close();
        });
        (doc.body || doc.documentElement).appendChild(back);
        return { close };
      },
    };
  }
  facade._record = record;
  return facade;
}

async function runPlugins(api, registry, list, fetchFn, storage) {
  const out = { ok: [], failed: [], skipped: [] };
  const f = fetchFn || ((...a) => globalThis.fetch(...a));
  const fail = (name, e, pid) => {
    try {
      registry && registry.disable && registry.disable(name);
    } catch (_) {}
    try {
      storage &&
        storage.setItem(
          "rs:error",
          JSON.stringify({ plugin: pid, error: String(e), at: Date.now() })
        );
    } catch (_) {}
    if (typeof console !== "undefined") {
      console.error("[ReverseSpotify] plugin patladı:", pid, e);
    }
    out.failed.push(pid);
  };

  for (const p of list || []) {
    if (!p || typeof p.id !== "string") continue;
    const name = "plugin:" + p.id;
    if (p.enabled === false) {
      out.skipped.push(p.id);
      continue;
    }
    try {
      if (registry && registry.isDisabled && registry.isDisabled(name)) {
        out.skipped.push(p.id);
        continue;
      }
    } catch (_) {
      out.skipped.push(p.id);
      continue;
    }
    let src;
    try {
      const res = await f(
        "/reverse/plugins/" + encodeURIComponent(p.id) + "/" + encodeURIComponent(p.entry || "index.js")
      );
      if (!res || !res.ok) throw new Error("http " + (res ? res.status : "yok"));
      src = await res.text();
    } catch (e) {
      fail(name, e, p.id);
      continue;
    }
    try {
      const fn = new Function(
        "ReverseSpotify",
        src + "\n//# sourceURL=reverse-plugin:" + p.id + ".js"
      );
      fn(makePluginApi(api, registry, p.id, p.permissions || [], storage));
      out.ok.push(p.id);
    } catch (e) {
      fail(name, e, p.id);
    }
  }
  return out;
}

function detectModules(req, api) {
  // rspack: require.cache (.c) yok → fabrika kaynak taraması + require ile şekil doğrulama.
  // require(id) yan etkileri olabilir: aynı id ASLA iki kez denenmez (api._tried).
  let factories;
  try {
    factories = req.m || {};
  } catch (_) {
    return;
  }
  const sources = {};
  for (const id of Object.keys(factories)) {
    if (api._tried.has(String(id))) continue;
    try {
      sources[id] = Function.prototype.toString.call(factories[id]);
    } catch (_) {}
  }
  const cand = candidateModules(sources);
  const need = { react: !api.React, platform: !api.Platform, router: !api.Router };
  const wanted = new Set([
    ...(need.react ? cand.react : []),
    ...(need.platform ? cand.platform : []),
    ...(need.router ? cand.router : []),
  ]);
  for (const id of wanted) {
    api._tried.add(String(id));
    let e;
    try {
      e = req(Number(id));
    } catch (_) {
      continue;
    }
    if (!e) continue;
    for (const c of [e, e.default]) {
      if (!c) continue;
      if (!api.React && typeof c.createElement === "function" && typeof c.useState === "function") {
        api.React = c;
      }
      if (
        !api.Platform &&
        typeof c === "object" &&
        (typeof c.getAppState === "function" || typeof c.getURI === "function")
      ) {
        api.Platform = c;
      }
      if (
        !api.Router &&
        typeof c === "object" &&
        (typeof c.useLocation === "function" || typeof c.Router === "function")
      ) {
        api.Router = c;
      }
    }
  }
}

function browserBoot() {
  const win = window;
  const registry = createDisableRegistry(win.localStorage);

  try {
    document.documentElement.dataset.rs = "1";
  } catch (_) {}

  const routeCbs = [];
  const emitRoute = () => {
    const loc = win.location.pathname + win.location.search + win.location.hash;
    for (const cb of routeCbs) {
      try {
        cb(loc);
      } catch (e) {
        console.error("[ReverseSpotify] onRouteChange hatası", e);
      }
    }
  };

  const api = {
    React: null,
    Platform: null,
    Router: null,
    fallbacks: [],
    settings: { theme: null, plugins: [] },
    applyTheme: (css) => applyThemeCss(document, css),
    // Panel tema override: id=string → localStorage; null → config'e dön; "" → kapat (vanilla)
    setTheme: async (id) => {
      try {
        if (id === null) win.localStorage.removeItem("rs:theme");
        else win.localStorage.setItem("rs:theme", String(id));
      } catch (_) {}
      const eff = resolveTheme(win, api.settings);
      if (!eff) {
        const el = document.getElementById("rs-theme");
        if (el) el.remove();
        return;
      }
      try {
        const res = await fetch("/reverse/themes/" + encodeURIComponent(eff) + "/theme.css");
        if (res && res.ok) applyThemeCss(document, await res.text());
        else api.log("tema css alınamadı:", eff);
      } catch (e) {
        api.log("tema css alınamadı:", eff, e);
      }
    },
    log: (...a) => console.log("[ReverseSpotify]", ...a),
    onReady(cb) {
      if (api._ready) Promise.resolve(api._ready).then(() => cb(api));
      else api._readyCbs.push(cb);
    },
    onRouteChange(cb) {
      routeCbs.push(cb);
    },
    _readyCbs: [],
    _ready: null,
    _tried: new Set(),
    modules: null,
  };
  win.ReverseSpotify = api;

  // route change: webpack Router'a bağımlı değil — history patch + popstate/hashchange
  try {
    for (const name of ["pushState", "replaceState"]) {
      const orig = win.history[name];
      win.history[name] = function (...a) {
        const ret = orig.apply(this, a);
        emitRoute();
        return ret;
      };
    }
    win.addEventListener("popstate", emitRoute);
    win.addEventListener("hashchange", emitRoute);
  } catch (_) {}

  api._ready = (async () => {
    try {
      const cfg = await fetch("/reverse/config.json").then((r) => r.json());
      Object.assign(api.settings, cfg);
    } catch (e) {
      api.log("config okunamadı (varsayılanla devam)", e);
    }
    applyResetDisabled(registry, api.settings);

    const req = await waitForRequire(win, 15000);
    if (!req) {
      api.fallbacks.push("chunk");
      api.log("rspack/webpack chunk bulunamadı — sessiz fallback");
    } else {
      // arka plan tespit: modül boot'unu GECİKTİRMEZ (v1 kendi modülleri React gerektirmez)
      (async () => {
        for (let i = 0; i < 10 && (!api.React || !api.Platform || !api.Router); i++) {
          detectModules(req, api);
          if (api.React && api.Platform && api.Router) break;
          await sleep(500);
        }
        if (!api.React) api.fallbacks.push("React");
        if (!api.Platform) api.fallbacks.push("Platform");
        if (!api.Router) api.fallbacks.push("Router");
      })();
    }

    api._readyCbs.splice(0).forEach((cb) => {
      try {
        cb(api);
      } catch (e) {
        console.error("[ReverseSpotify] onReady hatası", e);
      }
    });
    return api;
  })();

  // Kayıtlı çekirdek modüller — T5/T6/T7 bu run gövdelerini dolduracak
  api._ready.then(() => {
    api.modules = bootModules(
      [
        { name: "theme-engine", ...themeEngineModule(win) },
        {
          name: "plugins",
          run: () => runPlugins(api, registry, api.settings.plugins || [], null, win.localStorage),
        },
        makeAdblockModule(win, api),
        makeUiOverhaulModule(win, api),
        makeQualityModule(win, api),
        makePanelModule(win, api, registry),
      ],
      registry
    );
  });
}

// ---- T7: ad-block / UI temizliği / kalite reveal ----

// docs/xpui-findings.md §2: ses-reklam istemci hook'u keşfedilmedi → dürüst rapor.
const ADBLOCK_MODE = "ui-only";

// docs/xpui-findings.md §1: hepsi grep ile keşfedilmiş gerçek testid'ler.
const ADBLOCK_SELECTORS = [
  "home-ads-container",
  "home-ad-card",
  "home-ad-display-asset-fallback",
  "home-ad-video-asset",
  "regular-advertiser-info",
  "compact-advertiser-info",
  "leavebehind",
  "leavebehinds-wrapper",
  "leavebehinds-list-wrapper",
  "leavebehinds-title",
  "leavebehinds-see-all",
  "show-leavebehinds-container",
  "ads-video-player-npv",
  "ads-npv-header-maximize-button",
  "canvas-ad-container",
  "canvas-ad-player",
  "skippable-ad-skip-button",
  "skippable-ad-circle-timer",
  "skippable-ad-delay",
  "embedded-ad",
  "embedded-ad-carousel",
  "embedded-ad-carousel-header-logo",
  "embedded-ad-html-display",
  "embedded-ad-html-creative",
  "embedded-ad-cta-button-fallback",
  "embedded-ad-creative-link",
  "standalone-video-ad-player",
  "video-player-ad-wrapper",
  "ad-controls",
  "context-ad-logo",
  "ad-companion-card",
  "ad-companion-card-tagline",
  "survey-ad",
  "survey-ad-thank-you",
  "survey-option-ad",
  "button-like-ad",
  "button-dislike-ad",
  "adfeedback-context-menu",
  "PanelHeader_AdContextMenuButton",
];

const UI_GROUPS = {
  upsell: ["upsell-download-app-button", "sponsored-recommendation-modal-trigger"],
  dsa: ["home-dsa-message-banner"],
};

function setStyle(doc, id, css) {
  let el = doc.getElementById(id);
  if (!el) {
    el = doc.createElement("style");
    el.id = id;
    (doc.head || doc.documentElement).appendChild(el);
  }
  el.textContent = css;
}

function hideCss(ids) {
  return ids.map((id) => `[data-testid="${id}"]`).join(",") + "{display:none!important}";
}

function makeAdblockModule(win, api) {
  return {
    name: "adblock",
    run() {
      setStyle(win.document, "rs-adblock", hideCss(ADBLOCK_SELECTORS));
      api.Adblock = { mode: ADBLOCK_MODE, selectors: ADBLOCK_SELECTORS.length };
    },
  };
}

function makeUiOverhaulModule(win, api) {
  return {
    name: "ui-overhaul",
    run() {
      const active = [];
      for (const group of Object.keys(UI_GROUPS)) {
        if (win.localStorage && win.localStorage.getItem("rs:ui:" + group) === "0") {
          // Panel runtime toggle: kapatılan grubun eski style'ını kaldır
          const el = win.document.getElementById("rs-ui-" + group);
          if (el) el.remove();
          continue;
        }
        setStyle(win.document, "rs-ui-" + group, hideCss(UI_GROUPS[group]));
        active.push(group);
      }
      api.Ui = { groups: Object.keys(UI_GROUPS), active };
    },
  };
}

function makeQualityModule(win, api) {
  const doc = win.document;
  // Reveal-only: DOM'da mevcut disabled option'ı serbest bırakır, option üretmez/değmez.
  function reveal() {
    const opts = doc.querySelectorAll('select[id*="quality" i] option[disabled]');
    let n = 0;
    for (const o of opts) {
      if (o.disabled) {
        o.disabled = false;
        n++;
      }
    }
    const prev = api.Quality && api.Quality.revealed ? api.Quality.revealed : 0;
    api.Quality = { mode: "reveal-only", revealed: prev + n };
    return n;
  }
  return {
    name: "quality",
    reveal,
    run() {
      api.revealQuality = reveal;
      reveal();
      if (typeof win.MutationObserver === "function") {
        let scheduled = false;
        const mo = new win.MutationObserver(() => {
          if (scheduled) return;
          scheduled = true;
          const raf = win.requestAnimationFrame || ((fn) => win.setTimeout(fn, 16));
          raf(() => {
            scheduled = false;
            reveal();
          });
        });
        mo.observe(doc.documentElement || doc, { childList: true, subtree: true });
      }
    },
  };
}

// ---- Kontrol paneli (in-app UI) ----

// ---- Panel veri + montaj yardımcıları (pure — panel-ui.test.mjs ile kilitli) ----

const THEME_SWATCHES = {
  "clean-dark": ["#0e0e10", "#1a1a1c"],
  amoled: ["#000000", "#0d0d0d"],
};

function swatchFor(id) {
  const s = THEME_SWATCHES[String(id == null ? "" : id)];
  return s ? s.slice() : ["#121212", "#1f1f1f"];
}

const UI_LABELS = {
  upsell: "İndirme ve upgrade bannerları",
  dsa: "Ana sayfa duyuru bandı",
};

function groupLabel(g) {
  return UI_LABELS[g] || g;
}

// Üst bar montaj hedefi: sağ klaster, profil avatarının hemen solu.
function topbarSlot(doc) {
  const refs = [
    '[data-testid="user-widget-link"]',
    '[data-testid="friend-activity-button"]',
    '[data-testid="whats-new-feed-button"]',
  ];
  for (const sel of refs) {
    const el = doc.querySelector(sel);
    if (el && el.parentElement) return { parent: el.parentElement, before: el };
  }
  return null;
}

const PANEL_CSS = [
  // -- buton: fallback (sag alt) + ust bar varyanti --
  "#rs-panel-btn{position:fixed;right:14px;bottom:110px;z-index:99999;width:34px;height:34px;",
  "border-radius:50%;display:flex;align-items:center;justify-content:center;padding:0;",
  "background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.85);",
  "cursor:pointer;transition:background .12s ease,color .12s ease,transform .12s ease}",
  "#rs-panel-btn:hover{background:rgba(0,0,0,.8);color:#fff;transform:scale(1.05)}",
  "#rs-panel-btn.rs-in-topbar{position:static;width:32px;height:32px;flex:none;background:transparent;",
  "border:0;border-radius:50%;color:rgba(255,255,255,.7)}",
  "#rs-panel-btn.rs-in-topbar:hover{background:rgba(255,255,255,.1);color:#fff;transform:none}",
  // -- overlay + kart --
  "#rs-panel{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;",
  "padding:24px 16px;background:rgba(0,0,0,.7);font:400 13px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;",
  "animation:rs-fade .14s ease-out}",
  "#rs-panel-card{position:relative;display:flex;flex-direction:column;width:min(560px,100%);",
  "max-height:min(660px,86vh);background:#121212;color:#fff;border:1px solid rgba(255,255,255,.08);",
  "border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.6);overflow:hidden;",
  "animation:rs-pop .16s cubic-bezier(.2,.8,.3,1)}",
  "@keyframes rs-fade{from{opacity:0}}",
  "@keyframes rs-pop{from{opacity:0;transform:translateY(8px) scale(.97)}}",
  "@media (prefers-reduced-motion:reduce){#rs-panel,#rs-panel-card{animation:none}}",
  // -- baslik --
  "#rs-panel-card .rs-head{display:flex;align-items:center;gap:10px;padding:14px 16px;flex:none;",
  "border-bottom:1px solid rgba(255,255,255,.07)}",
  "#rs-panel-card .rs-mark{flex:none;width:26px;height:26px;border-radius:7px;background:#1ed760;",
  "color:#000;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}",
  "#rs-panel-card .rs-hgrp{display:flex;flex-direction:column;gap:4px;align-items:flex-start;min-width:0}",
  "#rs-panel-card .rs-ttl{font-weight:700;font-size:14px;letter-spacing:.1px}",
  "#rs-panel-card .rs-pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#a7a7a7;",
  "border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:2px 9px}",
  "#rs-panel-card .rs-pill i{width:6px;height:6px;border-radius:50%;background:#1ed760}",
  "#rs-panel-card .rs-pill.warn i{background:#f59e0b}",
  "#rs-panel-card .rs-x{margin-left:auto;flex:none;width:32px;height:32px;border:0;border-radius:50%;",
  "background:transparent;color:#a7a7a7;cursor:pointer;display:flex;align-items:center;justify-content:center}",
  "#rs-panel-card .rs-x:hover{background:rgba(255,255,255,.08);color:#fff}",
  // -- govde + kaydirma --
  "#rs-panel-card .rs-body{flex:1;min-height:0;overflow-y:auto;padding:2px 16px 16px}",
  "#rs-panel-card .rs-body::-webkit-scrollbar{width:8px}",
  "#rs-panel-card .rs-body::-webkit-scrollbar-thumb{background:#4d4d4d;border-radius:4px}",
  "#rs-panel-card .rs-body::-webkit-scrollbar-track{background:transparent}",
  // -- bolumler --
  "#rs-panel-card .rs-sec{margin-top:16px}",
  "#rs-panel-card .rs-sec>h3{display:flex;align-items:center;gap:7px;margin:0 0 8px;font-size:11px;",
  "font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#a7a7a7}",
  "#rs-panel-card .rs-sec>h3 svg{width:14px;height:14px;opacity:.8;flex:none}",
  "#rs-panel-card .rs-row{display:flex;align-items:center;gap:10px;padding:9px 10px;min-height:44px;",
  "margin-bottom:6px;background:#181818;border:1px solid rgba(255,255,255,.06);border-radius:8px;",
  "transition:background .1s ease}",
  "#rs-panel-card .rs-row:hover{background:#1e1e1e}",
  "#rs-panel-card .rs-col{flex:1;min-width:0}",
  "#rs-panel-card .rs-nm{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;",
  "font-weight:500;color:#eaeaea}",
  "#rs-panel-card .rs-sub{display:block;margin-top:2px;font-size:11px;color:#8f8f8f;overflow:hidden;",
  "text-overflow:ellipsis;white-space:nowrap}",
  "#rs-panel-card .rs-kbds{display:flex;gap:6px;align-items:center;flex:none;flex-wrap:wrap}",
  "#rs-panel-card .rs-kbd{display:inline-block;font:600 11px/1 ui-monospace,Consolas,monospace;",
  "background:#232323;border:1px solid rgba(255,255,255,.16);border-bottom-width:2px;border-radius:5px;",
  "padding:3px 6px;color:#eaeaea}",
  // -- anahtar (Spotify tarzi switch) --
  "#rs-panel-card .rs-sw{position:relative;flex:none;width:36px;height:20px;padding:0;border:0;",
  "border-radius:999px;background:#535353;cursor:pointer;transition:background .15s ease}",
  "#rs-panel-card .rs-sw::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;",
  "border-radius:50%;background:#fff;transition:transform .15s ease}",
  "#rs-panel-card .rs-sw[aria-checked=true]{background:#1ed760}",
  "#rs-panel-card .rs-sw[aria-checked=true]::after{transform:translateX(16px)}",
  "#rs-panel-card .rs-sw[disabled]{opacity:.45;cursor:not-allowed}",
  // -- butonlar (pill) --
  "#rs-panel-card .rs-btn{flex:none;border:0;border-radius:999px;padding:7px 16px;font-size:12px;",
  "font-weight:700;background:#fff;color:#000;cursor:pointer;",
  "transition:transform .1s ease,background .1s ease}",
  "#rs-panel-card .rs-btn:hover{background:#f0f0f0;transform:scale(1.04)}",
  "#rs-panel-card .rs-btn:active{transform:scale(.99)}",
  "#rs-panel-card .rs-btn.sec{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.3);",
  "font-weight:500;padding:6px 14px}",
  "#rs-panel-card .rs-btn.sec:hover{background:rgba(255,255,255,.1);border-color:#fff;transform:none}",
  "#rs-panel-card .rs-btn[disabled]{opacity:.4;pointer-events:none}",
  // -- tema kartlari --
  "#rs-panel-card .rs-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}",
  "#rs-panel-card .rs-tcard{border:2px solid transparent;padding:8px;border-radius:10px;background:#181818;",
  "color:#eaeaea;font:inherit;text-align:left;cursor:pointer;",
  "transition:border-color .12s ease,background .12s ease}",
  "#rs-panel-card .rs-tcard:hover{background:#1e1e1e;border-color:rgba(255,255,255,.18)}",
  "#rs-panel-card .rs-tcard[aria-pressed=true]{border-color:#1ed760}",
  "#rs-panel-card .rs-prev{position:relative;height:52px;border-radius:6px;overflow:hidden;",
  "border:1px solid rgba(255,255,255,.06);margin-bottom:7px}",
  "#rs-panel-card .rs-prev .bs{position:absolute;inset:0}",
  "#rs-panel-card .rs-prev .ac{position:absolute;left:8px;right:8px;bottom:8px;height:16px;border-radius:4px}",
  "#rs-panel-card .rs-lbl{display:flex;align-items:center;justify-content:space-between;gap:6px;",
  "font-size:12px;font-weight:600}",
  "#rs-panel-card .rs-lbl .ok{display:none;color:#1ed760}",
  "#rs-panel-card .rs-tcard[aria-pressed=true] .rs-lbl .ok{display:block}",
  // -- not + alt bilgi --
  "#rs-panel-card .rs-note{margin:4px 0 0;color:#8f8f8f;font-size:11.5px}",
  "#rs-panel-card .rs-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;",
  "flex-wrap:wrap;margin-top:14px;padding-top:10px;border-top:1px solid rgba(255,255,255,.07);",
  "color:#6a6a6a;font-size:11px}",
  // -- odak + kucuk ekranlar --
  "#rs-panel-btn:focus-visible,.rs-panel-card .rs-sw:focus-visible,.rs-panel-card .rs-btn:focus-visible,",
  ".rs-panel-card .rs-x:focus-visible,.rs-panel-card .rs-tcard:focus-visible{outline:2px solid #1ed760;",
  "outline-offset:2px}",
  "@media (max-width:520px){#rs-panel{padding:12px 8px}#rs-panel-card .rs-head{padding:12px}",
  "#rs-panel-card .rs-body{padding:2px 12px 14px}}",
  "@media (max-width:360px){#rs-panel-card .rs-grid{grid-template-columns:1fr}}",
].join("");

function makePanelModule(win, api, registry) {
  const doc = win.document;
  // Profesyonel SVG ikonlar (emoji yasak — AGENTS.md ikon standardı)
  const GEAR =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="3.4"/>' +
    '<path d="M12 3.2v2.6M12 18.2v2.6M3.2 12h2.6M18.2 12h2.6M5.7 5.7l1.9 1.9' +
    'M16.4 16.4l1.9 1.9M18.3 5.7l-1.9 1.9M7.6 16.4l-1.9 1.9"/></svg>';
  const SV = 'viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" ' +
    'stroke-width="1.4" aria-hidden="true"';
  const ICO = {
    close:
      '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>',
    check:
      '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 8.5l3.4 3.4L13 5.2"/></svg>',
    palette:
      '<svg ' + SV + ' stroke-linecap="round"><circle cx="8" cy="8" r="6.1"/>' +
      '<circle cx="5.7" cy="6.6" r=".95" fill="currentColor" stroke="none"/>' +
      '<circle cx="10.3" cy="6.6" r=".95" fill="currentColor" stroke="none"/>' +
      '<circle cx="8" cy="10.4" r=".95" fill="currentColor" stroke="none"/></svg>',
    apps:
      '<svg ' + SV + '><rect x="2.4" y="2.4" width="5" height="5" rx="1.3"/>' +
      '<rect x="8.6" y="2.4" width="5" height="5" rx="1.3"/>' +
      '<rect x="2.4" y="8.6" width="5" height="5" rx="1.3"/>' +
      '<rect x="8.6" y="8.6" width="5" height="5" rx="1.3"/></svg>',
    shield:
      '<svg ' + SV + ' stroke-linejoin="round"><path d="M8 1.9l5 1.9v3.9c0 3.1-2.1 5.2-5 6.3' +
      '-2.9-1.1-5-3.2-5-6.3V3.8L8 1.9z"/><path d="M5.4 5.4l5.2 5.2" stroke-linecap="round"/></svg>',
    wave:
      '<svg ' + SV + ' stroke-linecap="round"><path d="M2.6 8h1.3M5.7 4.9v6.2M8.3 6.4v3.2' +
      'M10.9 5.3v5.4M13.4 7.3v1.4"/></svg>',
    info:
      '<svg ' + SV + ' stroke-linecap="round"><circle cx="8" cy="8" r="6.1"/>' +
      '<path d="M8 7.3v3.6M8 5.1v.4"/></svg>',
  };

  function closePanel() {
    const el = doc.getElementById("rs-panel");
    if (el) el.remove();
    const btn = doc.getElementById("rs-panel-btn");
    if (btn && btn.isConnected) {
      try {
        btn.focus();
      } catch (_) {}
    }
  }

  function section(t, ico) {
    const sec = doc.createElement("div");
    sec.className = "rs-sec";
    const h = doc.createElement("h3");
    h.innerHTML = ico || "";
    const sp = doc.createElement("span");
    sp.textContent = t;
    h.appendChild(sp);
    sec.appendChild(h);
    return sec;
  }

  function row(name, sub, tail) {
    const r = doc.createElement("div");
    r.className = "rs-row";
    const col = doc.createElement("div");
    col.className = "rs-col";
    const nm = doc.createElement("span");
    nm.className = "rs-nm";
    nm.textContent = name;
    col.appendChild(nm);
    if (sub) {
      const s = doc.createElement("span");
      s.className = "rs-sub";
      s.textContent = sub;
      col.appendChild(s);
    }
    r.appendChild(col);
    if (tail) r.appendChild(tail);
    return r;
  }

  function pillBtn(text, onClick, sec) {
    const b = doc.createElement("button");
    b.className = "rs-btn" + (sec ? " sec" : "");
    b.type = "button";
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  function sw(on, onToggle, disabled) {
    const b = doc.createElement("button");
    b.className = "rs-sw";
    b.type = "button";
    b.setAttribute("role", "switch");
    b.setAttribute("aria-checked", on ? "true" : "false");
    if (disabled) b.disabled = true;
    else if (onToggle) b.addEventListener("click", onToggle);
    return b;
  }

  function note(t) {
    const p = doc.createElement("p");
    p.className = "rs-note";
    p.textContent = t;
    return p;
  }

  function themeCard(id, label, selected, onClick) {
    const c = doc.createElement("button");
    c.className = "rs-tcard";
    c.type = "button";
    c.setAttribute("aria-pressed", selected ? "true" : "false");
    const colors = swatchFor(id);
    const prev = doc.createElement("div");
    prev.className = "rs-prev";
    const bs = doc.createElement("div");
    bs.className = "bs";
    bs.style.background = colors[0];
    const ac = doc.createElement("div");
    ac.className = "ac";
    ac.style.background = colors[1];
    prev.append(bs, ac);
    const lbl = doc.createElement("div");
    lbl.className = "rs-lbl";
    const t = doc.createElement("span");
    t.textContent = label;
    const ok = doc.createElement("span");
    ok.className = "ok";
    ok.innerHTML = ICO.check;
    lbl.append(t, ok);
    c.append(prev, lbl);
    c.addEventListener("click", onClick);
    return c;
  }

  function fill(card) {
    card.innerHTML = "";
    // ---- Başlık ----
    const head = doc.createElement("div");
    head.className = "rs-head";
    const mark = doc.createElement("div");
    mark.className = "rs-mark";
    mark.textContent = "R";
    const hgrp = doc.createElement("div");
    hgrp.className = "rs-hgrp";
    const ttl = doc.createElement("div");
    ttl.className = "rs-ttl";
    ttl.textContent = "ReverseSpotify";
    const failed = (api.modules && api.modules.failed) || [];
    const pill = doc.createElement("span");
    pill.className = "rs-pill" + (failed.length ? " warn" : "");
    if (failed.length) pill.title = "Sorunlu modüller: " + failed.join(", ");
    const dot = doc.createElement("i");
    const ptxt = doc.createElement("span");
    ptxt.textContent = failed.length ? "kısmi" : "aktif";
    pill.append(dot, ptxt);
    hgrp.append(ttl, pill);
    const x = doc.createElement("button");
    x.className = "rs-x";
    x.type = "button";
    x.setAttribute("aria-label", "Paneli kapat");
    x.innerHTML = ICO.close;
    x.addEventListener("click", closePanel);
    head.append(mark, hgrp, x);
    const body = doc.createElement("div");
    body.className = "rs-body";

    // ---- Tema ----
    const s1 = section("Tema", ICO.palette);
    let override = null;
    try {
      override = win.localStorage.getItem("rs:theme");
    } catch (_) {}
    const cur = resolveTheme(win, api.settings);
    const cfgTheme = (api.settings && api.settings.theme) || null;
    if (override !== null && cfgTheme) {
      s1.appendChild(
        row(
          "Panel override: " + override,
          "Config: " + cfgTheme + " · seçili: " + (cur || "kapalı"),
          pillBtn("Varsayılan", async () => {
            await api.setTheme(null);
            fill(card);
          }, true)
        )
      );
    }
    const themes =
      api.settings && Array.isArray(api.settings.themes) && api.settings.themes.length
        ? api.settings.themes.slice()
        : cfgTheme
          ? [cfgTheme]
          : [];
    const grid = doc.createElement("div");
    grid.className = "rs-grid";
    grid.appendChild(
      themeCard("", "Kapalı (vanilla)", cur === null, async () => {
        await api.setTheme("");
        fill(card);
      })
    );
    for (const t of themes) {
      grid.appendChild(
        themeCard(t, t, cur === t, async () => {
          await api.setTheme(t);
          fill(card);
        })
      );
    }
    s1.appendChild(grid);
    body.appendChild(s1);

    // ---- Pluginler ----
    const s2 = section("Pluginler", ICO.apps);
    const plugs = (api.settings && api.settings.plugins) || [];
    if (!plugs.length) s2.appendChild(note("Kurulu plugin yok — CLI: plugins add <id>"));
    for (const p of plugs) {
      if (!p || typeof p.id !== "string") continue;
      const st = pluginRuntimeState(p, registry);
      const meta = [
        p.perfClass,
        Array.isArray(p.permissions) && p.permissions.length ? p.permissions.join(", ") : null,
      ]
        .filter(Boolean)
        .join(" · ");
      if (st === "cli-pasif") {
        const t = sw(false, null, true);
        t.title = "CLI ile pasif — plugins enable <id>";
        s2.appendChild(row(p.id, (meta ? meta + " · " : "") + "CLI pasif", t));
      } else if (st === "aktif") {
        s2.appendChild(
          row(p.id, (meta ? meta + " · " : "") + "açık", sw(true, () => {
            registry.disable("plugin:" + p.id);
            fill(card);
          }))
        );
      } else {
        s2.appendChild(
          row(p.id, (meta ? meta + " · " : "") + "kapalı", sw(false, () => {
            registry.remove("plugin:" + p.id);
            fill(card);
          }))
        );
      }
    }
    if (plugs.length) s2.appendChild(note("Plugin açma/kapama bir sonraki açılışta geçerlidir."));
    body.appendChild(s2);

    // ---- Reklam ve UI temizliği ----
    const s3 = section("Reklam ve UI temizliği", ICO.shield);
    const selCount = api.Adblock ? api.Adblock.selectors : 0;
    const adOn = !registry.isDisabled("adblock");
    s3.appendChild(
      row(
        "Adblock",
        selCount + " seçik · mod " + (api.Adblock ? api.Adblock.mode : "?"),
        sw(adOn, () => {
          if (adOn) {
            registry.disable("adblock");
            const el = doc.getElementById("rs-adblock");
            if (el) el.remove();
          } else {
            registry.remove("adblock");
            makeAdblockModule(win, api).run();
          }
          fill(card);
        })
      )
    );
    for (const g of Object.keys(UI_GROUPS)) {
      let off = false;
      try {
        off = win.localStorage.getItem("rs:ui:" + g) === "0";
      } catch (_) {}
      const hidden = !off;
      s3.appendChild(
        row(groupLabel(g), hidden ? "gizli" : "görünür", sw(hidden, () => {
          try {
            if (hidden) win.localStorage.setItem("rs:ui:" + g, "0");
            else win.localStorage.removeItem("rs:ui:" + g);
          } catch (_) {}
          makeUiOverhaulModule(win, api).run();
          fill(card);
        }))
      );
    }
    body.appendChild(s3);

    // ---- Kalite ----
    const s4 = section("Kalite seçenekleri", ICO.wave);
    const qn = (api.Quality && api.Quality.revealed) || 0;
    s4.appendChild(
      row(
        "Ayarlar > Çalma kalitesi",
        "reveal-only · " + (qn ? "+" + qn + " seçenek açıldı" : "premium bypass yok — mevcut seçenekler açılır"),
        pillBtn(qn ? "Tekrar göster" : "Göster", () => {
          if (api.revealQuality) api.revealQuality();
          fill(card);
        })
      )
    );
    body.appendChild(s4);

    // ---- Bilgi ----
    const s5 = section("Bilgi", ICO.info);
    const kbds = doc.createElement("div");
    kbds.className = "rs-kbds";
    for (const k of ["Ctrl+Shift+,", "ESC"]) {
      const kd = doc.createElement("span");
      kd.className = "rs-kbd";
      kd.textContent = k;
      kbds.appendChild(kd);
    }
    s5.appendChild(row("Paneli aç / kapat", "klavye kısayolları", kbds));
    s5.appendChild(
      note(
        "mod: " +
          (api.Adblock ? api.Adblock.mode : "?") +
          " · fallback: " +
          (api.fallbacks.length ? api.fallbacks.join(",") : "yok") +
          " · konsol: window.ReverseSpotify"
      )
    );
    s5.appendChild(
      note("Genel sıfırlama: localStorage.removeItem('rs:disabled') · CLI: python -m reversespotify status")
    );
    const foot = doc.createElement("div");
    foot.className = "rs-foot";
    const f1 = doc.createElement("span");
    f1.textContent = "ReverseSpotify · aegisSoft · MrSpy00";
    const f2 = doc.createElement("span");
    f2.textContent = "github.com/MrSpy00/ReverseSpotify";
    foot.append(f1, f2);
    s5.appendChild(foot);
    body.appendChild(s5);

    card.append(head, body);
  }

  function openPanel() {
    if (doc.getElementById("rs-panel")) return;
    const ov = doc.createElement("div");
    ov.id = "rs-panel";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "ReverseSpotify kontrol paneli");
    const card = doc.createElement("div");
    card.id = "rs-panel-card";
    ov.appendChild(card);
    ov.addEventListener("click", (e) => {
      if (e.target === ov) closePanel();
    });
    (doc.body || doc.documentElement).appendChild(ov);
    fill(card);
    const xb = card.querySelector(".rs-x");
    if (xb) {
      try {
        xb.focus();
      } catch (_) {}
    }
  }

  function toggle() {
    if (doc.getElementById("rs-panel")) closePanel();
    else openPanel();
  }

  return {
    name: "panel",
    run() {
      setStyle(doc, "rs-panel-css", PANEL_CSS);
      let btn = doc.getElementById("rs-panel-btn");
      if (!btn) {
        btn = doc.createElement("button");
        btn.id = "rs-panel-btn";
        btn.type = "button";
        btn.title = "ReverseSpotify paneli (Ctrl+Shift+,)";
        btn.setAttribute("aria-label", "ReverseSpotify kontrol paneli");
        btn.innerHTML = GEAR;
        btn.addEventListener("click", toggle);
        (doc.body || doc.documentElement).appendChild(btn);
      }
      // Üst bara yerleştir; bulunamazsa sabit fallback; Spotify yeniden
      // çizerse toparla. Buton, üst bara yerleşene (veya 5sn geçene) kadar
      // gizli kalır — alt köşeden üst bara zıplama olmaz.
      const t0 = Date.now();
      let shown = false;
      const show = () => {
        if (!shown) {
          shown = true;
          btn.style.visibility = "";
        }
      };
      const ensureMounted = () => {
        try {
          const slot = topbarSlot(doc);
          const inTop = btn.classList.contains("rs-in-topbar");
          if (inTop && btn.isConnected && (!slot || btn.parentElement === slot.parent)) {
            show();
            return;
          }
          btn.className = "";
          if (slot) {
            const ref = slot.before;
            if (ref && typeof ref.className === "string" && ref.className) {
              // Spotify'ın kendi buton sınıflarını kopyala → yerel görünüm
              btn.className = ref.className + " rs-in-topbar";
            } else {
              btn.className = "rs-in-topbar";
            }
            slot.parent.insertBefore(btn, slot.before);
            show();
          } else if (!btn.isConnected) {
            (doc.body || doc.documentElement).appendChild(btn);
          }
          if (!shown && Date.now() - t0 > 5000) show();
        } catch (_) {
          try {
            if (!btn.isConnected) (doc.body || doc.documentElement).appendChild(btn);
            if (!shown && Date.now() - t0 > 5000) show();
          } catch (__) {}
        }
      };
      btn.style.visibility = "hidden";
      ensureMounted();
      // ilk 10 deneme 400ms (üst bar açılışı beklenir), sonrası 3sn guard
      let tries = 0;
      const tick = () => {
        ensureMounted();
        tries += 1;
        win.setTimeout(tick, tries <= 10 ? 400 : 3000);
      };
      win.setTimeout(tick, 400);
      // TR klavyede Shift+, produces "<" — her iki tuş da açılır; ESC kapatır
      win.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && doc.getElementById("rs-panel")) {
          closePanel();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "," || e.key === "<")) {
          e.preventDefault();
          toggle();
        }
      });
    },
  };
}

// ---- Dışa aktarım / giriş ----

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    bootModules,
    createDisableRegistry,
    applyResetDisabled,
    pickChunkGlobal,
    candidateModules,
    applyThemeCss,
    themeEngineModule,
    makePluginApi,
    runPlugins,
    makeAdblockModule,
    makeUiOverhaulModule,
    makeQualityModule,
    makePanelModule,
    swatchFor,
    groupLabel,
    topbarSlot,
    resolveTheme,
    pluginRuntimeState,
    ADBLOCK_SELECTORS,
  };
}

if (typeof document !== "undefined") {
  try {
    browserBoot();
  } catch (e) {
    console.error("[ReverseSpotify] boot kritik hata (izole)", e);
  }
}
