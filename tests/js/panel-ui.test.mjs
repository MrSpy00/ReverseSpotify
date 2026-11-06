import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rs = require("../../loader/reverse-loader.js");

// ---- THEME_SWATCHES / swatchFor ----

test("swatchFor: clean-dark gercek tema renkleri", () => {
  assert.deepEqual(rs.swatchFor("clean-dark"), ["#0e0e10", "#1a1a1c"]);
});

test("swatchFor: amoled gercek tema renkleri", () => {
  assert.deepEqual(rs.swatchFor("amoled"), ["#000000", "#0d0d0d"]);
});

test("swatchFor: bilinmeyen id ve null icin varsayilan doner", () => {
  const fallback = ["#121212", "#1f1f1f"];
  assert.deepEqual(rs.swatchFor("yok-boyle"), fallback);
  assert.deepEqual(rs.swatchFor(null), fallback);
  assert.deepEqual(rs.swatchFor(undefined), fallback);
  // donen dizi kopya olmalı: degistirmek sabitleri bozmamali
  const a = rs.swatchFor("clean-dark");
  a[0] = "#ff0000";
  assert.deepEqual(rs.swatchFor("clean-dark"), ["#0e0e10", "#1a1a1c"]);
});

// ---- UI_LABELS / groupLabel ----

test("groupLabel: bilinen gruplar icin insancil etiket", () => {
  assert.equal(rs.groupLabel("upsell"), "İndirme ve upgrade bannerları");
  assert.equal(rs.groupLabel("dsa"), "Ana sayfa duyuru bandı");
});

test("groupLabel: bilinmeyen grup id'yi oldugu gibi doner", () => {
  assert.equal(rs.groupLabel("gelecek-grup"), "gelecek-grup");
  assert.equal(rs.groupLabel(""), "");
});

// ---- topbarSlot montaj hedefi ----

test("topbarSlot: user-widget-link'i tercih eder, parent'ini ve before'u dondurur", () => {
  const parent = { tag: "right-cluster" };
  const ref = { tag: "user-widget-link", parentElement: parent };
  const doc = {
    querySelector(sel) {
      return sel.includes("user-widget-link") ? ref : null;
    },
  };
  const slot = rs.topbarSlot(doc);
  assert.equal(slot.parent, parent);
  assert.equal(slot.before, ref);
});

test("topbarSlot: user-widget yoksa friend-activity'e duser", () => {
  const parent = { tag: "right-cluster" };
  const ref = { tag: "friend-activity-button", parentElement: parent };
  const doc = {
    querySelector(sel) {
      return sel.includes("friend-activity-button") ? ref : null;
    },
  };
  const slot = rs.topbarSlot(doc);
  assert.equal(slot.parent, parent);
  assert.equal(slot.before, ref);
});

test("topbarSlot: hicbir hedef yoksa null (fallback konum icin)", () => {
  assert.equal(rs.topbarSlot({ querySelector: () => null }), null);
  assert.equal(rs.topbarSlot({ querySelector: () => ({ parentElement: null }) }), null);
});
