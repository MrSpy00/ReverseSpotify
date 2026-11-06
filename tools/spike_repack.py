"""Faz 0 spike (throwaway): repack round-trip'inin gerçek Spotify'ta doğrulanması.

Gerçek xpui.spa'ye marker enjekte eder, repack eder, Spotify'ı başlatır,
15 sn process ayakta kalırsa PASS der, HER DURUMDA (finally) orijinal
baytları geri yazar ve hash doğrular. Orijinal asla ezilmez.

Kullanım: python tools/spike_repack.py [--yes]
  --yes: çalışan Spotify süreçlerini kendisi kapatır (yoksa abort).
"""

import hashlib
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from reversespotify import spa  # noqa: E402

SPOTIFY_DIR = Path.home() / "AppData" / "Roaming" / "Spotify"
SPA = SPOTIFY_DIR / "Apps" / "xpui.spa"
BACKUP = SPOTIFY_DIR / "Apps" / "xpui.spa.spike-backup"
EXE = SPOTIFY_DIR / "Spotify.exe"
TAG = '<script defer="defer" src="/xpui-snapshot.js"></script>'
MARKER = '<script>window.__RS_SPIKE__=1</script>'


def spotify_procs() -> list[str]:
    out = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq Spotify.exe"], capture_output=True, text=True
    ).stdout
    return [
        line.split()[0]
        for line in out.splitlines()
        if line.strip().lower().startswith("spotify.exe")
    ]


def kill_spotify() -> None:
    for name in ("Spotify.exe", "SpotifyLauncher.exe"):
        subprocess.run(["taskkill", "/F", "/IM", name], capture_output=True)
    time.sleep(2)


def main() -> int:
    yes = "--yes" in sys.argv
    original = SPA.read_bytes()
    orig_hash = hashlib.sha256(original).hexdigest()

    if spotify_procs() and not yes:
        print("ABORT: Spotify çalışıyor. Kapat veya --yes ver.")
        return 2
    if yes:
        kill_spotify()

    BACKUP.write_bytes(original)  # acil durum yedeği (finally silinir)
    try:
        entries = spa.read_spa(SPA)
        html = entries["index.html"].decode("utf-8")
        if TAG not in html:
            print("FAIL: xpui script etiketi bulunamadı (sürüm değişmiş?)")
            return 1
        if MARKER not in html:
            entries["index.html"] = html.replace(TAG, MARKER + TAG).encode("utf-8")
        spa.write_spa(entries, SPA)
        print(f"enjekte+repack OK  {orig_hash[:16]} -> {spa.spa_hash(SPA)[:16]}")

        subprocess.Popen([str(EXE)])
        time.sleep(15)
        alive = bool(spotify_procs())
        print(f"15 sn sonra process ayakta: {alive}")
        return 0 if alive else 1
    finally:
        kill_spotify()
        SPA.write_bytes(original)
        assert hashlib.sha256(SPA.read_bytes()).hexdigest() == orig_hash, "RESTORE BOZUK"
        BACKUP.unlink(missing_ok=True)
        print(f"restore OK (hash eşit: {orig_hash[:16]})")


if __name__ == "__main__":
    raise SystemExit(main())
