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

const PANEL_CSS = [
  "#rs-panel-btn{position:fixed;right:14px;bottom:110px;z-index:99999;width:34px;height:34px;",
  "border-radius:50%;border:1px solid #3e3e3e;background:#181818;color:#b3b3b3;cursor:pointer;",
  "display:flex;align-items:center;justify-content:center;opacity:.55;transition:opacity .15s}",
  "#rs-panel-btn:hover{opacity:1}",
  "#rs-panel{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);display:flex;",
  "align-items:center;justify-content:center}",
  "#rs-panel-card{min-width:min(440px,92vw);max-width:min(440px,92vw);max-height:82vh;overflow:auto;",
  "background:#121212;border:1px solid #2a2a2a;border-radius:10px;color:#eaeaea;",
  "font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px 16px 14px;position:relative}",
  "#rs-panel-card h2{margin:0 0 10px;font-size:16px;font-weight:700}",
  "#rs-panel-card h3{margin:14px 0 6px;font-size:11px;font-weight:600;letter-spacing:.06em;",
  "text-transform:uppercase;color:#a7a7a7}",
  "#rs-panel-card .rs-row{display:flex;gap:8px;align-items:center;padding:7px 8px;margin-bottom:6px;",
  "border:1px solid #262626;border-radius:8px;background:#181818}",
  "#rs-panel-card .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  "#rs-panel-card .st{color:#8f8f8f;font-size:11px;flex:none}",
  "#rs-panel-card .rs-btn{border:1px solid #3e3e3e;background:#232323;color:#eaeaea;border-radius:6px;",
  "padding:4px 10px;font-size:12px;cursor:pointer;flex:none}",
  "#rs-panel-card .rs-btn:hover{background:#2e2e2e}",
  "#rs-panel-card .rs-btn[disabled]{opacity:.45;cursor:default}",
  "#rs-panel-card .rs-note{color:#7a7a7a;font-size:11px;margin:4px 0}",
  "#rs-panel-card .rs-close{position:absolute;top:10px;right:12px;border:0;background:none;",
  "color:#a7a7a7;font-size:12px;cursor:pointer}",
  "#rs-panel-card .rs-close:hover{color:#fff}",
].join("");

