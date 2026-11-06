import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { candidateModules } = require("../../loader/reverse-loader.js");

test("candidateModules finds react factories by source markers", () => {
  const out = candidateModules({
    "10": "function(){ createElement('div'); useState(); }",
    "11": "function(){ createElement('span'); useMemo(); }",
    "12": "function(){ return someOther(); }",
  });
  assert.deepEqual(out.react, ["10", "11"]);
  assert.deepEqual(out.platform, []);
  assert.deepEqual(out.router, []);
});

test("candidateModules classifies platform and router factories", () => {
  const out = candidateModules({
    "1": "x.getAppState()",
    "2": "const x = getURI();",
    "3": "useLocation() and <Route/>",
    "4": "unrelated",
  });
  assert.deepEqual(out.platform.sort(), ["1", "2"]);
  assert.deepEqual(out.router, ["3"]);
  assert.deepEqual(out.react, []);
});
