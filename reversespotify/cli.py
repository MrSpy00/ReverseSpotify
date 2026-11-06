"""reverse-spotify CLI: install · restore · status · themes."""

import argparse
import json
import re
import sys
from pathlib import Path

from . import config, patch, plugins_cmd, process, spa, themes_cmd, watch

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


def _repack(apps: Path, set_theme=_UNSET, set_plugins=_UNSET, cfg_update=_UNSET) -> None:
    """Tek repack akışı: pristine yakala → enjekte et → config/tema/plugin yaz → marker tazele.

    install, themes set ve plugins komutları bu fonksiyonu paylaşır; pristine asla ezilmez.
    ValueError → yürüteci `_repack_cli` yakalar (temiz hata, asla traceback).
    """
    spa_path = apps / "xpui.spa"

    entries = spa.read_spa(spa_path)
    html = entries["index.html"].decode("utf-8")

    # pristine: yalnız ilk sefer alınır (pre-repack baytları), asla ezilmez;
    # modlu bayt asla pristine olarak kaydedilemez — aksi halde restore
    # modlu bayta döner ve vanilla hiçbir yoldan kurtarılamaz
    backup = config.data_root() / "Backup"
    backup.mkdir(parents=True, exist_ok=True)
    pristine = backup / "xpui.spa.pristine"
    if not pristine.exists():
        if patch.has_loader(html):
            raise ValueError(
                "pristine yedek yok ve mevcut spa modlu görünüyor — pristine kaynağı doğrulanamadı"
            )
        pristine.write_bytes(spa_path.read_bytes())

    entries["index.html"] = patch.inject_loader(html).encode("utf-8")
    entries["reverse-loader.js"] = LOADER_SOURCE.read_bytes()

    cfg = _load_cfg(entries)
    if set_theme is not _UNSET:
        cfg["theme"] = set_theme
    if set_plugins is not _UNSET:
        cfg["plugins"] = set_plugins
    if cfg_update is not _UNSET:
        cfg.update(cfg_update)

    # tema CSS'lerini + manifest'te deklare edilmiş varlıkları (arkaplan) paketle;
    # diskte olmayan eski reverse/themes/* girişlerini at
    wanted = set()
    theme_list = themes_cmd.list_themes()
    for th in theme_list:
        src = THEMES_ROOT / th["id"] / th["entryCss"]
        if not src.exists():
            raise ValueError(f"tema css eksik: {src}")
        entry = f"reverse/themes/{th['id']}/{th['entryCss']}"
        wanted.add(entry)
        entries[entry] = src.read_bytes()
        for key in ("background", "backgroundVideo"):
            if key in th:
                asset = THEMES_ROOT / th["id"] / th[key]  # varlık doğrulaması themes_cmd'de
                entry_a = f"reverse/themes/{th['id']}/{th[key]}"
                wanted.add(entry_a)
                entries[entry_a] = asset.read_bytes()
        mf = THEMES_ROOT / th["id"] / "manifest.json"  # runtime manifest fetch (swatch/bg)
        entry_m = f"reverse/themes/{th['id']}/manifest.json"
        wanted.add(entry_m)
        entries[entry_m] = mf.read_bytes()
    for stale in [k for k in entries if k.startswith("reverse/themes/") and k not in wanted]:
        del entries[stale]

    # panel tarayıcıdan tema listesini/önizlemesini bu alandan okur (config write'dan önce)
    cfg["themes"] = sorted(t["id"] for t in theme_list)
    cfg["themeMeta"] = {
        t["id"]: {
            k: t[k]
            for k in ("name", "swatch", "background", "backgroundVideo")
            if k in t
        }
        for t in theme_list
    }
    cfg["repo"] = config.PROJECT_REPO
    # panel ayak linkleri — loader'da URL hardcoded değil, hebi config'ten
    cfg["links"] = {
        "repo": config.PROJECT_REPO,
        "site": config.SITE_URL,
        "author": config.AUTHOR_URL,
    }
    # eski entry'lerde eksik alanları tamamla (panel: depo linki + ad/sınıf/açıklama/ayarlar;
    # manifest tek kaynak — config mutation değil meta taşır)
    repo_metas = {m["id"]: m for m in plugins_cmd.list_repo_plugins()}
    for entry_p in cfg["plugins"]:
        if not (isinstance(entry_p, dict) and entry_p.get("id")):
            continue
        if not entry_p.get("repo"):
            url = plugins_cmd.registry_url(entry_p["id"])
            if url:
                entry_p["repo"] = url
        m = repo_metas.get(entry_p["id"])
        if m:
            for k in ("name", "perfClass", "description", "settings"):
                if k in m:
                    entry_p[k] = m[k]
    entries["reverse/config.json"] = json.dumps(cfg).encode("utf-8")

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
    marker.write_text(
        json.dumps({"hash": spa.spa_hash(spa_path), "version": watch.spotify_version(apps)}),
        encoding="utf-8",
    )


