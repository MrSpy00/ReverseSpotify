"""Yol çözümleme: ReverseSpotify data root + Spotify Apps dizini."""

import os
from pathlib import Path

# Tek kaynak: proje URL'si config'e buradan yazılır, loader/panel buradan okur
PROJECT_REPO = "https://github.com/MrSpy00/ReverseSpotify"
SITE_URL = "https://aegissoft.com.tr"
AUTHOR_URL = "https://github.com/MrSpy00"


def data_root() -> Path:
    # REVERSESPOTIFY_HOME: test/taşınabilir kurulum izolasyonu
    override = os.environ.get("REVERSESPOTIFY_HOME")
    if override:
        return Path(override)
    return Path(os.environ["APPDATA"]) / "ReverseSpotify"


def spotify_apps_dir(override: str | None = None) -> Path:
    if override:
        return Path(override)
    return Path(os.environ["APPDATA"]) / "Spotify" / "Apps"
