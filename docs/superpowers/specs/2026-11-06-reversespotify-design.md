# ReverseSpotify — Design Doc & Uygulama Planı

> Proje dizini: `X:\mrspy\Reverse Engineering\Projeler\ReverseSpotify\`
> Kimlik: aegisSoft · mrSpy · `com.aegissoft.reversespotify` · GitHub MrSpy00
> Hedef: Spotify Windows masaüstü **1.3.8.620** (`C:\Users\mrSpy\AppData\Roaming\Spotify`)

---

## 1. Niyet / Why

Kullanıcı mevcut Spotify'ı Spicetify + Marketplace ile modlamaya çalıştı; üç yapısal sorun yaşandı:

1. **Güncelleme kırılganlığı:** Spicetify v2.46.4 yalnızca Spotify 1.2.14–1.3.7 destekliyor — kullanıcıdaki **1.3.8.620 destek dışı**. Her güncelleme sonrası `spicetify backup apply` döngüsü ve tam kilit.
2. **Lag/kasma:** performans bütçesi olmayan topluluk kodu — ağır MutationObserver'lar (Beautiful Lyrics bilinen yavaşlatıcı), sınırsız `backdrop-filter` blur'lar, startup maliyeti.
3. **Kurulum karmaşası + kırılan plugin'ler:** çok adımlı config/apply, sürüm-kilitli plugin'lerin sessizce kopması, güvenlik doğrulaması olmayan marketplace.

**Çözüm:** Spicetify'ye bağımlı olmayan, kendi başına çalışan, sürüm-agnostik, performans bütçeli, tek komutla kurulan **ReverseSpotify mod motoru**. Başka uygulama yapılmaz; var olan Spotify ve kendi dosyaları kullanılır.

---

## 2. Kararlar (approaches + onaylı tercihler)

| # | Karar | Seçim |
|---|-------|-------|
| 1 | Yaklaşım | **B: Kendi motorumuz** — A (Spicetify sarmalayıcı: 1.3.8 dışı, kırılganlık devralınır) ve C (baştan hibrit) reddedildi. Spicetify.* shim **v1 kapsamı DIŞI** (kullanıcı: "kendi apimiz olsun"). |
| 2 | Kapsam | **Komple mod paketi:** tema motoru + plugin sistemi + ad-block + UI overhaul + kalite-UI modülü. |
| 3 | Plugin ekosistemi | **Kendi API'miz + kendi topluluğumuzun plugin'leri** — kendi küratörlü havuzumuz (GitHub kaynaklı, otomatik listelenen/kurulan plugin'ler) + kendi yazdığımız plugin'ler. Spicetify plugin mağazası değil. |
| 4 | Ad-block kapsamı | **UI banner/custom ads kesin + audio ads best-effort** (istemci tarafında mümkün olan filtreleme denenir; sonuç test edilir, olmazsa modül açıkça raporlar). |
| 5 | Kalite sınırı | **UI + ayarlar (reveal-based):** hesabın izin verdiği kalite seviyelerinin UI'da tam açığa çıkması + sistem ayarları. **Premium kilidi aşma / free'de yüksek kalite YOK** (ToS ihlali — bilinçli sınır, sunucu tarafı müdahale yok). |
| 6 | Öncelik | Lag/kasma/guncelleme-bozulma sorunları **her özellikten önce** çözülür. |

---

## 3. Hedefler / Non-goals / Anti-goals

### Goals
- Spotify'ı bozmadan modlama: pristine yedek, modül başına hata izolasyonu, acil `restore` ile vanilla'ya dönüş.
- **Güncelleme dayanıklılığı:** sürüm-agnostik feature-detection; Spotify güncellenince otomatik tespit + yeniden enjeksiyon (auto-heal).
- **Performans bütçesi:** loader asenkron ve minimal; plugin lint'i ihlali = reddet/devre dışı bırak.
- **Tek komut kurulum / tek komut geri dönüş.**
- Kendi topluluğumuzun GitHub plugin'lerinin kurulumu otomatik ve denetimli.
- Kullanıcı dostu hata mesajları; asla sessiz bozulma yok.

### Non-goals / Anti-goals
- Başka uygulama / sidecar / overlay yok; Spicetify bağımlılığı yok; hosts veya sistem-seviyesi hack yok.
- Premium kilidi aşma yok; DRM/sunucu tarafı müdahale yok.
- macOS/Linux/mobil yok (ileri faz).
- Spotify ikili dosyaları yeniden dağıtılmaz (yalnız yerel patch).
- Marketplace web sitesi yok (yerel + GitHub kaynaklı küratörlü registry).
- **Anti-goal:** güncelleme sonrası manuel "repair" adımı gerektiren bir sistem.

---

## 4. Saha Gerçekleri (kanıtlanmış keşif)

- `xpui.spa` = **standart ZIP** (614 dosya, 13 klasör, 44.4MB ham).
- **Enjeksiyon noktası kanıtlandı** (temp'te çıkarıldı ve okundu): `index.html` → `<link href="/xpui-snapshot.css">` + `<script defer="defer" src="/xpui-snapshot.js"></script>`.
- `prefs`: `storage.location="X:\Uygulamalar\SpotifyStorage"`, sürüm `1.3.8.620.g39b276d5d7ac`.
- Spotify çalışıyor durumda (8 process) → install sırasında dosya kilidi stratejisi şart.
- Ortam: `spicetify` PATH'te yok (temiz kurulum), 7-Zip tam yol ile (`X:\Uygulamalar\7-Zip\7z.exe`), Python 3.14 mevcut.

---

## 5. Mimari (seçilen "nasıl")

### 5.1 Injector CLI — `reverse-spotify`
- Komutlar: `install` · `uninstall` · `status` · `restore` · `plugins` (list/add/remove) · `themes`
- `install` akışı:
  1. Pristine yedek al (`xpui.spa` → `ReverseSpotify/Backup/xpui.spa.pristine` — ilk kurulumda bir kez, asla ezilmez).
  2. Spotify süreç politikası (**kararım**): önce nazik prompt "Spotify'ı kapat" → 30 sn timeout → force-kill + kurulum sonrası yeniden başlatma teklifi.
  3. `xpui.spa`'yı çıkar → `index.html`'i **parse ederek** (`<script defer src="/xpui-snapshot.js">` etiketini güvenilir şekilde tespit) loader script etiketi ekle → `reverse-loader.js` + assets + themes/plugins ekle → yeniden paketle.
  4. `status` ile doğrulama (hash + injection noktası).
- `restore`: pristine yedekten vanilla'ya birebir dönüş.
- **Faz 0 spike (builder-call, zorunlu):** inject → repack → launch → smoke test. Integrity/imza kontrolü çıkarsa strateji değişir (fallback notu: runtime/launcher-hook enjeksiyonu) — plan bu spike ile başlar.
- **Injection noktası dayanıklılığı:** patch her install'da yeniden uygulanır (mutable patch modeli); xpui.spa hash değişimi VEYA injection noktası tespit edilemezse → yeniden install tetiklenir.

### 5.2 Loader — `reverse-loader.js` (index.html'e eklenen tek script)
- Boot sırası: xpui globals **feature-detection** → `window.ReverseSpotify` API → theme engine → plugin API → ad-block → UI modülleri.
- Her modül `try/catch` izole; bir modül çökerse diğeri ve app çalışmaya devam eder; loader tamamen başarısızsa Spotify vanilla gibi açılır (defansif bootstrap).
- Asenkron, startup bütçeli (async init, senkron yol sadece kritik kayıt).

### 5.3 TEMA motoru
- `ReverseSpotify/Themes/<name>/theme.css + manifest.json` (ad, sürüm, author, değişken haritası).
- CSS variable override tabanlı (Spotify xpui değişkenlerini hedefler) — ağır yeniden yazım yok, düşük maliyet.
- Aktif tema `manifest` + `prefs`/local config ile kalıcı; tema değiştir → reload yeterli.

### 5.4 PLUGIN sistemi — kendi API'miz
- `ReverseSpotify/Plugins/<name>/manifest.json` (name, entry, version, permissions, perf-class) + JS entry.
- **ReverseSpotify API:** lifecycle (`onReady`, `onRouteChange`), settings storage, xpui/React erişim shim'leri (`ReverseSpotify.React`, `ReverseSpotify.Platform` — **kendi API yüzeyimiz**, Spicetify.* değil), UI helper'ları.
- İzolasyon: plugin başına `try/catch`; çöken plugin otomatik disable + kullanıcıya bildirim.
- **Kendi topluluğu havuzu:** GitHub kaynaklı küratörlü registry dosyası (`registry.json` → repo/路径/ürün listesi); `reverse-spotify plugins` CLI plugin'leri **otomatik listeler ve kurar** (fetch → lint → install).
- **Denetimli kurulum (lint + perf bütçesi):** yasaklı kalıplar — throttlesiz sürekli MutationObserver, sınırsız `backdrop-filter`, <100ms `setInterval`, senkron büyük DOM taramaları → **ihlal = reddet / devre dışı**. Bu, "lag/kasma" şikayetinin kök çözümü.

### 5.5 AD-BLOCK modülü
- UI banner / custom ads / upsell gizleme: **kesin kapsam**.
- Audio ads: istemci tarafı mümkün olan filtreleme **best-effort** — test edilir, başarısızsa modül bunu `status` raporunda açıkça yazar (güvenilir sonuç vermezse abartılı vaat yok).

### 5.6 UI OVERHAUL modülleri
- Temizlik ve iyileştirmeler (ör. gereksiz banner/uplift gizleme, düzen iyileştirmeleri) — tema motoru üzerinden katmanlar hâlinde, performans bütçeli.

### 5.7 KALİTE UI modülü (sınır içinde)
- Yalnız **reveal-based:** hesabın izin verdiği kalite seviyelerinin UI'da/sistem ayarlarında tam görünmesi. Sunucu tarafı veya premium kilidi müdahalesi **YOK**.

### 5.8 Update watcher / auto-heal
- Tespit: Spotify sürümü (`prefs` / FileVersion) veya `xpui.spa` hash değişimi.
- Mekanizma (**builder call, öneri:** kurulumda Scheduled Task (login + günlük) `reverse-spotify status --check` → değişiklik varsa otomatik `install`; ayrıca CLI `watch` elle mod).
- Amaç: kullanıcı güncelleme sonrası **hiçbir manuel adım atmaz**.

---

## 6. Builder Calls (bu planda benim kararlarım — kontrol edin)

1. **Stack:** CLI/için **Python 3.14** (zipfile, lint, GitHub fetch — mevcut runtime, ek bağımlılık yok); loader/plugin/theme dili **JS/CSS**. (Alternatif .NET singlefile idi; Python daha kısa yol, ponytail: en az kod.)
2. **Süreç politikası:** nazik prompt → 30 sn timeout → force-kill (+ restart teklifi).
3. **Faz 0 spike zorunlu:** repack round-trip doğrulanmadı — planın ilk işi bu; başarısızlık senaryosu önceden yazılı (fallback: runtime/launcher-hook).
4. **Kalite modülü reveal-only** (kullanıcı kararıyla uyumlu).
5. **Spicetify.* shim v1'de YOK** (kullanıcı: "kendi apimiz olsun").
6. **Watcher:** Scheduled Task önerisi (builder detaylandırır).

---

## 7. Uygulama Fazları (onay sonrası writing-plans ile ayrıştırılır)

| Faz | İçerik | Çıktı / Doğrulama |
|-----|--------|--------------------|
| **0** | **Spike:** extract → inject → repack → launch → smoke test | Spotify modifiye xpui ile hatasız açılıyor; integrity kontrolü yok kanıtı |
| **1** | CLI iskeleti: `install/uninstall/status/restore` + pristine backup + süreç politikası | Tek komutla kurulum/geri dönüş; `status` hash doğruluyor |
| **2** | Loader çekirdeği: feature-detection, `window.ReverseSpotify`, hata izolasyonu | App bozulmadan loader boot; modül çökmesi app'i indirmiyor |
| **3** | Tema motoru + 2 örnek tema | CSS-variable tema geçişi, canlı doğrulama |
| **4** | Plugin API + izolasyon + lint/perf-budget + kendi topluluk registry (GitHub fetch) | `plugins add/list`; lint ihlalli plugin reddediliyor |
| **5** | Ad-block (UI + audio best-effort) + UI overhaul + kalite-UI reveal | Reklam UI'ı gizli; scope 5 uyarlı |
| **6** | Update watcher / auto-heal + `PROJECT.md` + kullanım dokümanı | Spotify sürümü değiştirilmiş gibi simüle → otomatik re-inject |
| **7** | Topluluk plugin'leri首批 (küratörlü) + performans regresyon testi | Start-up overhead bütçesi içinde; lag yok raporu |

---

## 8. Kısıtlar (AGENTS.md uyumu)

- Betiklerde yol bağımsızlığı (`$PSScriptRoot` / `%~dp0` / script-relative Python), mutlak yol yok.
- `PROJECT.md` proje kökünde zorunlu (faz 6'da).
- UI'da emoji ikon yok; profesyonel vektör ikon/SVG.
- ToS sınırı: premium bypass yok — bilinçli ve dokümante edilmiş.
- Spotify dosyalarına geri dönüş her zaman mümkündür (`restore` = pristine).

---

## 9. Riskler

| Risk | Etki | Mitigasyon |
|------|------|------------|
| Repack'te integrity/hash kontrolü çıkarsa | B stratejisi çöker | **Faz 0 spike** ilk iş; fallback stratejisi yazılı |
| Injection noktası sürümde değişirse | Patch sessiz kopar | Parse-etect + hash tespit + otomatik re-patch (auto-heal) |
| Plugin lag/getirirse | Ana şikayet geri döner | Lint + perf budget + plugin izolasyonu + devre dışı bırakma |
| Audio ads client-side'da engellenemezse | Vaat tutmaz | Best-effort + `status` raporunda dürüst sonuç |
| Spotify süreç kilidi | Install başarısız | Prompt → timeout → force-kill stratejisi |