function makePanelModule(win, api, registry) {
  const doc = win.document;
  // Profesyonel SVG dişli (emoji yasak — AGENTS.md ikon standardı)
  const GEAR =
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="3.4"/>' +
    '<path d="M12 3.2v2.6M12 18.2v2.6M3.2 12h2.6M18.2 12h2.6M5.7 5.7l1.9 1.9' +
    'M16.4 16.4l1.9 1.9M18.3 5.7l-1.9 1.9M7.6 16.4l-1.9 1.9"/></svg>';

  function closePanel() {
    const el = doc.getElementById("rs-panel");
    if (el) el.remove();
  }
  function section(t) {
    const el = doc.createElement("h3");
    el.textContent = t;
    return el;
  }
  function row(name, state, btnText, onClick, disabled) {
    const r = doc.createElement("div");
    r.className = "rs-row";
    const nm = doc.createElement("span");
    nm.className = "nm";
    nm.textContent = name;
    const st = doc.createElement("span");
    st.className = "st";
    st.textContent = state;
    const b = doc.createElement("button");
    b.className = "rs-btn";
    b.textContent = btnText;
    if (disabled) b.disabled = true;
    else if (onClick) b.addEventListener("click", onClick);
    r.append(nm, st, b);
    return r;
  }
  function note(t) {
    const el = doc.createElement("div");
    el.className = "rs-note";
    el.textContent = t;
    return el;
  }

  function fill(card) {
    card.innerHTML = "";
    const h = doc.createElement("h2");
    h.textContent = "ReverseSpotify";
    const close = doc.createElement("button");
    close.className = "rs-close";
    close.textContent = "Kapat";
    close.addEventListener("click", closePanel);
    card.append(h, close);
    card.appendChild(
      note("Panel seçimleri localStorage'da saklanır; CLI config'i sonraki açılışta esas alınır.")
    );

    // ---- Tema ----
    card.appendChild(section("Tema"));
    let override = null;
    try {
      override = win.localStorage.getItem("rs:theme");
    } catch (_) {}
    const cur = resolveTheme(win, api.settings);
    const cfgTheme = (api.settings && api.settings.theme) || null;
    if (override !== null && cfgTheme) {
      card.appendChild(
        row("Varsayılan (config): " + cfgTheme, cur === cfgTheme ? "seçili" : "", "Seç", async () => {
          await api.setTheme(null);
          fill(card);
        })
      );
    }
    const themes =
      api.settings && Array.isArray(api.settings.themes) && api.settings.themes.length
        ? api.settings.themes
        : cfgTheme
          ? [cfgTheme]
          : [];
    for (const t of themes) {
      card.appendChild(
        row(t, cur === t ? "seçili" : "", "Seç", async () => {
          await api.setTheme(t);
          fill(card);
        })
      );
    }
    card.appendChild(
      row("Kapalı (vanilla görünüm)", cur === null ? "seçili" : "", "Seç", async () => {
        await api.setTheme("");
        fill(card);
      })
    );

    // ---- Pluginler ----
    card.appendChild(section("Pluginler"));
    const plugs = (api.settings && api.settings.plugins) || [];
    if (!plugs.length) card.appendChild(note("Kurulu plugin yok (CLI: plugins add <id>)."));
    for (const p of plugs) {
      if (!p || typeof p.id !== "string") continue;
      const state = pluginRuntimeState(p, registry);
      if (state === "cli-pasif") {
        card.appendChild(row(p.id, "CLI pasif", "CLI ile açın", null, true));
      } else if (state === "aktif") {
        card.appendChild(
          row(p.id, "açık", "Kapat", () => {
            registry.disable("plugin:" + p.id);
            fill(card);
          })
        );
      } else {
        card.appendChild(
          row(p.id, "kapalı", "Aç", () => {
            registry.remove("plugin:" + p.id);
            fill(card);
          })
        );
      }
    }
    if (plugs.length) card.appendChild(note("Plugin açma/kapama bir sonraki açılışta geçerlidir."));

    // ---- Reklam ve UI temizliği ----
    card.appendChild(section("Reklam ve UI temizliği"));
    const adOff = registry.isDisabled("adblock");
    card.appendChild(
      row(
        "Adblock (" + (api.Adblock ? api.Adblock.selectors : 0) + " seçik)",
        adOff ? "kapalı" : "açık",
        adOff ? "Aç" : "Kapat",
        () => {
          if (adOff) {
            registry.remove("adblock");
            makeAdblockModule(win, api).run();
          } else {
            registry.disable("adblock");
            const el = doc.getElementById("rs-adblock");
            if (el) el.remove();
          }
          fill(card);
        }
      )
    );
    for (const g of Object.keys(UI_GROUPS)) {
      let off = false;
      try {
        off = win.localStorage.getItem("rs:ui:" + g) === "0";
      } catch (_) {}
      card.appendChild(
        row(g, off ? "gizli değil" : "gizli", off ? "Gizle" : "Göster", () => {
          try {
            if (off) win.localStorage.removeItem("rs:ui:" + g);
            else win.localStorage.setItem("rs:ui:" + g, "0");
          } catch (_) {}
          makeUiOverhaulModule(win, api).run();
          fill(card);
        })
      );
    }

    // ---- Kalite ----
    card.appendChild(section("Kalite (reveal-only)"));
    const qn = api.Quality && api.Quality.revealed ? api.Quality.revealed : 0;
    card.appendChild(
      row("Kalite seçenekleri", qn ? "+" + qn + " açıldı" : "açılmadı", "Göster", () => {
        if (api.revealQuality) api.revealQuality();
        fill(card);
      })
    );

    // ---- Bilgi ----
    card.appendChild(section("Bilgi"));
    card.appendChild(
      note(
        "mod: " +
          (api.Adblock ? api.Adblock.mode : "?") +
          " · fallback: " +
          (api.fallbacks.length ? api.fallbacks.join(",") : "yok") +
          " · konsol: window.ReverseSpotify"
      )
    );
    card.appendChild(
      note("Genel sıfırlama: localStorage.removeItem('rs:disabled'); CLI: python -m reversespotify status")
    );
  }

  function openPanel() {
    if (doc.getElementById("rs-panel")) return;
    const ov = doc.createElement("div");
    ov.id = "rs-panel";
    const card = doc.createElement("div");
    card.id = "rs-panel-card";
    ov.appendChild(card);
    ov.addEventListener("click", (e) => {
      if (e.target === ov) closePanel();
    });
    (doc.body || doc.documentElement).appendChild(ov);
    fill(card);
  }

  function toggle() {
    if (doc.getElementById("rs-panel")) closePanel();
    else openPanel();
  }

  return {
    name: "panel",
    run() {
      setStyle(doc, "rs-panel-css", PANEL_CSS);
      if (!doc.getElementById("rs-panel-btn")) {
        const b = doc.createElement("button");
        b.id = "rs-panel-btn";
        b.type = "button";
        b.title = "ReverseSpotify paneli (Ctrl+Shift+,)";
        b.innerHTML = GEAR;
        b.addEventListener("click", toggle);
        (doc.body || doc.documentElement).appendChild(b);
      }
      // TR klavyede Shift+, produces "<" — her iki tuş da açılır
      win.addEventListener("keydown", (e) => {
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
