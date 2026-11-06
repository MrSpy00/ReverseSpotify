# ReverseSpotify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spotify Windows masaüstü (1.3.8.620) için Spicetify'den bağımsız, güncelleme-dayanıklı, performans bütçeli bir mod motoru: tek komutla xpui.spa'ya loader enjeksiyonu + tema motoru + kendi plugin API'miz + ad-block + UI overhaul + kalite-UI reveal + otomatik auto-heal.

**Architecture:** Python CLI (`reversespotify`) xpui.spa'yi (standart ZIP) yedekler, `index.html`'e tek `<script defer src="/reverse-loader.js">` enjekte eder, loader + aktif tema + etkin plugin'leri `/reverse/` altına paketleyip yeniden arşivler. Loader (saf JS) webpack chunk globals'inden feature-detection ile `window.ReverseSpotify` API kurar; her modül try/catch izole. Değişiklikler (tema/plugin enable) = yeniden repack; Spotify güncellemesi = hash tespit + otomatik re-install.

**Tech Stack:** Python 3.14 (yalnız stdlib: zipfile, argparse, hashlib, urllib) · Saf JS/CSS (loader, plugin, tema) · pytest · node:test · Git.

**Spec:** `docs/superpowers/specs/2026-11-06-reversespotify-design.md (onaylı design doc; bu plan onun argümanıdır.

## Global Constraints

- Hedef: `C:\Users\mrSpy\AppData\Roaming\Spotify\Apps\xpui.spa`, Spotify 1.3.8.620; SPA = standart ZIP (614 dosya).
- Enjeksiyon noktası: `index.html` içinde `<script defer src="/xpui-snapshot.js">` etiketi (fixture ile doğrulanmış).
- Spicetify bağımlılığı YOK; Spicetify.* API shim v1'de YOK (yalnız kendi `ReverseSpotify` API).
- ToS sınırı: premium kilidi aşma / free'de yüksek kalite YOK — yalnız reveal-based UI.
- Performans: loader senkron yolu minimal; plugin lint ihlali = reddet/devre dışı.
- Yol bağımsızlığı: hiçbir kodda mutlak kullanıcı yolu gömülü değil; yollar script/config'ten çözülür (`%APPDATA%` + script kökü).
- UI metinlerinde emoji ikon YOK; `com.aegissoft.reversespotify` kimliği; GitHub MrSpy00.
- Pristine yedek asla ezilmez; `restore` birebir vanilla döner.
- HER task kendi testiyle biter; commit step'leri project kökünde (`git init` Task 1'de).

## Review Focus

(Design doc'un ima ettiği ama hiçbir task'ın tek başına test etmediği, kullanıcıyı ilk yakalayacak 5 şey — her biri sahipli task'ının step'ine eklenmiştir.)

1. **Repack round-trip Spotify'ı açmazsa** (integrity kontrolü) → Task 1 spike, gerçek Spotify ile smoke test.
2. **Spotify çalışırken dosya kilidi** → Task 3: süreç politikası testi (running/exit/kill yolları).
3. **Idempotans: install iki kez koşulursa çift loader scripti** → Task 2: `inject_loader` ikinci çağrıda değişiklik yapmaz.
4. **Bozuk plugin app'i indirir** → Task 6: runner çöken plugin'i izole eder, diğeri devam eder.
5. **Lint kaçakları (ağır pattern)** → Task 6: her yasaklı kalıp için lint testi; runtime auto-disable (Task 4).

---

### Task 1: Proje İskeleti + Faz 0 Spike (repack round-trip doğrulaması)

**Files:**
- Create: `pyproject.toml`, `reversespotify/__init__.py`, `reversespotify/__main__.py` (iskelet), `tests/test_spa_roundtrip.py`, `PROJECT.md`
- Git: `git init` (project kökü)

**Interfaces:**
- Produces: paket adı `reversespotify`, giriş `python -m reversespotify`; boş CLI `--help` çalışır.
- Spike sonucu: `PROJECT.md`'ye spike kararı yazılır (B omurgası geçerli / fallback gerekir).

- [ ] **Step 1: İskelet + git init**

Project kökünde `git init`; `pyproject.toml` (`[project] name = "reversespotify"`, requires-python >= 3.14), `reversespotify/__init__.py` (`__version__ = "0.1.0"`), `reversespotify/__main__.py` (argparse iskeleti: `--help` çıktısı "reverse-spotify" içersin). `tests/fixtures/index.html` mevcut (klasör Task öncesi oluşturuldu).

- [ ] **Step 2: Round-trip testi yaz (önce FAIL)**

```python
# tests/test_spa_roundtrip.py
def test_extract_repack_preserves_bytes(tmp_path):
    spa = tmp_path / "xpui.spa"
    # küçük ZIP oluştur: index.html + bir chunk
    ...  # zipfile ile 2 dosya yaz
    entries = reversespotify.spa.read_spa(spa)   # FAIL: modül yok
    out = tmp_path / "out.spa"
    reversespotify.spa.write_spa(entries, out)
    assert reversespotify.spa.read_spa(out) == entries
