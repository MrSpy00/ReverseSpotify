# ReverseSpotify — PROJECT.md

## Kimlik

| Alan | Değer |
| --- | --- |
| Şirket | aegisSoft |
| Baş Geliştirici | mrSpy |
| Paket / Namespace | `com.aegissoft.reversespotify` |
| GitHub | https://github.com/MrSpy00/ReverseSpotify |
| Hedef | Spotify Desktop **1.3.8.620** (`%APPDATA%\Spotify`) — Windows x64 |
| Stack | Python 3.14 (CLI/yama/izleyici) + saf JS loader (runtime) |
| Test | `python -m pytest -q` (74) · `node --test "tests/js/*.test.mjs"` (49) |

## Ne yapar

Spotify'ı değiştirmeden (orijinal dosyalar korunarak) **kendi mod motorumuzla** 8 tema
(arkaplan duvar kağıdı/video destekli), 6 eklenti, ad-block, UI temizliği ve kalite-reveal
ekler. **Uygulama içi kontrol paneli** (üst barda kırmızı anka kuşu ikonu / `Ctrl+Shift+,`) —
tema, eklenti, temizlik ve araçlar sekmeleri terminal gerekmeden yönetilir. Spicetify
bağımlılığı **yok**,
sürüm-agnostik loader, güncelleme sonrası **otomatik onarım**. Premium bypass **yok**
(ToS sınırı; kalite yalnızca reveal-only).

## Mimari Haritası

```
reversespotify/          CLI + repack motoru
  spa.py                 xpui.spa okuma/yazma/sha256
  patch.py               inject_loader/has_loader (index.html → /reverse-loader.js)
  config.py              data_root (%APPDATA%\ReverseSpotify), spotify_apps_dir
  process.py             spotify_running/wait/kill/start (taskkill)
  cli.py                 install · restore · status · themes · plugins · watch
  themes_cmd.py          tema manifest doğrulama + list/set
  plugins_cmd.py         manifest doğrulama, GitHub fetch (yalnız github.com), lint
  lint.py                performans bütçesi (hard-fail: observer-throttle,
                         <100ms interval, backdrop-filter, sync querySelectorAll döngüsü)
  watch.py               check_and_heal → ok|healed|vanilla|broken + sürüm pristine
loader/
  reverse-loader.js      tek dosya IIFE runtime: boot izolasyonu, rspack/webpack
                         feature-detection, window.ReverseSpotify API, tema motoru,
                         plugin runner (izinli facade), adblock/ui-overhaul/quality,
                         kontrol paneli (in-app, SVG ikon, rs:theme override)
themes/                  clean-dark, amoled (encore CSS variable override)
plugins/                 key-highlight (örnek, perfClass light)
registry.json            yerel plugin kayıt defteri
tools/                   discover*.py (keşif), spike_repack.py (Faz0), cdp_smoke.py (CDP)
docs/                    specs/ plans/ xpui-findings.md usage.md
```

## Uygulanan Algoritmalar / Güvenlik

- **Repack:** `xpui.spa` (standart ZIP) → `index.html` xpui script'inin ÖNCESİNE loader
  etiketi → `reverse-loader.js` + `reverse/config.json` + tema CSS + plugin girişleri
  paketlenir. İdempotent (çift enjeksiyon yok).
- **Pristine:** `Backup/xpui.spa.pristine` asla ezilmez; yeni sürümler için ayrı
  `xpui.spa.pristine.<version>` (watch heal sırasında, vanilla bayttan).
- **Marker:** `data/reverse.json` = `{hash, version}` — status/watch sağlık kontrolü.
- **Auto-heal:** `watch.py` — hash drift VEYA loader kaybı (güncelleme) VEYA prefs sürüm
  değişimi → otomatik `install --yes` (Spotify kapalıysa bekle/kapat, sonra başlat).
- **Plugin izolasyonu:** her plugin kendi try/catch'inde; çökertirse `rs:disabled` +
  `rs:error` (kalıcı disable, oturum yeniden yüklenmez).
- **Kalite reveal-only:** yalnızca DOM'daki `disabled` option serbest bırakılır;
  entitlement/`maxSupportedQuality`/option üretimine dokunulmaz (test ile kilitli).
