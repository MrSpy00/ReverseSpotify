import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rs = require("../../loader/reverse-loader.js");

// ---- swatchFor (meta tabanlı — renkler manifestten gelir, kodda sabit renk yok) ----

const META = {
  "clean-dark": { name: "Clean Dark", swatch: ["#0e0e10", "#1a1a1c"] },
  amoled: { name: "AMOLED Black", swatch: ["#000000", "#0d0d0d"] },
  bare: { name: "Bare" },
};

test("swatchFor: themeMeta'dan tema renkleri", () => {
  assert.deepEqual(rs.swatchFor(META, "clean-dark"), ["#0e0e10", "#1a1a1c"]);
  assert.deepEqual(rs.swatchFor(META, "amoled"), ["#000000", "#0d0d0d"]);
});

test("swatchFor: meta yok / swatch eksik / bozuk icin varsayilan doner", () => {
  const fallback = ["#121212", "#1f1f1f"];
  assert.deepEqual(rs.swatchFor(META, "yok-boyle"), fallback);
  assert.deepEqual(rs.swatchFor(META, "bare"), fallback);
  assert.deepEqual(rs.swatchFor(null, "clean-dark"), fallback);
  assert.deepEqual(rs.swatchFor(undefined, undefined), fallback);
});

test("swatchFor: donen dizi kopya olmalidir (girdi ve sabit degismez)", () => {
  const a = rs.swatchFor(META, "clean-dark");
  a[0] = "#ff0000";
  assert.deepEqual(rs.swatchFor(META, "clean-dark"), ["#0e0e10", "#1a1a1c"]);
  assert.equal(META["clean-dark"].swatch[0], "#0e0e10");
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
