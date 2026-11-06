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
        { name: "plugins", run() {} },
        { name: "adblock", run() {} },
        { name: "ui-overhaul", run() {} },
        { name: "quality", run() {} },
      ],
      registry
    );
  });
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
  };
}

if (typeof document !== "undefined") {
  try {
    browserBoot();
  } catch (e) {
    console.error("[ReverseSpotify] boot kritik hata (izole)", e);
  }
}