def _repack_cli(apps: Path, **kw) -> bool:
    """_repack yürüteci: ValueError → temiz hata mesajı (traceback yok)."""
    try:
        _repack(apps, **kw)
        return True
    except ValueError as exc:
        print(f"hata: {exc}")
        return False


def _restart_spotify(apps: Path, was_running: bool) -> None:
    """Kullanıcı Spotify'ı kapalı bıraktıysa app'i zorla açma (gece sürprizi yok)."""
    if was_running:
        process.start_spotify(apps.parent / "Spotify.exe")
    else:
        print("not: Spotify kapalıydı, başlatılmadı")


def cmd_install(args: argparse.Namespace) -> int:
    was_running = process.spotify_running()
    _ensure_spotify_closed(args.yes)

    apps = config.spotify_apps_dir(args.spotify_dir)
    if not (apps / "xpui.spa").exists():
        print(f"hata: {apps / 'xpui.spa'} bulunamadı")
        return 1

    if not _repack_cli(apps):
        return 1
    _restart_spotify(apps, was_running)
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
    try:
        installed_hash = json.loads(marker.read_text(encoding="utf-8"))["hash"]
    except (json.JSONDecodeError, UnicodeDecodeError, KeyError, TypeError):
        print("durum: bozuk (kurulum marker'ı bozuk)")
        return 1
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
    mode, count = _adblock_info(entries)
    print(f"adblock: {mode} ({count} seçik)")
    return 0


def _adblock_info(entries: dict[str, bytes] | None = None) -> tuple[str, int]:
    """spa içindeki loader'dan (yoksa repo loader'ından) adblock modu/sezik sayisi.

    Repo loader'ı git pull ile değişmiş olsa bile durum, çalışan spa'yı raporlamalı.
    """
    if entries and "reverse-loader.js" in entries:
        src = entries["reverse-loader.js"].decode("utf-8", errors="replace")
    else:
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
    was_running = process.spotify_running()
    _ensure_spotify_closed(args.yes)

    apps = config.spotify_apps_dir(args.spotify_dir)
    if not (apps / "xpui.spa").exists():
        print(f"hata: {apps / 'xpui.spa'} bulunamadı")
        return 1
    if not _repack_cli(apps, set_theme=args.theme_id):
        return 1
    _restart_spotify(apps, was_running)
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
    # paneldeki depo linki: registry id eşleşmesi, yoksa doğrudan github ref'i
    repo = plugins_cmd.registry_url(pid)
    if not repo and args.ref.startswith("https://github.com/"):
        repo = args.ref.rstrip("/").removesuffix(".git")
    new_entry = {
        "id": pid,
        "enabled": True,
        "entry": info["manifest"]["entry"],
        "permissions": info["manifest"]["permissions"],
    }
    if repo:
        new_entry["repo"] = repo
    new_list = rest + [new_entry]
    # her ekleme (ilk kur + --force) auto-disable kaydını temizlesin: rs:disabled'ta
    # eski kırık kayıt varsa plugin kurulur kurulmaz ölü kalırdı
    entry_name = f"plugin:{pid}"
    old_reset = cfg.get("resetDisabled")
    old_reset = [n for n in old_reset if isinstance(n, str)] if isinstance(old_reset, list) else []
    cfg_update = {"resetDisabled": [n for n in old_reset if n != entry_name] + [entry_name]}
    was_running = process.spotify_running()
    _ensure_spotify_closed(args.yes)
    if not _repack_cli(apps, set_plugins=new_list, cfg_update=cfg_update):
        return 1
    _restart_spotify(apps, was_running)
    print(f"plugin eklendi: {pid}")
    return 0


