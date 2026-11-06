<p align="center">
  <img src="docs/assets/logo.svg" width="96" height="96" alt="ReverseSpotify logo">
</p>

# ReverseSpotify

Spotify masaüstü için bağımsız mod: tema motoru, reklam/UI temizliği, eklentiler ve uygulama içi kontrol paneli. **Spicetify bağımlılığı yok**, premium bypass yok (ToS), pristine yedek her zaman korunur.

## Özellikler

- **Tema motoru** — 8 hazır tema (Clean Dark, AMOLED, Crimson Ember, Deep Ocean, Dark Forest, Amber Dusk, Lavender Haze, Nord Frost); crimson temasında duvar kağıdı, manifest'ten `background`/`backgroundVideo` desteği
- **Kontrol paneli** — Spotify üst barında anka kuşu ikonlu panel: Tema / Eklentiler / Temizlik / Araçlar sekmeleri, genişletilebilir eklenti detayları, tıklanabilir bağlantılar (`Ctrl+Shift+,`)
- **Özelleştirme** — eklenti açıklamaları her satırda + eklenti ayar menüleri (ör. kalan süre konumu), temalara kendi görsel/video arkaplanı (≤4MB), panelde "Tema oluştur" ve "Plugin ekle" formları (tarayıcıda saklanır)
- **Reklam & UI temizliği** — upgrade/upsell bannerları, ana sayfa duyuru bandı (reveal-only kalite seçenekleri ile)
- **Eklentiler (6)** — `key-highlight`, `back-to-top`, `shortcuts-help` (`?`), `copy-now-playing` (`Ctrl+Alt+C`), `remaining-time`, `rs-inspect` (`Ctrl+Alt+I`)
- **Tek komut** — kurulum, tema/eklenti yönetimi, yedekleme ve geri alma

## Hızlı başlangıç

```powershell
python -m reversespotify install --yes     # kur (pristine yedeklenir)
python -m reversespotify themes set crimson
python -m reversespotify plugins add back-to-top
python -m reversespotify status
python -m reversespotify restore           # pristine'e dön
```

## Belgeler

- [Kullanım kılavuzu](docs/usage.md)
- [Proje notları](PROJECT.md)
- Lisans: kaynak kodu depoda — [`MrSpy00/ReverseSpotify`](https://github.com/MrSpy00/ReverseSpotify)

aegisSoft · MrSpy00 · [aegissoft.com.tr](https://aegissoft.com.tr)
