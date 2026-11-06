"""Tema dizini tarama ve manifest doğrulama.

Manifest şeması: {"id","name","author","version","entryCss"} + isteğe bağlı
{"swatch":[#hex,#hex], "background":dosya, "backgroundVideo":dosya}.
id/entryCss/asset zip giriş yolu üretiminde kullanılır → katı doğrulama (path traversal yok).
"""

import json
import re
from pathlib import Path

THEMES_ROOT = Path(__file__).resolve().parent.parent / "themes"
_REQUIRED = ("id", "name", "author", "version", "entryCss")
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_ENTRY_RE = re.compile(r"^[a-z0-9][a-z0-9.-]*$")
_ASSET_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")  # dizin ayracı YOK (traversal yok)
_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def list_themes(root: Path | None = None) -> list[dict]:
    root = root or THEMES_ROOT
    out: list[dict] = []
    if not root.exists():
        return out
    for d in sorted(root.iterdir()):
        mf = d / "manifest.json"
        if not mf.exists():
            continue
        try:
            data = json.loads(mf.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"geçersiz manifest {mf}: {exc}") from exc
        if not isinstance(data, dict):
            raise ValueError(f"geçersiz manifest {mf}: sözlük bekleniyordu")
        missing = [k for k in _REQUIRED if k not in data]
        if missing:
            raise ValueError(f"geçersiz manifest {mf}: eksik alan {missing}")
        if not isinstance(data["id"], str) or not _ID_RE.match(data["id"]) or data["id"] != d.name:
            raise ValueError(f"geçersiz manifest {mf}: id '{data['id']}' dizin adıyla uyuşmuyor")
        if not isinstance(data["entryCss"], str) or not _ENTRY_RE.match(data["entryCss"]):
            raise ValueError(f"geçersiz manifest {mf}: entryCss '{data.get('entryCss')}' güvenli değil")
        if "swatch" in data:
            sw = data["swatch"]
            if (
                not isinstance(sw, list)
                or len(sw) != 2
                or any(not isinstance(c, str) or not _COLOR_RE.match(c) for c in sw)
            ):
                raise ValueError(f"geçersiz manifest {mf}: swatch {sw!r} güvenli değil")
        for key in ("background", "backgroundVideo"):
            if key in data:
                val = data[key]
                if not isinstance(val, str) or not _ASSET_RE.match(val) or not (d / val).is_file():
                    raise ValueError(f"geçersiz manifest {mf}: {key} {val!r} güvenli değil veya dosya yok")
        out.append(data)
    return out


def get_theme(theme_id: str, root: Path | None = None) -> dict:
    for t in list_themes(root):
        if t["id"] == theme_id:
            return t
    raise ValueError(f"tema bulunamadı: {theme_id}")