- **Ad-block:** 39 gerçek `data-testid` CSS hide katmanı; ses-hook yok → dürüst
  `mode=ui-only` (docs/xpui-findings.md §2).
- **Kontrol paneli (v3):** `panel` modülü (6/6 boot) — **üst bardaki kırmızı anka kuşu
  ikonu** (profil avatarının solu, Spotify'ın native buton sınıfları kopyalı; üst bar
  yoksa sağ-alt fallback, 400ms×10 + 3sn sweep ile taşınır) + `Ctrl+Shift+,` aç /
  `ESC` kapat; **4 sekme** (Tema / Eklentiler / Temizlik / Araçlar, `role=tablist`,
  140ms fade, aktif sekme kırmızı underline), tema kartları (manifest `themeMeta`'dan
  ad + renk swatch + check), eklenti satırlarında **genişletilebilir alt menü**
  (chevron → `grid-template-rows 0fr→1fr`, izin/sınıf/depo chip'leri), tıklanabilir
  ayak bağlantıları (`extLink` → `win.open`, URL'ler config `links` alanından),
  yeşil switch'ler, 11px uppercase bölüm başlıkları, pill butonlar (press scale .96),
  tabular-nums, responsive (520/360px kırılım), SVG ikon (emoji yasak),
  `prefers-reduced-motion` destekli. Öncelik: `rs:theme` (localStorage)
  > CLI config; UI grupları `rs:ui:*` anında etkili, plugin aç-kapa bir sonraki
  açılışta geçerli. Tema değişince `loadThemeBackground` manifest fetch + `#rs-bg`
  katmanı (görsel cover / video autoplay, opaklık 0.22).
- **v4 özelleştirme:** manifest şeması `description` (≤300) + `settings` (select/toggle,
  `label/help/default`) — `_repack` config entry'lerine backfill eder (manifest tek kaynak).
  Panel: her eklenti satırında açıklama + detail'de ayar kontrolleri (`rs:set:<id>` anında
  kaydeder, facade `getSetting/setSetting`), tema pane'ında "Görsel/Video seç" (≤4MB
  dataURL → `rs:bg:<id>`, manifestten önce), "Tema oluştur" (`rs:customThemes`) ve
  "Plugin ekle" (`rs:customPlugins`, `new Function` sözdizimi + setInterval <100ms
  kontrolü) formları. `themeEngineModule`/`setTheme` custom temayı fetch'siz uygular;
  `runPlugins` `p.code` ile custom eklentiyi sunucusuz çalıştırır; boot'ta custom
  listeler config listesine merge edilir.

## Derleme & Kurulum (tek komut)

```powershell
cd "X:\mrspy\Reverse Engineering\Projeler\ReverseSpotify"
python -m reversespotify install --yes      # mod kur (Spotify'ı kapatır/açar)
python -m reversespotify status             # 0=modded-sağlıklı 1=bozuk 2=vanilla
python -m reversespotify restore --yes      # orijinal baytlara dön
python -m reversespotify watch --once       # tek sağlık+tarama
python -m reversespotify watch --install-task  # ReverseSpotifyHeal (logon+günlük)
```

## Spike Sonuçları (Faz 0)

- Repack round-trip: gerçek spa marker→repack→Spotify 15sn ayakta→sha256 restore eşit.
- Spotify 1.3.8 = **rspack** (`rspackChunk*`, `req.c` yok); modül tespiti fabrika kaynak
  taraması + require(id) doğrulama; React bulunur, Platform/Router fallback (v1 plain DOM).
- CDP doğrulama: `python tools/cdp_smoke.py "<js>" [shot.png]` (port 9222).

## Test & Doğrulama

```powershell
python -m pytest -q                                        # 80 passed
node --test "tests/js/*.test.mjs"                          # 56 passed
python tools/cdp_smoke.py "(async()=>JSON.stringify(window.ReverseSpotify.modules))()"
```

## Roadmap

- v2: `Spicetify.Platform/React` uyumluluk shim'i (topluluk plugin uyumu).
- v2: ağ katmanı ile sesli-reklam (`ui+audio` modu) — ToS değerlendirmesiyle.
- v2: `plugins add` için imza/namespace doğrulama (harici registry).
- Restore'un sürüm-pristine seçimi (post-update tam vanilla geri dönüş).
- macOS/Linux yok (yalnız Windows).
