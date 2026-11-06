"""Güncelleme izleyici — spa/prefs drift tespiti + otomatik onarım."""

from __future__ import annotations

import json
import re
from pathlib import Path

from . import config, patch, spa


def _prefs_path(apps: Path) -> Path | None:
    users = apps.parent / "Users"
    if not users.is_dir():
        return None
    for d in sorted(users.iterdir()):
        p = d / "prefs"
        if p.is_file():
            return p
    return None


def spotify_version(apps: Path) -> str | None:
    prefs = _prefs_path(apps)
    if prefs is None:
        return None
    m = re.search(
        r'app\.last-launched-version="([^"]+)"',
        prefs.read_text(encoding="utf-8", errors="ignore"),
    )
    return m.group(1) if m else None


def check_and_heal(spotify_dir: str | None = None) -> str:
    """\"ok\" | \"healed\" | \"vanilla\" | \"broken\" — heal, install akışının reuse'u."""
    apps = config.spotify_apps_dir(spotify_dir)
    spa_path = apps / "xpui.spa"
    if not spa_path.exists():
        return "broken"
    try:
        entries = spa.read_spa(spa_path)
        html = entries["index.html"].decode("utf-8")
    except Exception:  # noqa: BLE001 — bozuk zip = broken
        return "broken"

    marker = config.data_root() / "data" / "reverse.json"
    marked = marker.exists()

    if not patch.has_loader(html):
        if not marked:
            return "vanilla"
        # yükleme güncellemeyle silinmiş → vanilla spa'dan sürüm pristine'i al + heal
        return _heal(spotify_dir, versioned=True)

    if not (config.data_root() / "Backup" / "xpui.spa.pristine").exists():
        return "broken"
    if not marked:
        return "broken"  # loader var ama marker yok — tutarsız kurulum

    try:
        installed = json.loads(marker.read_text(encoding="utf-8"))
        if not isinstance(installed, dict):
            installed = {}
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        installed = {}  # bozuk marker → hash uyuşmazlığı gibi heal (asla traceback)
    if installed.get("hash") != spa.spa_hash(spa_path):
        return _heal(spotify_dir, versioned=False)

    cur = spotify_version(apps)
    if cur and installed.get("version") and installed["version"] != cur:
        return _heal(spotify_dir, versioned=False)

    return "ok"


def _heal(spotify_dir: str | None, versioned: bool) -> str:
    if versioned:
        apps = config.spotify_apps_dir(spotify_dir)
        v = spotify_version(apps)
        if v:
            vp = config.data_root() / "Backup" / f"xpui.spa.pristine.{v}"
            if not vp.exists():
                # spa şu an vanilla (loader yok) — baytları doğrudan koru
                vp.parent.mkdir(parents=True, exist_ok=True)
                vp.write_bytes((apps / "xpui.spa").read_bytes())
    from . import cli  # döngüsel importu önlemek için çağrı anında

    argv = ["install", "--yes"]
    if spotify_dir:
        argv += ["--spotify-dir", spotify_dir]
    return "healed" if cli.main(argv) == 0 else "broken"
