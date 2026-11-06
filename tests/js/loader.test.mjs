import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { bootModules, createDisableRegistry } = require("../../loader/reverse-loader.js");

test("boot isolates a throwing module", () => {
  const calls = [];
  const disabled = [];
  const registry = {
    isDisabled: () => false,
    disable: (name) => disabled.push(name),
  };
  const { ran, failed } = bootModules(
    [
      {
        name: "bad",
        run() {
          throw new Error("boom");
        },
      },
      {
        name: "good",
        run() {
          calls.push(1);
        },
      },
    ],
    registry
  );
  assert.deepEqual(calls, [1]);
  assert.deepEqual(ran, ["good"]);
  assert.deepEqual(failed, ["bad"]);
  assert.deepEqual(disabled, ["bad"]);
});

test("boot skips previously disabled modules", () => {
  const calls = [];
  const registry = {
    isDisabled: (name) => name === "bad",
    disable: () => {},
  };
  const { ran } = bootModules(
    [
      {
        name: "bad",
        run() {
          calls.push(1);
        },
      },
      {
        name: "good",
        run() {
          calls.push(2);
        },
      },
    ],
    registry
  );
  assert.deepEqual(calls, [2]);
  assert.deepEqual(ran, ["good"]);
});

test("disable registry persists across instances via storage", () => {
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
  };
  const reg = createDisableRegistry(storage);
  assert.equal(reg.isDisabled("x"), false);
  reg.disable("x");
  assert.equal(reg.isDisabled("x"), true);

  const reg2 = createDisableRegistry(storage); // yeni instance, aynı storage
  assert.equal(reg2.isDisabled("x"), true);
});

test("disable() storage hatasını yuturur (çökme yok)", () => {
  const storage = {
    getItem: () => {
      throw new Error("storage kapalı");
    },
    setItem: () => {
      throw new Error("storage kapalı");
    },
  };
  const reg = createDisableRegistry(storage);
  assert.equal(reg.isDisabled("y"), false); // hata fırlatmaz
  reg.disable("y"); // hata fırlatmaz
});
