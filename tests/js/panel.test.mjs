// Panel desteği (tema override, plugin durumu) + async bootModules izolasyonu.
import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const rs = require("../../loader/reverse-loader.js");

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test("resolveTheme: localStorage yoksa config teması", () => {
  const win = { localStorage: fakeStorage() };
  assert.equal(rs.resolveTheme(win, { theme: "clean-dark" }), "clean-dark");
});

test("resolveTheme: rs:theme override config'i ezer", () => {
  const win = { localStorage: fakeStorage({ "rs:theme": "amoled" }) };
  assert.equal(rs.resolveTheme(win, { theme: "clean-dark" }), "amoled");
});

test("resolveTheme: bos override temayi kapatir (vanilla gorunum)", () => {
  const win = { localStorage: fakeStorage({ "rs:theme": "" }) };
  assert.equal(rs.resolveTheme(win, { theme: "clean-dark" }), null);
});

test("resolveTheme: eksik settings toleransı", () => {
  const win = { localStorage: fakeStorage() };
  assert.equal(rs.resolveTheme(win, null), null);
});

test("bootModules: reject eden async modul failed'a girer, ran'a girmez", async () => {
  const disabled = [];
  const registry = {
    isDisabled: () => false,
    disable: (n) => disabled.push(n),
  };
  const res = rs.bootModules(
    [{ name: "asyncbad", run: () => Promise.reject(new Error("x")) }],
    registry
  );
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(res.ran, []);
  assert.deepEqual(res.failed, ["asyncbad"]);
  assert.deepEqual(disabled, ["asyncbad"]);
});

test("bootModules: resolve olan async modul ran'a girer", async () => {
  const registry = { isDisabled: () => false, disable: () => {} };
  const res = rs.bootModules(
    [{ name: "asyncok", run: () => Promise.resolve(1) }],
    registry
  );
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(res.ran, ["asyncok"]);
  assert.deepEqual(res.failed, []);
});

test("pluginRuntimeState: cli pasif / runtime kapali / aktif ayrimi", () => {
  const reg = { isDisabled: (n) => n === "plugin:b" };
  assert.equal(rs.pluginRuntimeState({ id: "a", enabled: true }, reg), "aktif");
  assert.equal(rs.pluginRuntimeState({ id: "b", enabled: true }, reg), "runtime-kapali");
  assert.equal(rs.pluginRuntimeState({ id: "c", enabled: false }, reg), "cli-pasif");
  assert.equal(rs.pluginRuntimeState(null, reg), "cli-pasif");
});
