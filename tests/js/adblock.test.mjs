import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const {
  makeAdblockModule,
  makeUiOverhaulModule,
  makeQualityModule,
  ADBLOCK_SELECTORS,
} = require("../../loader/reverse-loader.js");

const LOADER_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../loader/reverse-loader.js"),
  "utf8"
);

function fakeDoc() {
  const byId = {};
  return {
    byId,
    head: {
      appendChild(el) {
        byId[el.id] = el;
      },
    },
    getElementById(id) {
      return byId[id] || null;
    },
    createElement(tag) {
      return { tagName: tag, id: "", textContent: "" };
    },
  };
}

test("adblock css layer contains discovered selectors", () => {
  const styles = [];
  const doc = fakeDoc();
  const api = { log() {} };
  const m = makeAdblockModule({ document: doc }, api);

  // styles yakala: setStyle fake doc'a yazar, textContent'ten oku
  m.run();
  const el = doc.byId["rs-adblock"];
  assert.ok(el, "adblock style katmanı oluşmalı");
  const css = el.textContent;

  // findings'ten türetilen temsili seçikler (docs/xpui-findings.md)
  const discovered = [
    "home-ads-container",
    "leavebehind",
    "ads-video-player-npv",
    "embedded-ad-carousel",
    "skippable-ad-skip-button",
    "canvas-ad-player",
    "standalone-video-ad-player",
    "ad-controls",
    "survey-ad",
    "button-like-ad",
  ];
  for (const id of discovered) {
    assert.ok(css.includes(`[data-testid="${id}"]`), `css eksik seçik: ${id}`);
  }

  // export edilen her seçik css içinde yer almalı
  for (const id of ADBLOCK_SELECTORS) {
    assert.ok(css.includes(`[data-testid="${id}"]`), `ADBLOCK_SELECTORS css'te yok: ${id}`);
  }

  // dürüst rapor: keşifte ses hook'u yok → ui-only
  assert.equal(api.Adblock.mode, "ui-only");
  assert.equal(api.Adblock.selectors, ADBLOCK_SELECTORS.length);
});

test("ui-overhaul groups are active by default and disable via rs:ui:* keys", () => {
  const doc = fakeDoc();
  const store = {};
  const win = {
    document: doc,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
    },
  };
  const api = { log() {} };

  makeUiOverhaulModule(win, api).run();
  assert.ok(doc.byId["rs-ui-upsell"], "upsell grubu aktif olmalı");
  assert.ok(doc.byId["rs-ui-dsa"], "dsa grubu aktif olmalı");
  assert.deepEqual(api.Ui.active.sort(), ["dsa", "upsell"]);

  // rs:ui:upsell=0 → upsell grubu kapanır, dsa kalır
  const doc2 = fakeDoc();
  const store2 = { "rs:ui:upsell": "0" };
  const win2 = {
    document: doc2,
    localStorage: {
      getItem: (k) => (k in store2 ? store2[k] : null),
    },
  };
  const api2 = { log() {} };
  makeUiOverhaulModule(win2, api2).run();
  assert.equal(doc2.byId["rs-ui-upsell"], undefined, "devre dışı grup style yazmamalı");
  assert.ok(doc2.byId["rs-ui-dsa"], "dokunulmayan grup aktif kalmalı");
  assert.deepEqual(api2.Ui.active, ["dsa"]);
});

test("quality reveal only widens visible options, no entitlement rewrite", () => {
  // 1) davranış: DOM'daki disabled option reveal edilir, option sayısı değişmez
  const disabledOpt = { disabled: true, value: "4" };
  const okOpt = { disabled: false, value: "2" };
  const doc = {
    documentElement: {},
    querySelectorAll(sel) {
      assert.ok(
        sel.includes('select[id*="quality" i] option[disabled]'),
        `beklenmeyen seçici: ${sel}`
      );
      return [disabledOpt];
    },
  };
  const api = { log() {} };
  const m = makeQualityModule({ document: doc }, api);
  m.reveal(doc);
  assert.equal(disabledOpt.disabled, false, "disabled option serbest kalmalı");
  assert.equal(okOpt.disabled, false);
  assert.equal(api.Quality.mode, "reveal-only");

  // 2) grep assertion: entitlement/option üretimine dokunan kod loader'da OLMAMALI
  const forbidden = [
    /entitlement/i,
    /maxSupportedQuality/,
    /streamingQuality\s*[:=]/,
    /subscription/i,
  ];
  for (const re of forbidden) {
    assert.ok(!re.test(LOADER_SRC), `quality kısıtı ihlali: ${re}`);
  }
  // option üretimi quality modülünde yasak (panel kendi form select'i hariç)
  const qStart = LOADER_SRC.indexOf("function makeQualityModule");
  assert.ok(qStart >= 0, "makeQualityModule bulunamadı");
  const qEnd = LOADER_SRC.indexOf("\nfunction ", qStart + 10);
  const qSrc = LOADER_SRC.slice(qStart, qEnd > 0 ? qEnd : undefined);
  assert.ok(
    !/createElement\(\s*["']option["']\s*\)/.test(qSrc),
    "quality kısıtı ihlali: quality modülü option üretmemeli"
  );
});
