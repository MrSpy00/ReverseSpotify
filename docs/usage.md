# ReverseSpotify — Kullanım Kılavuzu

Hedef: Spotify Desktop 1.3.8.620 (Windows). Komutlar repo kökünden:
`python -m reversespotify <komut>`.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `install --yes` | Yedek alır (pristine), loader + tema + plugin'leri paketler, Spotify'ı başlatır |
| `restore --yes` | Bayt-tamam orijinal `xpui.spa`'ya döner, marker'ı siler |
| `status` | Sağlık raporu; exit: **0** modded-sağlıklı, **1** bozuk, **2** vanilla |
| `themes list` / `themes set <id> --yes` | Tema listele / uygula (8 tema: `clean-dark`, `amoled`, `crimson`, `ocean`, `forest`, `amber`, `lavender`, `nord` — crimson arkaplan duvar kağıtlı) |
| `plugins list` / `plugins add <ref> --yes` | Plugin envanteri / ekle (yerel `plugins/<id>` · GitHub URL · registry id) |
| `plugins remove\|enable\|disable <id> --yes` | Plugin yönetimi (runtime disable tarayıcıda `rs:disabled` ile olur) |
| `watch --once` | Tek tespit+onarım: `ok`→0 · `healed`→0 · `vanilla`→2 · `broken`→1 |
| `watch --install-task` | `ReverseSpotifyHeal` (logon) + `ReverseSpotifyHealDaily` (13:00) görevlerini kurar |

## Uygulama içi kontrol paneli (terminal gerekmez)

Spotify açıkken **üst bardaki kırmızı anka kuşu ikonuna** (profil avatarının solunda, Spotify'ın
kendi buton stiliyle) veya **Ctrl+Shift+,** tuşlarına bas; **ESC** ile kapat. Panel dört sekmeli:

