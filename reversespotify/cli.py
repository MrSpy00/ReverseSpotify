"""reverse-spotify CLI: install · restore · status · themes."""

import argparse
import json
import re
import sys
from pathlib import Path

from . import config, patch, plugins_cmd, process, spa, themes_cmd

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


def _load_cfg(entries: dict[str, bytes]) -> dict:
    cfg = {"theme": None, "plugins": []}
    if "reverse/config.json" in entries:
        try:
            parsed = json.loads(entries["reverse/config.json"])
            if isinstance(parsed, dict):
                cfg = {**cfg, **parsed}
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass  # bozuk config → varsayılana düş
    cfg.setdefault("theme", None)
    cfg.setdefault("plugins", [])
    if not isinstance(cfg["plugins"], list):
        cfg["plugins"] = []
    return cfg


def _repack(apps: Path, set_theme=_UNSET, set_plugins=_UNSET) -> None:
    """Tek repack akışı: pristine yakala → enjekte et → config/tema/plugin yaz → marker tazele.

    install, themes set ve plugins komutları bu fonksiyonu paylaşır; pristine asla ezilmez.
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

    cfg = _load_cfg(entries)
    if set_theme is not _UNSET:
        cfg["theme"] = set_theme
    if set_plugins is not _UNSET:
        cfg["plugins"] = set_plugins
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

    # plugin girişlerini paketle (config'teki id/entry üzerinden); bayatları at
    for p in cfg["plugins"]:
        if not isinstance(p, dict) or not isinstance(p.get("id"), str):
            continue
        entry = f"reverse/plugins/{p['id']}/{p.get('entry', 'index.js')}"
        src = plugins_cmd.plugins_root() / p["id"] / p.get("entry", "index.js")
        if src.exists():
            wanted.add(entry)
            entries[entry] = src.read_bytes()
    for stale in [k for k in entries if k.startswith("reverse/plugins/") and k not in wanted]:
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
    cfg = _load_cfg(entries)
    if cfg["theme"]:
        print(f"tema: {cfg['theme']}")
    for p in cfg["plugins"]:
        if isinstance(p, dict) and "id" in p:
            state = "aktif" if p.get("enabled", True) else "pasif"
            print(f"plugin: {p['id']} ({state})")
    mode, count = _adblock_info()
    print(f"adblock: {mode} ({count} seçik)")
    return 0


def _adblock_info() -> tuple[str, int]:
    """loader kaynağından adblock modu ve seçik sayısını oku (dürüst statik rapor)."""
    loader = Path(__file__).resolve().parent.parent / "loader" / "reverse-loader.js"
    src = loader.read_text(encoding="utf-8")
    mode_m = re.search(r'ADBLOCK_MODE = "([^"]+)"', src)
    block_m = re.search(r"ADBLOCK_SELECTORS = \[(.*?)\]", src, re.S)
    count = len(re.findall(r'"[^"]+"', block_m.group(1))) if block_m else 0
    return (mode_m.group(1) if mode_m else "?"), count


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


def _read_cfg(apps: Path) -> dict:
    return _load_cfg(spa.read_spa(apps / "xpui.spa"))


def cmd_plugins_list(args: argparse.Namespace) -> int:
    apps = config.spotify_apps_dir(args.spotify_dir)
    installed: dict[str, dict] = {}
    if (apps / "xpui.spa").exists():
        try:
            for p in _read_cfg(apps)["plugins"]:
                if isinstance(p, dict) and "id" in p:
                    installed[p["id"]] = p
        except Exception:  # noqa: BLE001 — bozuk config listeyi düşürmesin
            pass
    seen = set()
    for mf in plugins_cmd.list_repo_plugins():
        seen.add(mf["id"])
        p = installed.get(mf["id"])
        if p is None:
            state = "kurulu degil"
        else:
            state = "aktif" if p.get("enabled", True) else "pasif"
        print(f"{mf['id']:<16} [{state}]  {mf['name']} ({mf['perfClass']})")
    for pid, p in installed.items():
        if pid not in seen:
            state = "aktif" if p.get("enabled", True) else "pasif"
            print(f"{pid:<16} [{state}]  (kaynak dizini yok)")
    print(
        "not: çalışma zamanı devre-dışı kayıtları tarayıcıdadır "
        "(localStorage rs:disabled/rs:error, konsol: [ReverseSpotify])"
    )
    return 0


def cmd_plugins_add(args: argparse.Namespace) -> int:
    try:
        info = plugins_cmd.resolve_add(args.ref)
        violations = plugins_cmd.lint_bytes(info["src"])
        if violations:
            print("lint RED (hard-fail, --force bile geçemez):")
            for v in violations:
                print(f"  - {v}")
            return 1
    except ValueError as exc:
        print(f"hata: {exc}")
        return 1

    apps = config.spotify_apps_dir(args.spotify_dir)
    if not (apps / "xpui.spa").exists():
        print(f"hata: {apps / 'xpui.spa'} bulunamadı")
        return 1
    cfg = _read_cfg(apps)
    pid = info["manifest"]["id"]
    exists = any(isinstance(p, dict) and p.get("id") == pid for p in cfg["plugins"])
    if exists and not args.force:
        print(f"hata: {pid} zaten kurulu (yeniden kurmak için --force)")
        return 1

    if not info.get("local"):
        plugins_cmd.save_plugin(info["manifest"], info["src"])
    rest = [p for p in cfg["plugins"] if not (isinstance(p, dict) and p.get("id") == pid)]
    new_list = rest + [
        {
            "id": pid,
            "enabled": True,
            "entry": info["manifest"]["entry"],
            "permissions": info["manifest"]["permissions"],
        }
    ]
    _ensure_spotify_closed(args.yes)
    _repack(apps, set_plugins=new_list)
    process.start_spotify(apps.parent / "Spotify.exe")
    print(f"plugin eklendi: {pid}")
    return 0


def _plugins_mutate(args: argparse.Namespace, mutate) -> int:
    """mutate(cfg) → yeni plugins listesi döndürür; ValueError → hata mesajı + exit 1."""
    apps = config.spotify_apps_dir(args.spotify_dir)
    if not (apps / "xpui.spa").exists():
        print(f"hata: {apps / 'xpui.spa'} bulunamadı")
        return 1
    try:
        cfg = _read_cfg(apps)
        new_list = mutate(cfg)
    except ValueError as exc:
        print(f"hata: {exc}")
        return 1
    _ensure_spotify_closed(args.yes)
    _repack(apps, set_plugins=new_list)
    process.start_spotify(apps.parent / "Spotify.exe")
    return 0


def _find_pid(cfg, pid):
    for i, p in enumerate(cfg["plugins"]):
        if isinstance(p, dict) and p.get("id") == pid:
            return i
    raise ValueError(f"plugin kurulu değil: {pid}")


def cmd_plugins_remove(args: argparse.Namespace) -> int:
    def mutate(cfg):
        i = _find_pid(cfg, args.id)
        out = list(cfg["plugins"])
        out.pop(i)
        print(f"plugin kaldırıldı: {args.id}")
        return out

    return _plugins_mutate(args, mutate)


def cmd_plugins_disable(args: argparse.Namespace) -> int:
    def mutate(cfg):
        i = _find_pid(cfg, args.id)
        out = [dict(p) for p in cfg["plugins"]]
        out[i]["enabled"] = False
        print(f"plugin pasif: {args.id}")
        return out

    return _plugins_mutate(args, mutate)


def cmd_plugins_enable(args: argparse.Namespace) -> int:
    def mutate(cfg):
        i = _find_pid(cfg, args.id)
        out = [dict(p) for p in cfg["plugins"]]
        out[i]["enabled"] = True
        print(f"plugin aktif: {args.id}")
        return out

    return _plugins_mutate(args, mutate)


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

    p = sub.add_parser("plugins")
    plsub = p.add_subparsers(dest="plugins_cmd", required=True)
    pl = plsub.add_parser("list")
    pl.add_argument("--spotify-dir", default=None)
    pl.set_defaults(func=cmd_plugins_list)
    pa = plsub.add_parser("add")
    pa.add_argument("ref")
    pa.add_argument("--force", action="store_true")
    pa.add_argument("--spotify-dir", default=None)
    pa.add_argument("--yes", action="store_true")
    pa.set_defaults(func=cmd_plugins_add)
    for leaf, fn in (("remove", cmd_plugins_remove), ("enable", cmd_plugins_enable), ("disable", cmd_plugins_disable)):
        plv = plsub.add_parser(leaf)
        plv.add_argument("id")
        plv.add_argument("--spotify-dir", default=None)
        plv.add_argument("--yes", action="store_true")
        plv.set_defaults(func=fn)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
