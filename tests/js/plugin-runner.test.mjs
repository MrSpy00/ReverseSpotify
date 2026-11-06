import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { runPlugins, createDisableRegistry } = require("../../loader/reverse-loader.js");

function mkStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function mkApi() {
  const api = {
    settings: { theme: null, plugins: [] },
    React: null,
    Platform: null,
    _readyCbs: [],
    onReady(cb) {
      cb(api);
    },
    onRouteChange() {},
  };
  return api;
}

const okFetch = async (url) => ({ ok: true, text: async () => "" });

test("crashing plugin disabled, next plugin runs", async () => {
  const storage = mkStorage();
  const registry = createDisableRegistry(storage);
  const api = mkApi();
  const list = [
    { id: "boom", entry: "index.js", enabled: true, permissions: [] },
    { id: "ok", entry: "index.js", enabled: true, permissions: ["settings"] },
  ];
  const res = await runPlugins(
    api,
    registry,
    list,
    async (url) => ({
      ok: true,
      text: async () => (url.includes("boom") ? "throw new Error('pat')" : "ReverseSpotify.settings.set('ran', 1);"),
    }),
    storage
  );

  assert.deepEqual(res.failed, ["boom"]);
  assert.deepEqual(res.ok, ["ok"]);
  assert.match(storage.getItem("rs:disabled"), /plugin:boom/);
  assert.match(storage.getItem("rs:error"), /boom/);
  assert.equal(api.settings.ran, 1);

  // bir sonraki boot: boom fetch bile edilmez
  const fetched = [];
  await runPlugins(
    api,
    registry,
    list,
    async (url) => {
      fetched.push(url);
      return okFetch(url);
    },
    storage
  );
  assert.ok(!fetched.some((u) => u.includes("boom")));
});

test("plugin receives settings get/set roundtrip", async () => {
  const storage = mkStorage();
  const registry = createDisableRegistry(storage);
  const api = mkApi();
  const res = await runPlugins(
    api,
    registry,
    [{ id: "rt", entry: "index.js", enabled: true, permissions: ["settings"] }],
    async () => ({
      ok: true,
      text: async () =>
        "ReverseSpotify.settings.set('volume', 7); if (ReverseSpotify.settings.get('volume') !== 7) throw new Error('roundtrip');",
    }),
    storage
  );
  assert.deepEqual(res.ok, ["rt"]);
  assert.equal(api.settings.volume, 7);
});

test("plugin without ui permission gets no UI, with permission gets it", async () => {
  const storage = mkStorage();
  const registry = createDisableRegistry(storage);
  const api = mkApi();
  const res = await runPlugins(
    api,
    registry,
    [
      { id: "no-ui", entry: "i.js", enabled: true, permissions: ["settings"] },
      { id: "with-ui", entry: "i.js", enabled: true, permissions: ["settings", "ui"] },
    ],
    async (url) => ({
      ok: true,
      text: async () =>
        url.includes("no-ui")
          ? "ReverseSpotify.settings.set('noUiHasUi', !!ReverseSpotify.UI);"
          : "ReverseSpotify.settings.set('withUiHasUi', !!ReverseSpotify.UI);",
    }),
    storage
  );
  assert.deepEqual(res.ok, ["no-ui", "with-ui"]);
  assert.equal(api.settings.noUiHasUi, false);
  assert.equal(api.settings.withUiHasUi, true);
});

test("disabled plugin is skipped without fetch", async () => {
  const storage = mkStorage();
  const registry = createDisableRegistry(storage);
  const api = mkApi();
  const fetched = [];
  const res = await runPlugins(
    api,
    registry,
    [{ id: "off", entry: "i.js", enabled: false, permissions: [] }],
    async (url) => {
      fetched.push(url);
      return okFetch(url);
    },
    storage
  );
  assert.deepEqual(res.skipped, ["off"]);
  assert.equal(fetched.length, 0);
});

test("crash inside onReady callback isolates the plugin", async () => {
  const storage = mkStorage();
  const registry = createDisableRegistry(storage);
  const api = mkApi();
  const res = await runPlugins(
    api,
    registry,
    [{ id: "late", entry: "i.js", enabled: true, permissions: [] }],
    async () => ({ ok: true, text: async () => "ReverseSpotify.onReady(() => { throw new Error('ready'); });" }),
    storage
  );
  assert.deepEqual(res.ok, ["late"]); // kayıt başarılı...
  assert.match(storage.getItem("rs:disabled"), /plugin:late/); // ...ama callback çöküşü izole disable
  assert.match(storage.getItem("rs:error"), /ready/);
});
