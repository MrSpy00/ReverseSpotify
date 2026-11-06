import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { makePluginApi, themeEngineModule, runPlugins, applyBackground } = require(
  "../../loader/reverse-loader.js"
);

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

// applyBackground için minimal DOM: body.children + id taramalı getElementById
function bgWin(localStorage) {
  const body = {
    children: [],
    firstChild: null,
    insertBefore(el) {
      this.children.unshift(el);
      this.firstChild = el;
    },
  };
  const doc = {
    body,
    getElementById(id) {
      return body.children.find((c) => c.id === id) || null;
    },
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        id: "",
        textContent: "",
        style: {},
        children: [],
        setAttribute() {},
        appendChild(c) {
          this.children.push(c);
        },
        remove() {
          const i = body.children.indexOf(el);
          if (i >= 0) body.children.splice(i, 1);
        },
      };
      return el;
    },
  };
  return { document: doc, localStorage };
}

// ---- 1) plugin ayarları: getSetting/setSetting storage-backed ----

test("plugin settings: setSetting kalıcı, yeni facade okur (rs:set:<id>)", () => {
  const storage = fakeStorage();
  const api = { settings: {} };
  const reg = { disable() {} };
  const f1 = makePluginApi(api, reg, "rt", ["settings"], storage);
  assert.equal(typeof f1.getSetting, "function");
  assert.equal(typeof f1.setSetting, "function");
  assert.equal(f1.getSetting("position", "alt-orta"), "alt-orta"); // default
  f1.setSetting("position", "sag-alt");
  const f2 = makePluginApi(api, reg, "rt", ["settings"], storage);
  assert.equal(f2.getSetting("position", "alt-orta"), "sag-alt"); // kalıcılık
  assert.equal(JSON.parse(storage.getItem("rs:set:rt")).position, "sag-alt");
});

test("plugin settings: settings izni olmayan facade'te getSetting/setSetting yok", () => {
  const f = makePluginApi({ settings: {} }, { disable() {} }, "x", ["ui"], fakeStorage());
  assert.equal(f.getSetting, undefined);
  assert.equal(f.setSetting, undefined);
});

// ---- 2) custom tema: theme.css fetch'siz uygulanır ----

test("custom tema: sunucudan theme.css fetch edilmez, css uygulanır", async () => {
  const storage = fakeStorage();
  storage.setItem(
    "rs:customThemes",
    JSON.stringify([{ id: "mytheme", name: "Benim", swatch: ["#111", "#222"], css: "/*custom*/" }])
  );
  const applied = [];
  const calls = [];
  const win = {
    localStorage: storage,
    ReverseSpotify: {
      settings: { theme: "mytheme" },
      applyTheme: (c) => applied.push(c),
      log() {},
    },
  };
  const fetchFn = (u) => {
    calls.push(u);
    return Promise.resolve({ ok: false, status: 404 });
  };
  await themeEngineModule(win, fetchFn).run();
  assert.deepEqual(applied, ["/*custom*/"]);
  assert.ok(
    !calls.some((u) => u.endsWith("/theme.css")),
    "custom temada theme.css fetch edilmemeli: " + JSON.stringify(calls)
  );
});

// ---- 3) custom plugin: p.code ile çalışır (fetch bypass) ----

test("custom plugin: p.code doğrudan çalışır, ağa dokunulmaz", async () => {
  const calls = [];
  const fetchFn = (u) => {
    calls.push(u);
    return Promise.reject(new Error("ağ yok"));
  };
  const reg = { disable() {}, isDisabled: () => false };
  const out = await runPlugins(
    { settings: {} },
    reg,
    [{ id: "c1", permissions: ["ui"], code: "globalThis.__rs_c1 = (globalThis.__rs_c1 || 0) + 1;" }],
    fetchFn,
    fakeStorage()
  );
  assert.deepEqual(out.ok, ["c1"]);
  assert.deepEqual(out.failed, []);
  assert.deepEqual(calls, [], "custom plugin fetch çağrısı olmamalı");
});

// ---- 4) kullanıcı arkaplanı: rs:bg:<id> manifest spec'ten önce gelir ----

test("kullanıcı görsel arkaplanı manifest background'ını ezer", () => {
  const storage = fakeStorage();
  storage.setItem("rs:bg:crimson", "data:image/png;base64,AAA");
  const win = bgWin(storage);
  assert.equal(applyBackground(win, "crimson", { background: "wallpaper.svg" }), true);
  const layer = win.document.getElementById("rs-bg");
  assert.ok(layer.style.backgroundImage.includes("data:image/png"));
  assert.ok(!layer.style.backgroundImage.includes("wallpaper.svg"));
});

test("kullanıcı video arkaplanı video katmanı üretir (manifest olsa bile)", () => {
  const storage = fakeStorage();
  storage.setItem("rs:bg:ocean", "data:video/mp4;base64,BBB");
  const win = bgWin(storage);
  assert.equal(applyBackground(win, "ocean", { background: "sea.jpg" }), true);
  const layer = win.document.getElementById("rs-bg");
  const v = layer.children[0];
  assert.equal(v.tagName, "VIDEO");
  assert.ok(v.src.startsWith("data:video/mp4"));
});

test("kullanıcı arkaplanı yoksa manifest devam eder, rs:theme temizliği bozulmaz", () => {
  const win = bgWin(fakeStorage());
  assert.equal(applyBackground(win, "crimson", { background: "wallpaper.svg" }), true);
  const layer = win.document.getElementById("rs-bg");
  assert.ok(layer.style.backgroundImage.includes("/reverse/themes/crimson/wallpaper.svg"));
  assert.equal(applyBackground(win, null, null), false);
  assert.equal(win.document.getElementById("rs-bg"), null);
});
