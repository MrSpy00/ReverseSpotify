"""Plugin keşfi, manifest doğrulama, GitHub fetch ve lint entegrasyonu.

Manifest şeması: {"id","name","version","entry","permissions":["settings"|"ui"],"perfClass"}.
Plugin kökü: repo `plugins/` (override: REVERSESPOTIFY_PLUGINS env).
"""

import json
import os
import re
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

from . import lint

REPO_ROOT = Path(__file__).resolve().parent.parent
PLUGINS_ROOT = REPO_ROOT / "plugins"
REGISTRY_PATH = REPO_ROOT / "registry.json"

_REQUIRED = ("id", "name", "version", "entry", "permissions", "perfClass")
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_ENTRY_RE = re.compile(r"^[a-z0-9][a-z0-9.-]*$")
_GITHUB_RE = re.compile(r"^https://github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?/?$")
_VALID_PERMS = {"settings", "ui"}


def plugins_root() -> Path:
    env = os.environ.get("REVERSESPOTIFY_PLUGINS")
    return Path(env) if env else PLUGINS_ROOT


def validate_manifest(data: object, ctx: str) -> dict:
    if not isinstance(data, dict):
        raise ValueError(f"geçersiz manifest {ctx}: sözlük bekleniyordu")
    missing = [k for k in _REQUIRED if k not in data]
    if missing:
        raise ValueError(f"geçersiz manifest {ctx}: eksik alan {missing}")
    if not isinstance(data["id"], str) or not _ID_RE.match(data["id"]):
        raise ValueError(f"geçersiz manifest {ctx}: id '{data.get('id')}' güvenli değil")
    if not isinstance(data["entry"], str) or not _ENTRY_RE.match(data["entry"]):
        raise ValueError(f"geçersiz manifest {ctx}: entry '{data.get('entry')}' güvenli değil")
    if not isinstance(data["permissions"], list) or not set(data["permissions"]) <= _VALID_PERMS:
        raise ValueError(f"geçersiz manifest {ctx}: permissions yalnız settings|ui olabilir")
    if data["perfClass"] not in ("light", "medium"):
        raise ValueError(f"geçersiz manifest {ctx}: perfClass light|medium olmalı (heavy yasak)")
    return data


def load_plugin_dir(plugin_dir: Path) -> dict:
    mf = plugin_dir / "manifest.json"
    try:
        data = json.loads(mf.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"geçersiz manifest {mf}: {exc}") from exc
    data = validate_manifest(data, str(mf))
    if data["id"] != plugin_dir.name:
        raise ValueError(f"geçersiz manifest {mf}: id dizin adıyla uyuşmuyor")
    entry = plugin_dir / data["entry"]
    if not entry.exists():
        raise ValueError(f"geçersiz manifest {mf}: entry dosyası yok {entry.name}")
    return data


def list_repo_plugins() -> list[dict]:
    root = plugins_root()
    out = []
    if not root.exists():
        return out
    for d in sorted(root.iterdir()):
        if (d / "manifest.json").exists():
            out.append(load_plugin_dir(d))
    return out


def registry_url(ref: str) -> str | None:
    try:
        reg = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    for item in reg.get("plugins", []):
        if item.get("id") == ref:
            return item.get("repo")
    return None


def validate_github_url(url: str) -> str:
    if not _GITHUB_RE.match(url):
        raise ValueError(f"yalnızca https://github.com/owner/repo kabul edilir: {url}")
    return url


def _download_zip(url: str) -> bytes:
    owner, repo = _GITHUB_RE.match(url).groups()
    for branch in ("main", "master"):
        zip_url = f"https://codeload.github.com/{owner}/{repo}/zip/refs/heads/{branch}"
        try:
            with urllib.request.urlopen(zip_url, timeout=30) as resp:
                return resp.read()
        except Exception:  # noqa: BLE001 — şube yok, sonraki dene
            continue
    raise ValueError(f"indirilemedi: {url} (main/master şube bulunamadı)")


def plugin_from_zip(zip_bytes: bytes) -> tuple[dict, bytes]:
    """Zip içinden ilk geçerli (manifest+entry) plugin'i bul → (manifest, entry kaynak)."""
    with zipfile.ZipFile(BytesIO(zip_bytes)) as zf:
        names = [n for n in zf.namelist() if n.endswith("manifest.json")]
        for mf_name in sorted(names):
            try:
                data = json.loads(zf.read(mf_name).decode("utf-8"))
                data = validate_manifest(data, mf_name)
            except (ValueError, UnicodeDecodeError):
                continue
            base = mf_name[: -len("manifest.json")]
            entry_name = base + data["entry"]
            if entry_name in zf.namelist():
                return data, zf.read(entry_name)
    raise ValueError("zip içinde geçerli plugin bulunamadı (manifest+entry)")


def resolve_add(ref: str) -> dict:
    """add hedefini çöz → {"manifest":dict, "src":bytes}. Ulaşılamazsa ValueError."""
    root = plugins_root()

    # 1) yerel plugin (repo plugins/<id>/)
    local = root / ref
    if (local / "manifest.json").exists():
        mf = load_plugin_dir(local)
        return {"manifest": mf, "src": (local / mf["entry"]).read_bytes()}

    # 2) github URL
    if ref.startswith("http"):
        validate_github_url(ref)
        mf, src = plugin_from_zip(_download_zip(ref))
        return {"manifest": mf, "src": src}

    # 3) registry: id -> repo URL
    url = registry_url(ref)
    if url:
        validate_github_url(url)
        mf, src = plugin_from_zip(_download_zip(url))
        return {"manifest": mf, "src": src}

    raise ValueError(f"plugin bulunamadı: {ref} (yerel, github URL veya registry)")


def save_plugin(manifest: dict, src: bytes) -> Path:
    """Plugins köküne yaz (zip'ten gelenler için); indirilmiş kaynak lint'ten geçmiştir."""
    d = plugins_root() / manifest["id"]
    d.mkdir(parents=True, exist_ok=True)
    (d / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (d / manifest["entry"]).write_bytes(src)
    return d


def lint_bytes(src: bytes) -> list[str]:
    try:
        text = src.decode("utf-8")
    except UnicodeDecodeError as exc:
        return [f"lint: UTF-8 değil ({exc})"]
    return lint.lint_source(text)
