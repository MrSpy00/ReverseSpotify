import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { applyThemeCss, themeEngineModule } = require("../../loader/reverse-loader.js");

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

test("applyThemeCss creates #rs-theme once and replaces content", () => {
  const doc = fakeDoc();
  applyThemeCss(doc, "a{}");
  assert.equal(doc.byId["rs-theme"].textContent, "a{}");

  applyThemeCss(doc, "b{}");
  assert.equal(Object.keys(doc.byId).length, 1); // ikinci çağrıda replace, kopya yok
  assert.equal(doc.byId["rs-theme"].textContent, "b{}");
});

test("theme engine fetches theme css and applies it", async () => {
  const applied = [];
  const urls = [];
  const win = {
    ReverseSpotify: {
      settings: { theme: "amoled" },
      applyTheme(css) {
        applied.push(css);
      },
      log() {},
    },
  };
  const m = themeEngineModule(win, async (url) => {
    urls.push(url);
    return { ok: true, text: async () => "/*amoled*/" };
  });
  assert.equal(m.name, "theme-engine");
  await m.run();
  assert.deepEqual(urls, ["/reverse/themes/amoled/theme.css"]);
  assert.deepEqual(applied, ["/*amoled*/"]);
});

test("theme engine with no theme does not fetch", async () => {
  let fetched = 0;
  const win = {
    ReverseSpotify: {
      settings: { theme: null },
      applyTheme() {
        throw new Error("applyTheme çağrılmamalı");
      },
      log() {},
    },
  };
  const m = themeEngineModule(win, async () => {
    fetched += 1;
    return { ok: true, text: async () => "" };
  });
  await m.run();
  assert.equal(fetched, 0);
});

test("theme engine tolerates missing theme css without throwing", async () => {
  const win = {
    ReverseSpotify: {
      settings: { theme: "silinmis" },
      applyTheme() {
        throw new Error("applyTheme çağrılmamalı (404)");
      },
      log() {},
    },
  };
  const m = themeEngineModule(win, async () => ({ ok: false, text: async () => "" }));
  await m.run(); // reddetmemeli: kalıcı disable'a yol açmamalı
});