```

Run: `pytest tests/test_spa_roundtrip.py -v` → FAIL (ImportError).

- [ ] **Step 3: `reversespotify/spa.py` implement et**

İmzalar: `read_spa(path: Path) -> dict[str, bytes]`, `write_spa(entries: dict[str, bytes], path: Path) -> None` (zipfile stdlib; compression=ZIP_DEFLATED; `path`'e atomik yaz: önce `.tmp` sonra replace). `spa_hash(path: Path) -> str` (sha256).

- [ ] **Step 4: Testi PASS ettir**

Run: `pytest tests/test_spa_roundtrip.py -v` → PASS.

- [ ] **Step 5: Spike — gerçek SPA'ye marker enjekte + repack + launch**

Spike scripti (task içi tek-use, `tools/spike_repack.py`): gerçek `xpui.spa`'yi kopyaya al → `index.html`'e `<script>window.__RS_SPIKE__=1</script>` ekle (test değil, spike) → repack → `Start-Process Spotify.exe` → 15 sn bekle → process hâlâ ayakta mı kontrol et (`Get-Process Spotify`) ve Spotify penceresi visible mı bak → kopya sil, orijinal dokunulmadı.

Run: `python tools/spike_repack.py` (cihazda Spotify kapalıysa/çalışırken — kopya üzerinde çalışır, orijinal SPA DEĞİŞMEZ).
Expected: process 15 sn sonra da ayakta; crash dialog yok.

- [ ] **Step 6: Spike sonucunu PROJECT.md'e yaz + commit**

`PROJECT.md` (kısa: kimlik, spike sonucu, karar B omurgası geçerli mi). Fallback notu: integrity kontrolü çıkarsa plan durur ve launcher/runtime enjeksiyon stratejisi brainstorming'e geri döner.
```bash
git add -A && git commit -m "chore: ReverseSpotify scaffold + repack spike"
```

---

### Task 2: Patch Modülü — index.html enjeksiyonu (idempotent)

**Files:**
- Create: `reversespotify/patch.py`, `tests/test_patch.py`
- Fixture: `tests/fixtures/index.html` (gerçek 1.3.8.620 çıktısı, 2175B)

**Interfaces:**
- Produces (Task 3 bunu kullanır):
  - `inject_loader(index_html: str) -> str`
  - `has_loader(index_html: str) -> bool`

- [ ] **Step 1: FAIL testleri yaz**

```python
FIXTURE = Path("tests/fixtures/index.html").read_text(encoding="utf-8")

def test_inject_adds_loader_before_app_script():
    out = inject_loader(FIXTURE)
    assert '/reverse-loader.js' in out
    assert out.index('/reverse-loader.js') < out.index('/xpui-snapshot.js')

def test_inject_is_idempotent():          # Review Focus #3
    once = inject_loader(FIXTURE)
    twice = inject_loader(once)
    assert twice == once
    assert once.count('/reverse-loader.js') == 1

def test_has_loader_detects():
    assert not has_loader(FIXTURE)
    assert has_loader(inject_loader(FIXTURE))
