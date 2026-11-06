"""reverse-spotify CLI: install · restore · status · themes."""

import argparse
import json
import sys
from pathlib import Path

from . import config, patch, process, spa, themes_cmd

LOADER_SOURCE = Path(__file__).resolve().parent.parent / "loader" / "reverse-loader.js"
THEMES_ROOT = themes_cmd.THEMES_ROOT

_UNSET = object()


def _ensure_spotify_closed(yes: bool) -> None:
    if not process.spotify_running():
        return
    if not yes:
        try:
            answer = input("Spotify çalışıyor, kapatılsın mı? [y/N] ")
        except EOFError:
            answer = ""
        if answer.strip().lower() not in ("y", "e"):
            print("iptal: Spotify açık")
            raise SystemExit(1)
    if not process.wait_for_spotify_exit(30):
        process.kill_spotify()
        if not process.wait_for_spotify_exit(10):
            print("hata: Spotify kapatılamadı")
            raise SystemExit(1)


def _marker_path() -> Path:
    return config.data_root() / "data" / "reverse.json"


def _repack(apps: Path, set_theme=_UNSET) -> None:
    """Tek repack akışı: pristine yakala → enjekte et → config/temaları yaz → marker tazele.

    install ve themes set bu fonksiyonu paylaşır; pristine asla ezilmez.
    """
    spa_path = apps / "xpui.spa"

    # pristine: yalnız ilk sefer alınır (pre-repack baytları), asla ezilmez
    backup = config.data_root() / "Backup"
    backup.mkdir(parents=True, exist_ok=True)
    pristine = backup / "xpui.spa.pristine"
    if not pristine.exists():
        pristine.write_bytes(spa_path.read_bytes())

    entries = spa.read_spa(spa_path)
    html = entries["index.html"].decode("utf-8")
    entries["index.html"] = patch.inject_loader(html).encode("utf-8")
    entries["reverse-loader.js"] = LOADER_SOURCE.read_bytes()

    cfg = {"theme": None, "plugins": []}
    if "reverse/config.json" in entries:
        try:
            parsed = json.loads(entries["reverse/config.json"])
            if isinstance(parsed, dict):
                cfg = {**cfg, **parsed}
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass  # bozuk config → varsayılana düş
    if set_theme is not _UNSET:
        cfg["theme"] = set_theme
    entries["reverse/config.json"] = json.dumps(cfg).encode("utf-8")

    # tema CSS'lerini paketle; diskte olmayan eski reverse/themes/* girişlerini at
    wanted = set()
    for th in themes_cmd.list_themes():
        src = THEMES_ROOT / th["id"] / th["entryCss"]
        if not src.exists():
            raise ValueError(f"tema css eksik: {src}")
        entry = f"reverse/themes/{th['id']}/{th['entryCss']}"
        wanted.add(entry)
        entries[entry] = src.read_bytes()
    for stale in [k for k in entries if k.startswith("reverse/themes/") and k not in wanted]:
        del entries[stale]

    spa.write_spa(entries, spa_path)

    marker = _marker_path()
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(json.dumps({"hash": spa.spa_hash(spa_path)}), encoding="utf-8")


def cmd_install(args: argparse.Namespace) -> int:
    _ensure_spotify_closed(args.yes)

    apps = config.spotify_apps_dir(args.spotify_dir)
    if not (apps / "xpui.spa").exists():
        print(f"hata: {apps / 'xpui.spa'} bulunamadı")
        return 1

    _repack(apps)
    process.start_spotify(apps.parent / "Spotify.exe")
    print("kurulum tamam")
    return cmd_status(args)


def cmd_restore(args: argparse.Namespace) -> int:
    pristine = config.data_root() / "Backup" / "xpui.spa.pristine"
    if not pristine.exists():
        print("hata: pristine yedek yok — restore mümkün değil")
        return 1
    _ensure_spotify_closed(args.yes)

    apps = config.spotify_apps_dir(args.spotify_dir)
    spa_path = apps / "xpui.spa"
    if not spa_path.exists():
        print(f"hata: {spa_path} bulunamadı")
        return 1
    spa_path.write_bytes(pristine.read_bytes())
    _marker_path().unlink(missing_ok=True)
    print("restore tamam (bayt-tamam)")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    apps = config.spotify_apps_dir(args.spotify_dir)
    spa_path = apps / "xpui.spa"
    if not spa_path.exists():
        print("durum: bozuk (spa yok)")
        return 1
    try:
        entries = spa.read_spa(spa_path)
        html = entries["index.html"].decode("utf-8")
    except Exception as exc:  # noqa: BLE001 — bozuk zip durum raporu
        print(f"durum: bozuk ({exc})")
        return 1

    if not patch.has_loader(html):
        print("durum: vanilla")
        return 2
    if not (config.data_root() / "Backup" / "xpui.spa.pristine").exists():
        print("durum: bozuk (pristine yedek eksik)")
        return 1

    marker = _marker_path()
    if not marker.exists():
        print("durum: bozuk (kurulum marker'ı eksik)")
        return 1
    installed_hash = json.loads(marker.read_text(encoding="utf-8"))["hash"]
    if installed_hash != spa.spa_hash(spa_path):
        print("durum: bozuk (hash uyuşmazlığı — spa değişmiş)")
        return 1
    print("durum: modded — sağlıklı")
    return 0


def cmd_themes_list(args: argparse.Namespace) -> int:
    try:
        themes = themes_cmd.list_themes()
    except ValueError as exc:
        print(f"hata: {exc}")
        return 1
    for t in themes:
        print(f"{t['id']:<14} {t['name']}  (v{t['version']}, {t['author']})")
    return 0


def cmd_themes_set(args: argparse.Namespace) -> int:
    try:
        themes_cmd.get_theme(args.theme_id)
    except ValueError as exc:
        print(f"hata: {exc}")
        return 1
    _ensure_spotify_closed(args.yes)

    apps = config.spotify_apps_dir(args.spotify_dir)
    if not (apps / "xpui.spa").exists():
        print(f"hata: {apps / 'xpui.spa'} bulunamadı")
        return 1
    _repack(apps, set_theme=args.theme_id)
    process.start_spotify(apps.parent / "Spotify.exe")
    print(f"tema: {args.theme_id}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="reverse-spotify")
    sub = parser.add_subparsers(dest="cmd", required=True)

    def add(name, func):
        p = sub.add_parser(name)
        p.add_argument("--spotify-dir", default=None)
        p.add_argument("--yes", action="store_true")
        p.set_defaults(func=func)
        return p

    add("install", cmd_install)
    add("restore", cmd_restore)
    p = sub.add_parser("status")
    p.add_argument("--spotify-dir", default=None)
    p.add_argument("--check", action="store_true")
    p.set_defaults(func=cmd_status)

    # bayraklar yalnızca leaf parser'da: parent'ta olsaydı set'in varsayılanı
    # parent'taki değeri clobber ederdi (argparse nested dest klasik tuzağı)
    p = sub.add_parser("themes")
    tsub = p.add_subparsers(dest="themes_cmd", required=True)
    tsub.add_parser("list").set_defaults(func=cmd_themes_list)
    ps = tsub.add_parser("set")
    ps.add_argument("theme_id")
    ps.add_argument("--spotify-dir", default=None)
    ps.add_argument("--yes", action="store_true")
    ps.set_defaults(func=cmd_themes_set)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
