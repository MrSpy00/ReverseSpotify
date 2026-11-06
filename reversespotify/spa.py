"""xpui.spa (standart ZIP) okuma/yazma/hash yardımcıları."""

import hashlib
import zipfile
from pathlib import Path


def read_spa(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as zf:
        return {info.filename: zf.read(info.filename) for info in zf.infolist() if not info.is_dir()}


def write_spa(entries: dict[str, bytes], path: Path) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    tmp.replace(path)


def spa_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