```

Run: `pytest tests/test_patch.py -v` → FAIL.

- [ ] **Step 2: `patch.py` implement et**

`XPUI_SCRIPT = '<script defer="defer" src="/xpui-snapshot.js"></script>'` sabitini (fixture'daki birebir etiket) kullan; `has_loader` ise `/reverse-loader.js` araması. `inject_loader`: `has_loader` ise aynen döndür; değilse xpui script etiketinin hemen ÖNCESİNE `<script defer="defer" src="/reverse-loader.js"></script>` ekle. Etiket bulunamazsa `ValueError` (sessiz sızma yok — auto-heal bunu yakalar, Task 8).

- [ ] **Step 3: PASS + commit**

Run: `pytest tests/test_patch.py -v` → PASS.
`git commit -m "feat: idempotent index.html loader injection"`

---

### Task 3: CLI çekirdeği — install / restore / status + süreç politikası

**Files:**
- Create: `reversespotify/config.py`, `reversespotify/process.py`, `reversespotify/cli.py`, `tests/test_process.py`, `tests/test_cli_install.py`
- Modify: `reversespotify/__main__.py` → `cli.main()`

**Interfaces:**
- Consumes: `spa.read_spa/write_spa/spa_hash`, `patch.inject_loader/has_loader` (Task 2).
- Produces (sonraki tüm task'lar):
  - `config.data_root() -> Path`  (`%APPDATA%\ReverseSpotify`; `Backup/`, `dist/` altında)
  - `config.spotify_apps_dir() -> Path` (varsayılan `%APPDATA%\Spotify\Apps`, `--spotify-dir` ile override)
  - `process.wait_for_spotify_exit(timeout: int = 30) -> bool`, `process.kill_spotify() -> None`, `process.spotify_running() -> bool`
  - CLI: `install [--spotify-dir] [--yes]` · `restore` · `status [--check]` (exit code: 0=modded-sağlıklı, 1=bozuk/eski, 2=vanilla)

- [ ] **Step 1: FAIL testleri yaz**

```python
def test_install_uses_backup_and_patches(fake_spa):        # tmp_path sahte xpui.spa fixture
    cli.main(["install", "--spotify-dir", str(fake_spa.parent), "--yes"])
    entries = spa.read_spa(fake_spa)
    assert patch.has_loader(entries["index.html"].decode())
    backup = config.data_root() / "Backup" / "xpui.spa.pristine"
    assert backup.exists()                      # pristine bir kez alınır

def test_restore_returns_bit_identical(fake_spa):          # Review Focus #5 (fidelity)
    before = spa.spa_hash(fake_spa)
    cli.main(["install", "--spotify-dir", str(fake_spa.parent), "--yes"])
    cli.main(["restore", "--spotify-dir", str(fake_spa.parent)])
    assert spa.spa_hash(fake_spa) == before

def test_install_blocked_while_spotify_running(monkeypatch):
    monkeypatch.setattr(process, "spotify_running", lambda: True)
    monkeypatch.setattr(process, "wait_for_spotify_exit", lambda timeout=30: False)
    with pytest.raises(SystemExit) as e:
        cli.main(["install", "--spotify-dir", "...", "--yes"])   # --yes: prompt yok, doğrudan kill politikası
    # politika: --yes → kill_spotify çağrılır (spy ile doğrula)
