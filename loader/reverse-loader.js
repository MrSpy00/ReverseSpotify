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
        ret.catch((e) => {
          try {
            registry && registry.disable && registry.disable(m.name, e);
          } catch (_) {}
        });
      }
      ran.push(m.name);
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
  };
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

function themeEngineModule(win, fetchFn) {
  const f = fetchFn || ((...a) => (win.fetch || fetch)(...a));
  return {
    name: "theme-engine",
    async run() {
      const api = win.ReverseSpotify;
      const theme = api && api.settings && api.settings.theme;
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
        if (win.localStorage && win.localStorage.getItem("rs:ui:" + group) === "0") continue;
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

// ---- Dışa aktarım / giriş ----

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    bootModules,
    createDisableRegistry,
    pickChunkGlobal,
    candidateModules,
    applyThemeCss,
    themeEngineModule,
    makePluginApi,
    runPlugins,
    makeAdblockModule,
    makeUiOverhaulModule,
    makeQualityModule,
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
