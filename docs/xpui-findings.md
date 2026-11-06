# XPUI Keşif Bulguları — ReverseSpotify T7

Hedef: Spotify Desktop **1.3.8.620** (`xpui.spa`, 619 dosya çıkarıldı — `tools/discover.py`
ve `tools/discover_quality.py` ile üretildi). Kanıt satırları minified chunk'lara aittir;
dosya adı = kanıt kaynağı. Uydurma seçik yok: hepsi aşağıdaki grep çıktısından türedi.

## 1. Reklam / upsell `data-testid` seçikleri

### Ev/akış reklamları (`home-ads-container.js`)
- `home-ads-container` — ana kapsayıcı
- `home-ad-card`, `home-ad-display-asset-fallback`, `home-ad-video-asset`
- `regular-advertiser-info`, `compact-advertiser-info`

### Leavebehind (çalma listesi/show/episode reklam kartları)
- `leavebehind`, `leavebehinds-wrapper`, `leavebehinds-list-wrapper`, `leavebehinds-title`,
  `leavebehinds-see-all` — `playlist-leavebehinds.js`, `xpui-routes-all-show-ads.js`,
  `xpui-routes-episode.js`, `xpui-routes-show.js` (`show-leavebehinds-container`)

### Video / NPV / now-playing reklamları (`4468.js`, `dwp-now-playing-bar.js`, `dwp-panel-section.js`, `894.js`)
- `ads-video-player-npv`, `ads-npv-header-maximize-button`
- `canvas-ad-container`, `canvas-ad-player`
- `skippable-ad-skip-button`, `skippable-ad-circle-timer`, `skippable-ad-delay`
- `embedded-ad`, `embedded-ad-carousel`, `embedded-ad-carousel-header-logo`,
  `embedded-ad-html-display`, `embedded-ad-html-creative`, `embedded-ad-cta-button-fallback`,
  `embedded-ad-creative-link`
- `standalone-video-ad-player`, `video-player-ad-wrapper`
- `ad-controls`, `context-ad-logo` (now-playing bar)
- `ad-companion-card`, `ad-companion-card-tagline`
- `survey-ad`, `survey-ad-thank-you`, `survey-option-ad`
- `button-like-ad`, `button-dislike-ad`, `adfeedback-context-menu` (`8190.js`, `8399.js`)
- `PanelHeader_AdContextMenuButton` (`4468.js`)

### UI temizliği grupları (ui-overhaul, `rs:ui:*` anahtarları)
- `upsell` → `upsell-download-app-button` (`xpui-root-dialogs.js`),
  `sponsored-recommendation-modal-trigger` (`1684.js`)
- `dsa` → `home-dsa-message-banner` (`1684.js`)

## 2. Sesli (audio) reklam — istemci hook'u YOK

`rg -i "adBreak|audioAd|adState|ad-playback|preroll"` eşlemeleri yalnızca **görsel/UI durum
kodunda** (`4468.js` `isPrerollAd`, now-playing bar durumu) bulundu; ses akışını
kesmeye/engellemeye yarayan xpui içi bir istemci hook'u **yok**. Sesli reklam engelleme
istemci tarafında güvenilir biçimde yapılamaz → **`ADBLOCK_MODE = "ui-only"`** (Design Doc
§5.5 dürüstlük şartı). İleride ağ katmanı açılırsa mod `ui+audio`'ya çekilir.

## 3. Kalite seçenekleri ve gate mekaniği (`xpui-routes-desktop-settings.js`)

- Etiket sözlüğü `sM`: `AUTOMATIC/LOW/MEDIUM/HIGH/VERY_HIGH/LOSSLESS/PETREL`
  (`desktop.settings.streamingQualityVeryHigh`, `web-player.pigeon.audio-quality.lossless`).
- Filtre `sL(e,t,s,i,l)`:
  - `LOW/MEDIUM` → `!s` (düşük kaliteyi gizle bayrağı)
  - `AUTOMATIC/HIGH` → her zaman görünür
  - `VERY_HIGH` → `t >= Qi.VERY_HIGH`, `t` = **`t.quality.maxSupportedQuality`** sorgusunun
    (sunucu entitlement/özellik durumu) `Qi` enum'una maplenmiş sonucu
  - `LOSSLESS` → `t === Qi.LOSSLESS`; `PETREL` → `i && (t === LOSSLESS) && l`
- Render: `sF` seçikleri `formats` listesinden `<option>` olarak üretir; gate geçenler
  DOM'a gelir, geçmeyenler hiç render edilmez.
- **Sonuç:** gate sunucu tarafındaki `maxSupportedQuality`/entitlement verisiyle sürülür.
  ReverseSpotify `quality.js` **yalnızca DOM'da mevcut ama `disabled`/gizli duran option'ların
  görünürlüğünü serbest bırakır** (reveal-only). Entitlement değerine, `maxSupportedQuality`
  sorgusuna veya option üretimine dokunmak **YOK** (Global Constraint: premium bypass yok —
  test ile kilitli).

## 4. Chunk yapısı notları

- Reklam çekirdeği `4468.js` (NPV video player), ev reklamları `home-ads-container.js`,
  leavebehind `playlist-leavebehinds.js` + route'lar; kalite ayarları
  `xpui-routes-desktop-settings.js` (dropdown id'leri: `desktop.settings.downloadQuality`,
  `desktop.settings.remoteStreamingQuality`).
- Hepsi `rspackChunk` push formatında (T4 keşfiyle uyumlu).
