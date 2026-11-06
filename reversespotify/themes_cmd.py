"""Tema dizini tarama ve manifest doğrulama.

Manifest şeması: {"id","name","author","version","entryCss"}.
id ve entryCss zip giriş yolu üretiminde kullanılır → katı doğrulama (path traversal yok).
"""

import json
import re
from pathlib import Path

THEMES_ROOT = Path(__file__).resolve().parent.parent / "themes"
_REQUIRED = ("id", "name", "author", "version", "entryCss")
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_ENTRY_RE = re.compile(r"^[a-z0-9][a-z0-9.-]*$")


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
        out.append(data)
    return out


def get_theme(theme_id: str, root: Path | None = None) -> dict:
    for t in list_themes(root):
        if t["id"] == theme_id:
            return t
    raise ValueError(f"tema bulunamadı: {theme_id}")
