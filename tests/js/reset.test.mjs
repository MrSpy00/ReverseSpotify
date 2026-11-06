import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const loader = require("../../loader/reverse-loader.js");

function fakeStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

test("applyResetDisabled clears enabled names from rs:disabled, keeps others", () => {
  const storage = fakeStorage({
    "rs:disabled": JSON.stringify(["plugin:key-highlight", "theme-engine"]),
  });
  const registry = loader.createDisableRegistry(storage);
  assert.equal(registry.isDisabled("plugin:key-highlight"), true);

  loader.applyResetDisabled(registry, { resetDisabled: ["plugin:key-highlight"] });

  assert.equal(registry.isDisabled("plugin:key-highlight"), false);
  assert.equal(registry.isDisabled("theme-engine"), true); // dokunulmayan kalır
});

test("applyResetDisabled tolerates missing/invalid resetDisabled", () => {
  const storage = fakeStorage({ "rs:disabled": JSON.stringify(["x"]) });
  const registry = loader.createDisableRegistry(storage);
  loader.applyResetDisabled(registry, {});
  loader.applyResetDisabled(registry, { resetDisabled: "not-an-array" });
  assert.equal(registry.isDisabled("x"), true);
});
