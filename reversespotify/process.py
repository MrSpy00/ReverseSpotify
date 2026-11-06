"""Spotify süreç politikası: algıla / bekle / öldür / başlat."""

import subprocess
import time
from pathlib import Path

IMAGES = ("Spotify.exe", "SpotifyLauncher.exe")


def spotify_running() -> bool:
    out = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq Spotify.exe"], capture_output=True, text=True
    ).stdout
    return any(
        line.strip().lower().startswith("spotify.exe") for line in out.splitlines()
    )


def wait_for_spotify_exit(timeout: int = 30) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not spotify_running():
            return True
        time.sleep(1)
    return not spotify_running()


def kill_spotify() -> None:
    for name in IMAGES:
        subprocess.run(["taskkill", "/F", "/IM", name], capture_output=True)
    time.sleep(1)


def start_spotify(exe: Path) -> bool:
    exe = Path(exe)
    if not exe.exists():
        return False
    subprocess.Popen([str(exe)])
    return True