- **Tema** — kurulu temalar arasında kartlarla anında geçiş (manifest'ten gelen ad + renk
  önizlemeli, seçili kart yeşil çerçeve + check), "Kapalı (vanilla görünüm)" ile temayı
  kapatma. Panel seçimi `rs:theme` localStorage anahtarında tutulur; "Varsayılan (config)"
  ile CLI `themes set` kararına dönülür. Crimson teması seçiliyken arkaplan duvar kağıdı
  (`#rs-bg` katmanı) otomatik yüklenir. Ek olarak:
  - **Tema arkaplanı** — "Görsel/Video seç" ile seçili temaya kendi dosyanız (image/*,
    video/*, ≤4 MB) atanır (`rs:bg:<tema>`); manifest arkaplanından ÖNCE gelir, "Özeli
    kaldır" ile silinir. Video dosyaları otomatik döngülü/sessiz oynatılır.
  - **Tema oluştur** — kimlik + ad + 2 renk + CSS ile kendi temanızı oluşturup anında
    uygular (`rs:customThemes`); "Özel temalar" bölümünden yönetim/silme yapılır.
- **Eklentiler** — her satırda eklentinin **açıklaması her zaman görünür** (manifest
  `description`), ardından durum. Aktif plugin'i aç/kapat (`rs:disabled`, bir sonraki
  açılışta geçerli; CLI-pasif olanlar panel'den açılmaz). Chevron alt menüsü: performans
  sınıfı, izinler, giriş dosyası, depo bağlantısı ve **ayarlar** — manifest `settings`
  şemasındaki kontroller (ör. remaining-time "Konum": alt-orta/sag-alt/sol-alt/ust-orta)
  anında `rs:set:<id>` anahtarına kaydedilir. "Plugin ekle" ile kendi eklentinizi
  (kimlik/ad/açıklama/izinler/JS kod) yazıp çalıştırabilirsiniz (`rs:customPlugins`,
  kayıtta sözdizimi + hız kontrolü yapılır).
- **Temizlik** — adblock ve upsell/dsa gruplarını anında aç/kapat (`rs:ui:*` anahtarları,
  sayfa yenilenmeden etkili).
- **Araçlar** — kalite reveal-only seçik sayısı (`Göster` ile yeniden dener), kısayollar,
  mod/fallback bilgisi ve genel sıfırlama talimatı.
- **Ayak bağlantıları** — GitHub · aegisSoft · MrSpy00 (hepsi tıklanabilir, URL'ler
  config'ten gelir — hardcoded değil).

Öncelik: panel (`rs:theme`) > CLI config. Panel'de "Varsayılan (config)" seçeneği yoksa
(ilk kez tema seçilmediyse) CLI config uygulanır.

## Tam akış kontrol listesi (doğrulanmış — 2026-11-06)

| Adım | Beklenen |
| --- | --- |
| `restore --yes` → `status` | restore=0, status=**2** (vanilla) |
| `install --yes` → `status` | install=0, status=**0** |
| `themes set amoled --yes` → `status` | 0, status=**0**, `tema: amoled` |
| `plugins add key-highlight --yes` → `status` | 0, status=**0**, `plugin: ... (aktif)` |
| CDP gözlem | modules 6/6 failed[], `adblock ui-only (39 seçik)`, badge `.rs-keyhl`, panel `#rs-panel-btn` üst barda (user-widget-link solu) → `#rs-panel`, ESC ile kapanır |
| `themes set clean-dark --yes` | 0 |
| `watch --once` (sağlıklı kurulum) | **`watch: ok`** (0) |
| spa hash bilinçli değişimi → `watch --once` | **`watch: healed`** → status=0 |
| `restore --yes` → `status` | 0, status=**2** |

**Performans (stopwatch):** pencere görünme süresi MODDED 1,1s · VANILLA 1,0s
(fark +0,1s — belirgin lag yok). Plugin + tema açıkken CDP etkileşimi akıcı.

## Runtime anahtarları (tarayıcı içi, `localStorage`)

| Anahtar | Etki |
| --- | --- |
| `rs:theme` | Panel tema override'ı: `""` = kapat, yok = CLI config (`rs:theme` > config) |
| `rs:bg:<temaId>` | Kullanıcı arkaplanı (dataURL image/video) — manifest `background`'ından önce gelir |
| `rs:customThemes` | JSON array — panel "Tema oluştur" ile oluşturulan özel temalar `{id,name,swatch,css}` |
| `rs:customPlugins` | JSON array — panel "Plugin ekle" ile oluşturulan özel eklentiler `{id,...,code}` |
| `rs:set:<pluginId>` | JSON object — eklenti ayarları (manifest `settings` şeması); facade `getSetting/setSetting` |
| `rs:ui:upsell` = `0` | Upsell/indir banner gizlemesini kapatır |
| `rs:ui:dsa` = `0` | `home-dsa-message-banner` gizlemesini kapatır |
| `rs:disabled` | JSON array — çöken plugin/çekirdek modüller otomatik buraya düşer (`plugin:<id>`). Çöken plugin: `plugins enable <id>` (config'e `resetDisabled` yazar, boot'ta rs:disabled'tan temizlenir). Çekirdek modül veya genel temizlik: konsoldan `localStorage.removeItem('rs:disabled')` |
| `rs:error` | Son plugin hata kaydı (debug) |

## Performans bütçesi (plugin kuralları — lint hard-fail, `--force` bile geçemez)

- MutationObserver → throttle/debounce/rAF zorunlu
- `setInterval` <100ms → yasak
- `backdrop-filter` → yasak
- senkron `querySelectorAll` döngüsü → yasak

## Sınırlar (bilinçli)

- **Premium bypass yok** — kalite reveal-only (ToS sınırı). `adblock mode = ui-only`:
  sesli-reklam hook'u xpui'de yok (docs/xpui-findings.md §2).
- Spicetify shim yok (v2 roadmap).
- `restore`, ilk kurulumun pristine baytlarına döner; güncelleme sonrası sürüm-pristine'ler
  `Backup/xpui.spa.pristine.<version>` altında birikir (v2: restore sürüm seçimi).

## Sorun giderme

```powershell
python -m reversespotify status          # exit 1 → ne yazıyorsa o
python -m reversespotify watch --once    # otomatik onarım dener
python -m reversespotify restore --yes   # tamamen orijinala dön
```
