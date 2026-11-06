"""Yol çözümleme: ReverseSpotify data root + Spotify Apps dizini."""

import os
from pathlib import Path


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