```

Run: `pytest tests/test_process.py tests/test_cli_install.py -v` → FAIL.

- [ ] **Step 2: `process.py` + `config.py` implement et**

Süreç politikası (design doc kararı): `install` başında `spotify_running()` → prompt yoksa (`--yes`) `wait_for_spotify_exit(30)` → hâlâ ayaktaysa `kill_spotify()` (`taskkill /IM Spotify.exe /F`, ayrıca `SpotifyLauncher.exe`) → kurulum sonrası `start_spotify()` teklifi (non-interactive'da sessiz başlat). Windows stdlib (`subprocess`, `os.environ["APPDATA"]`).

- [ ] **Step 3: `cli.py` implement et — install/restore/status akışları**

`install`: pristine var mı? (yoksa al, asla ezme) → süreç politikası → `read_spa` → `inject_loader(index.html)` → SPA'ye `/reverse-loader.js` (şimdilik Task 4 dosyası yoksa `loader/reverse-loader.js` iskeletinden kopyala — boot `try/catch` + `document.documentElement.dataset.rs="1"`) + `/reverse/config.json` (boş: `{"theme":null,"plugins":[]}`) ekle → `write_spa` → `status` çıktısı.
`restore`: `Backup/xpui.spa.pristine` varsa bit-identical geri yaz; yoksa hata + çıkış kodu.
`status`: pristine var mı, `has_loader`, hash marker (`data/reverse.json` içinde kurulu hash) eşleşiyor mu → 0/1/2 exit code.

- [ ] **Step 4: PASS + gerçek smoke test**

Run: `pytest tests/test_process.py tests/test_cli_install.py -v` → PASS.
Gerçek doğrulama: Spotify kapalıyken `python -m reversespotify install --yes` → `status` = 0 → Spotify başlat, pencere açılıyor, `restore` → vanilla. (Gözlemlenemeyen runtime detayları Task 4'te.)
`git commit -m "feat: cli install/restore/status with process policy"`

---

### Task 4: Loader çekirdeği — boot, feature-detection, ReverseSpotify API

**Files:**
- Create: `loader/reverse-loader.js` (Task 3 iskeletini替换 → tam çekirdek), `loader/boot.js` mantığı tek dosyada modüler bloklar hâlinde, `tests/js/loader.test.mjs` (node:test)

**Interfaces:**
- Consumes: repack edilmiş `/reverse/config.json` (Task 3), `/reverse/*` dosyaları aynı origin'den fetch edilebilir (SPA içi mutlak yol — spike kanıtı Task 1).
- Produces (Task 5/6/7 bunu tüketir):
  - `window.ReverseSpotify = { React, Platform, Router, ready: Promise, onReady(cb), onRouteChange(cb), log(), settings }`
  - Feature-detection: `webpackChunkspotify_desktop` chunk global'inden React + Platform modülleri; bulunamazsa `ReverseSpotify.fallbacks = [...]` ve app yine çalışır (loader hiçbir şeyi çökertmez).
  - Runtime auto-disable: çöken modül/plugin `localStorage["rs:disabled"]`a yazılır ve sonraki boot'ta atlanır (Review Focus #4/#5).

- [ ] **Step 1: FAIL testleri yaz (node:test, saf mantık — DOM bağımlı değil)**

```js
// tests/js/loader.test.mjs
test("boot isolates a throwing module", () => {
  const calls = [];
  bootModules([
    { name: "bad", run() { throw new Error("boom"); } },
    { name: "good", run() { calls.push(1); } },
  ], { disabled: new Set(), store: { disabled: new Set() } });
  assert.deepEqual(calls, [1]);
  assert.ok(storeHas("bad"));
});
test("boot skips previously disabled modules", ...);
```

Run: `node --test tests/js/` → FAIL.

- [ ] **Step 2: `reverse-loader.js` implement et**

Yapı (tek dosya, IIFE, `defer`): `(1) dataset.rs="1" işareti → (2) bootModules runner (try/catch + localStorage disable) → (3) waitForWebpack(chunk global poll, max 15s, timeout = sessiz fallback) → (4) ReverseSpotify API kur → (5) config fetch → (6) sırayla: theme engine (Task 5 hook'u), plugin runner (Task 6), adblock/UI/quality (Task 7) — her biri `bootModules` üzerinden isim-kayıtlı, iskelet versiyonda `run: ()=>{}` boş.`
Senkron yol: sadece step 1 + runner kaydı; gerisi async. Hiçbir yere `throw` fırlatma; her şey izole.

- [ ] **Step 3: PASS + runtime doğrulama**

Run: `node --test tests/js/` → PASS.
Runtime: `install` → Spotify başlat → DOM'da `data-rs="1"` (erişilebilirse CDP `--remote-debugging-port=9222`; erişilemezse kullanıcıdan görsel teyit: Spotify normal açılıyor + konsolda hata yok).
`git commit -m "feat: loader boot with feature-detection and crash isolation"`

---

### Task 5: Tema Motoru + 2 örnek tema + `themes` komutları

**Files:**
- Create: `loader/theme-engine.js` mantığı (reverse-loader.js içine blok), `themes/clean-dark/theme.css + manifest.json`, `themes/amoled/theme.css + manifest.json`, `reversespotify/themes_cmd.py`, `tests/test_themes.py`

**Interfaces:**
- Consumes: repack pipeline (Task 3), loader boot (Task 4).
- Produces:
  - Manifest şeması: `{"id","name","author","version","entryCss": "theme.css"}`
  - `ReverseSpotify.applyTheme(css: string) -> void` (style tag, id=`rs-theme`, tekrar çağrıda replace)
  - CLI: `themes list` · `themes set <id>` → `config.json` güncelle + repack (`_repack_current()` — Task 3 install akışının tekrar kullanımı; pristine'e dokunulmaz, install marker tazelenir).

- [ ] **Step 1: FAIL testleri**

```python
def test_themes_set_updates_config_and_repacks(fake_spa_installed):
    cli.main(["themes", "set", "amoled"])
    entries = spa.read_spa(spa_path(fake_spa_installed))
    cfg = json.loads(entries["reverse/config.json"])
    assert cfg["theme"] == "amoled"
    assert "reverse/themes/amoled/theme.css" in entries       # paketlenmiş
    assert patch.has_loader(entries["index.html"].decode())  # loader korunmuş
```
+ manifest parse testi (geçersiz manifest → net hata).
Run: `pytest tests/test_themes.py -v` → FAIL.

- [ ] **Step 2: Implement**

`themes_cmd.py`: dizin tarama (`themes/*/manifest.json`), doğrulama, `set` → repack. Loader bloğu: config.theme varsa fetch → `applyTheme` (xpui CSS variable override'ları; ağır kural yok, sadece değişkenler + selectivist selector'lar — performans bütçesi). İki tema: `clean-dark` (mevcut dark'a rötuş) ve `amoled` (siyah AMOLED).

- [ ] **Step 3: PASS + görsel doğrulama + commit**

Run: `pytest tests/test_themes.py -v` → PASS.
Smoke: `themes set amoled` → restart → tema uygulanmış; `themes set clean-dark` → döner. Görsel teyit (kullanıcı/ekran görüntüsü).
`git commit -m "feat: css-variable theme engine with two themes"`

---

### Task 6: Plugin sistemi — API, runner, lint, `plugins` komutları

**Files:**
- Create: `reversespotify/lint.py`, `reversespotify/plugins_cmd.py`, `tests/test_lint.py`, `tests/test_plugins_cmd.py`, `loader/plugin-runner.js` mantığı (loader bloğu), `tests/js/plugin-runner.test.mjs`, `plugins/key-highlight/` (örnek plugin: manifest + entry.js), `registry.json` (boş küratörlü liste)

**Interfaces:**
- Consumes: boot runner (Task 4), repack (Task 3/5).
- Produces:
  - Plugin manifest: `{"id","name","version","entry":"index.js","permissions":["settings"|"ui"],"perfClass":"light"}`
  - Plugin API (entry.js içinde global `ReverseSpotify`): `onReady(cb)`, `onRouteChange(cb)`, `settings.get/set(key, val)`, `React`, `Platform`, `UI.addStyle(css)`, `UI.modal(...)`.
  - `lint.lint_source(js: str) -> list[str]` — yasaklı kalıplar: `MutationObserver` ohne throttle (`.observe(` çağrısı `requestAnimationFrame`/`debounce` olmadan döngüde), `setInterval` < 100ms literal, `backdrop-filter` inline/stil (sınırsız), senkron `document.querySelectorAll` döngüsü. Regex tabanlı, false-positive'i reddettiğinden emin olmak için ters testler.
  - CLI: `plugins list` · `plugins add <id|github-url>` (registry'den veya URL'den fetch → lint → RED/İzin → install repack) · `plugins remove <id>` · `plugins enable/disable <id>`.

- [ ] **Step 1: FAIL testleri**

```python
@pytest.mark.parametrize("src,frag", [
    ("setInterval(()=>el.querySelectorAll('div').forEach(f), 50)", "setInterval"),
    ("new MutationObserver(cb).observe(x,{})", "MutationObserver"),
    ("el.style.backdropFilter='blur(20px)'", "backdrop-filter"),
])
def test_lint_flags_heavy_patterns(src, frag):          # Review Focus #5
    assert any(frag in v for v in lint.lint_source(src))

def test_lint_allows_throttled_observer():
    assert lint.lint_source("rafThrottled.observe(x)") == []
```
```js
// plugin-runner.test.mjs
test("crashing plugin disabled, next plugin runs", ...);
test("plugin receives settings get/set roundtrip", ...);
```
Run: `pytest tests/test_lint.py tests/test_plugins_cmd.py -v` + `node --test tests/js/` → FAIL.

- [ ] **Step 2: Implement**

- `lint.py`: regex kuralları, her kuralın hem ihlal hem izin (throttled) testi.
- `plugins_cmd.py`: dizin/registry tarama; `add`: urllib ile GitHub zip fetch → lint → (ihlal varsa `--force` ile bile reddet: hard-fail) → `plugins/<id>/` → repack. Registry fetch öncesi URL doğrulama (yalnız github.com, https).
- Loader plugin-runner: config.plugins[] → fetch entry → yeni `<script>` ile eval-scope (global `ReverseSpotify` verilir) → try/catch → hata → `rs:disabled` + `rs:error` kaydı (bir sonraki boot'ta atlanır, `status` bunu raporlar).

- [ ] **Step 3: PASS + örnek plugin e2e + commit**

Run: `pytest tests/test_lint.py tests/test_plugins_cmd.py -v` → PASS; `node --test tests/js/` → PASS.
Smoke: `plugins add key-highlight` → restart → plugin aktif; manifest entry'sine `throw` ekle → restart → plugin disabled, app normal, `status` uyarıyor.
`git commit -m "feat: plugin api, isolated runner and perf-budget lint"`

---

### Task 7: Ad-block + UI overhaul + kalite-UI reveal

**Files:**
- Create: `loader/adblock.js`, `loader/ui-overhaul.js`, `loader/quality.js` mantığı (loader blokları), `tests/js/adblock.test.mjs`, XPUI keşif notları → `docs/xpui-findings.md`

**Interfaces:**
- Consumes: ReverseSpotify API (Task 4), boot runner (Task 4).
- Produces:
  - Adblock: CSS hide katmanı (seçikler keşfedilecek — aşağıda Step 1) + audio ads **best-effort** istemci filtresi (Network/interception xpui'nin sunduğu ne varsa; bulunamazsa `rs:adblock.mode="ui-only"` + `status` raporunda açıkça yaz — Design Doc §5.5 dürüstlük şartı).
  - Quality reveal: yalnız hesabı'n izin verdiği kalite UI'da; premium bypass YOK (Global Constraint).
  - `ReverseSpotify.Adblock.mode` (`"ui+audio"` | `"ui-only"`).

- [ ] **Step 1: Keşif — xpui-snapshot.js/js chunk'larından seçik ve kalite-gate ara**

Grep/REA ile: reklam slotu testid'leri (`data-testid` ad alanında `ad`), upsell/upgrade banner seçikleri, kalite ayar option listesi ve gate'leyen feature-flag/entitlement kodu (arama terimleri: `very_high`, `bitrate`, `quality`, `entitlement`, `upgrade`). Bulguları `docs/xpui-findings.md`'e yaz (seçik + satır referansı).
Çıktı gerçek keşfe bağlı — uydurma seçik yok.

- [ ] **Step 2: FAIL testleri (saf mantık katmanı)**

```js
test("adblock css layer contains discovered selectors", ...);   // findings'ten türetilen liste
test("quality reveal only widens visible options, no entitlement rewrite", () => {
  // quality.js yalnız DOM option listesini/görünürlüğünü serbest bırakır;
  // entitlement değerine dokunan kod varsa test fail (grep assertion)
});
```
Run: `node --test tests/js/` → FAIL.

- [ ] **Step 3: Implement + loader'a `bootModules` kaydı**

- `adblock.js`: CSS katmanı (`UI.addStyle`) + best-effort sesli-reklam filtresi (keşifte bulunan hook); kapsam dar ise `mode="ui-only"`.
- `ui-overhaul.js`: banner/upsell gizleme + temizlik katmanları (ayrı ayrı `rs:ui:*` anahtarlarıyla kapatılabilir).
- `quality.js`: reveal-only (Global Constraint ihlali test ile kilitli).
- `status` çıktısına `adblock mode` + keşfedilen seçik sayısı ekle.

- [ ] **Step 4: PASS + reklam-gözlem smoke + commit**

Run: `node --test tests/js/` → PASS.
Smoke: reklam gösteren oturumda banner/audio davranışını gözlemle; audio engellenemezse `status` "ui-only" raporlamalı (dürüst sonuç = PASS).
`git commit -m "feat: adblock ui layer, ui overhaul, quality reveal (scope-bounded)"`

---

### Task 8: Update watcher / auto-heal + docs kapanışı

**Files:**
- Create: `reversespotify/watch.py`, `tests/test_watch.py`, `docs/usage.md`
- Modify: `reversespotify/cli.py` (`watch`, `status --check`), `PROJECT.md` (tamamla)

**Interfaces:**
- Consumes: `cli install/status` (Task 3), `spa_hash` (Task 1/2).
- Produces:
  - `watch.check_and_heal() -> str` ("ok" | "healed" | "vanilla" | "broken"): kurulu hash ≠ mevcut `xpui.spa` hash VEYA `prefs` `app.last-launched-version` değiştiyeya DA `has_loader` false ise → otomatik `install` (pristine asla ezilmez; yeni sürümün pristine'i ayrı dosyaya alınır `xpui.spa.pristine.<version>`).
  - CLI: `watch --once` (tek kontrol) · `watch --install-task` (Windows Scheduled Task kaydı: login + günlük, yol bağımsız, `python -m reversespotify watch --once`).

- [ ] **Step 1: FAIL testleri**

```python
def test_heal_reinjects_when_hash_drifted(fake_spa_installed):
    # repack edilmiş spa'yı dışarıdan değiştir (yeni sürümü simüle)
    ...  # entries değiştir + write_spa
    assert watch.check_and_heal() == "healed"
    entries = spa.read_spa(spa_path)
    assert patch.has_loader(entries["index.html"].decode())

def test_pristine_versioned_backup_on_upgrade(fake_spa_installed):  # yeni sürüm pristine'i korunur
    ...
def test_vanilla_left_alone():   # loader yok + kurulu marker yok → "vanilla", sessiz
    ...
```
Run: `pytest tests/test_watch.py -v` → FAIL.

- [ ] **Step 2: Implement**

`watch.py` tespit: `status` mantığı + hash/prefs sürüm karşılaştırması → heal = install akışının reuse'u. Scheduled Task: `schtasks /Create` (task name `ReverseSpotifyHeal`, trigger logon + daily; script yolu script-relative çözümleme — Global Constraint yol bağımsızlığı).

- [ ] **Step 3: PASS + gerçek güncelleme simülasyonu + commit**

Run: `pytest tests/test_watch.py -v` → PASS.
Simülasyon: gerçek kurulumda `xpui.spa` hash'ini bilinçli değiştir → `watch --once` → `healed` → Spotify açılıyor.
`PROJECT.md` güncelle: mimari, komutlar, spike/watch sonuçları, roadmap (Spicetify shim v2, macOS/Linux yok).
`git commit -m "feat: update watcher auto-heal + scheduled task"`

---

### Task 9: Son denetim — tam akış regresyonu

**Files:**
- Modify: hatalar varsa ilgili task dosyaları; `docs/usage.md` son hâli

- [ ] **Step 1: Tam akış manis testi (gerçek cihaz)**

Sıfırdan: `git clone` temizliği hissi için `restore` → `install` → `themes set amoled` → `plugins add key-highlight` → restart → ad-block/UI gözlem → `themes set clean-dark` → `watch --once` → `restore` (vanilla).
Her adımda `status` beklenen exit code (0/1/2) — kontrol listesi `docs/usage.md`'de.

- [ ] **Step 2: Performans gözlemü (Design Doc: ana şikayet)**

Kurulu/vanilla başlatma süresini ve ilk etkileşim akıcılığını gözlemle (STOPWATCH + gözlem; plugin'ler açıkken bile belirgin lag YOK). Sorun varsa lint/boot budget'a geri dön.

- [ ] **Step 3: Final commit + PROJECT.md teslim**

`git commit -m "docs: usage guide and final verification"`

---

## Self-Review Notları

- **Spec coverage:** Design Doc §5.1–5.8 → Task 1–8 eşlemesi tam; Approaches (A/B/C) §2 → Global Constraints (Spicetify yok); kalite reveal-only → Task 7 testi; topluluk registry (kendi API) → Task 6 `plugins add` + registry.json; auto-heal → Task 8; spike zorunluluğu (builder call #3) → Task 1.
- **Tip tutarlılığı:** `inject_loader/has_loader` (Task 2→3→8), `read_spa/write_spa/spa_hash` (Task 1→3→8), `data_root()` ve `config.json` şeması (`{"theme","plugins"}`) tek tanım.
- **Proportion:** Kod blokları yalnız test assertion'ları ve algoritmik belirsizliklerde; gövdeler imzadan türetilir.
