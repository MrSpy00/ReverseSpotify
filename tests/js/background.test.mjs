import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rs = require("../../loader/reverse-loader.js");

// Minimal DOM: body.children içinde id taraması yapan sahte pencere
function fakeWin() {
  const body = {
    children: [],
    insertBefore(el) {
      this.children.unshift(el);
    },
  };
  const doc = {
    body,
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        id: "",
        style: {},
        children: [],
        attrs: {},
        setAttribute(k, v) {
          this.attrs[k] = v;
        },
        appendChild(c) {
          this.children.push(c);
          return c;
        },
        remove() {
          const i = body.children.indexOf(this);
          if (i >= 0) body.children.splice(i, 1);
        },
      };
    },
    getElementById(id) {
      return body.children.find((c) => c.id === id) || null;
    },
  };
  return { document: doc, __bg: () => doc.getElementById("rs-bg") };
}

test("applyBackground: gorsel spec ile katman olusturur (url, cover, opacity, aria)", () => {
  const win = fakeWin();
  const ok = rs.applyBackground(win, "crimson", { background: "wallpaper.svg" });
  assert.equal(ok, true);
  const layer = win.__bg();
  assert.ok(layer, "rs-bg katmani yok");
  assert.equal(layer.attrs["aria-hidden"], "true");
  assert.match(layer.style.backgroundImage, /wallpaper\.svg/);
  assert.match(layer.style.backgroundSize, /cover/);
  assert.match(layer.style.opacity, /^0(\.\d+)?$/); // opaklik manifestten veya varsayilan
  assert.equal(layer.children.length, 0); // gorsel: video cocugu yok
});

test("applyBackground: video spec video elemani uretir (autoplay/loop/muted/playsinline)", () => {
  const win = fakeWin();
  const ok = rs.applyBackground(win, "x", { backgroundVideo: "loop.mp4" });
  assert.equal(ok, true);
  const layer = win.__bg();
  assert.ok(layer);
  assert.equal(layer.children.length, 1);
  const v = layer.children[0];
  assert.equal(v.tagName, "VIDEO");
  assert.equal(v.autoplay, true);
  assert.equal(v.loop, true);
  assert.equal(v.muted, true);
  assert.equal(v.playsInline, true);
  assert.match(v.src, /loop\.mp4/);
});

test("applyBackground: tema yok veya spec yok → katman temizlenir, false doner", () => {
  const win = fakeWin();
  rs.applyBackground(win, "crimson", { background: "wallpaper.svg" });
  assert.ok(win.__bg());
  assert.equal(rs.applyBackground(win, null, null), false);
  assert.equal(win.__bg(), null);
  assert.equal(rs.applyBackground(win, "crimson", {}), false);
  assert.equal(win.__bg(), null);
});

test("applyBackground: tekrar cagri (tema degisimi) cift katman birakmaz", () => {
  const win = fakeWin();
  rs.applyBackground(win, "crimson", { background: "wallpaper.svg" });
  rs.applyBackground(win, "y", { backgroundVideo: "a.mp4" });
  assert.equal(win.document.body.children.length, 1);
  assert.equal(win.__bg().children.length, 1); // video katmanda kaldi, eski gorsel gitti
});

test("applyBackground: backgroundOpacity manifestten okunur (0-1 disi varsayilana)", () => {
  const win = fakeWin();
  rs.applyBackground(win, "x", { background: "a.jpg", backgroundOpacity: 0.5 });
  assert.equal(win.__bg().style.opacity, "0.5");
  const win2 = fakeWin();
  rs.applyBackground(win2, "x", { background: "a.jpg", backgroundOpacity: 9 });
  assert.match(win2.__bg().style.opacity, /^0\./); // gecersiz deger → varsayilan
});
