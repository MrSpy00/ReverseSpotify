import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { pickChunkGlobal } = require("../../loader/reverse-loader.js");

test("pickChunkGlobal finds rspack chunk global", () => {
  const g = [];
  assert.equal(pickChunkGlobal({ rspackChunk: g }), g);
});

test("pickChunkGlobal still supports webpack chunk global", () => {
  const g = [];
  assert.equal(pickChunkGlobal({ webpackChunkspotify_desktop: g }), g);
});

test("pickChunkGlobal returns null when no chunk global", () => {
  assert.equal(pickChunkGlobal({ someOther: 1 }), null);
});
