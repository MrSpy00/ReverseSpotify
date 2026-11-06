# PROJECT.md — ReverseSpotify

## Kimlik

| Alan | Değer |
| :--- | :--- |
| Şirket | aegisSoft |
| Baş Geliştirici | mrSpy |
| Paket | `com.aegissoft.reversespotify` |
| GitHub | https://github.com/MrSpy00/ReverseSpotify |
| Hedef Platform | Windows x64 — Spotify Desktop `1.3.8.620` (`%APPDATA%\Spotify`) |
| Stack | Python 3.14 (CLI/motor) + Vanilla JS (loader/tema/plugin) |

## Ne Yapar

Spicetify bağımsız, sürüm-agnostik bağımsız mod motoru: `Apps\xpui.spa`
(standart ZIP) içine `index.html` → `reverse-loader.js` enjeksiyonu ile
tema motoru, denetimli plugin sistemi, ad-block, UI overhaul ve kalite
reveal (premium bypass YOK — ToS sınırı) sunar; güncelleme sonrası
otomatik iyileşme (watch/heal) sağlar.

## Mimari Harita

```
reversespotify/
  spa.py        xpui.spa okuma/yazma/sha256
  patch.py      inject_loader/has_loader (idempotent, T2)
  config.py     data_root/spotify_apps_dir (T3)
  process.py    spotify_running/kill/wait (T3)
  cli.py        install|restore|status|themes|plugins|watch (T3+)
  loader/       reverse-loader.js + boot API (T4-7)
  themes/       clean-dark, amoled (T5)
  plugins/      key-highlight örneği + lint (T6)
tests/          pytest + node:test, fixtures/index.html (gerçek1.3.8.620)
tools/          spike_repack.py (Faz0 spike, throwaway)
```

## Uygulanan Algoritmalar / Güvenlik

- **Faz0 spike DOĞRULANDI:** gerçek spa'ye marker enjeksiyon → repack →
  Spotify15 sn ayakta → bayt-tamam restore (sha256 eşit).
- Pristine yedek asla ezilmez (`Backup/xpui.spa.pristine`).
- Plugin lint: MutationObserver-throttle / setInterval<100ms /
  backdrop-filter / sync döngü → hard-fail (performans bütçesi).
- ToS sınırı: premium bypass / kalite yükselteci YOK (sadece UI reveal).
- Spicetify bağımlılığı ve Spicetify.* shim'i v1'de YOK.

## Derleme & Kurulum

```powershell
# Kurulum (Spotify kapalı olmalı)
python -m reversespotify install --yes
# Varsayılana dönüş
python -m reversespotify restore
# Durum
python -m reversespotify status
# Test
python -m pytest -q ; node --test tests/js/
```

## Yol Haritası

1. Faz1 (T2-T4): enjeksiyon + CLI + loader çekirdeği
2. Faz2 (T5-T7): tema + plugin + ad-block/UI/quality modülleri
3. Faz3 (T8-T9): auto-heal watcher + tam akış doğrulama
4. Sonrası: Windows UI ayarlayıcı (Tauri/WinUI), tema galerisi, GitHub
   kaynaklı denetli plugin havuzu yayını