def _plugins_mutate(args: argparse.Namespace, mutate) -> int:
    """mutate(cfg) → (yeni plugins listesi, cfg_update dict|None); ValueError → hata + exit 1."""
    apps = config.spotify_apps_dir(args.spotify_dir)
    if not (apps / "xpui.spa").exists():
        print(f"hata: {apps / 'xpui.spa'} bulunamadı")
        return 1
    try:
        cfg = _read_cfg(apps)
        new_list, cfg_update = mutate(cfg)
    except ValueError as exc:
        print(f"hata: {exc}")
        return 1
    was_running = process.spotify_running()
    _ensure_spotify_closed(args.yes)
    if not _repack_cli(apps, set_plugins=new_list, cfg_update=cfg_update or {}):
        return 1
    _restart_spotify(apps, was_running)
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
        return out, None

    return _plugins_mutate(args, mutate)


def cmd_plugins_disable(args: argparse.Namespace) -> int:
    def mutate(cfg):
        i = _find_pid(cfg, args.id)
        out = [dict(p) for p in cfg["plugins"]]
        out[i]["enabled"] = False
        print(f"plugin pasif: {args.id}")
        return out, None

    return _plugins_mutate(args, mutate)


def cmd_plugins_enable(args: argparse.Namespace) -> int:
    def mutate(cfg):
        i = _find_pid(cfg, args.id)
        out = [dict(p) for p in cfg["plugins"]]
        out[i]["enabled"] = True
        # enable = auto-disable kaydını config'e yaz: loader boot'ta rs:disabled'tan pop eder
        entry_name = f"plugin:{args.id}"
        old = cfg.get("resetDisabled")
        old = [n for n in old if isinstance(n, str)] if isinstance(old, list) else []
        cfg_update = {"resetDisabled": [n for n in old if n != entry_name] + [entry_name]}
        print(f"plugin aktif: {args.id}")
        return out, cfg_update

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

    p = sub.add_parser("watch")
    p.add_argument("--spotify-dir", default=None)
    p.add_argument("--once", action="store_true")  # tek kontrol (varsayılan davranış)
    p.add_argument("--install-task", action="store_true")
    p.set_defaults(func=cmd_watch)

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


def cmd_watch(args: argparse.Namespace) -> int:
    if getattr(args, "install_task", False):
        return cmd_watch_install_task()
    _write_watch_bat()  # repo/python taşındıysa elle çalışan her watch bat'ı onarır
    result = watch.check_and_heal(args.spotify_dir)
    print(f"watch: {result}")
    return {"ok": 0, "healed": 0, "vanilla": 2, "broken": 1}[result]


def _write_watch_bat() -> Path:
    """Yol bağımsız planlayıcı wrapper'ı: yollar runtime'da çözülür, her çağrıda tazelenir."""
    root = Path(__file__).resolve().parent.parent
    py = sys.executable
    bat = config.data_root() / "watch-once.bat"
    bat.parent.mkdir(parents=True, exist_ok=True)
    bat.write_text(
        f'@echo off\r\ncd /d "{root}"\r\n"{py}" -m reversespotify watch --once\r\n',
        encoding="utf-8",
    )
    return bat


def cmd_watch_install_task() -> int:
    """Planlayıcı görevlerini kur/ yenile (schtasks tek görevde çift trigger desteklemez)."""
    import subprocess

    bat = _write_watch_bat()
    ok = True
    for name, *sched in (
        ("ReverseSpotifyHeal", "/SC", "ONLOGON"),
        ("ReverseSpotifyHealDaily", "/SC", "DAILY", "/ST", "13:00"),
    ):
        r = subprocess.run(
            ["schtasks", "/Create", "/TN", name, "/TR", f'"{bat}"', *sched, "/F"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if r.returncode != 0:
            print(f"hata: {name}: {(r.stderr or r.stdout).strip()}")
            ok = False
    if not ok:
        return 1
    print("görev kuruldu: ReverseSpotifyHeal (logon + günlük)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
