"""Final review'dan ertelenen minor'lar + panel config desteği — RED→GREEN."""

import json

from reversespotify import cli, config, process, spa, watch
from reversespotify.cli import _adblock_info


def test_status_corrupt_marker_clean_report(fake_apps, capsys):
    assert cli.main(["install", "--yes", "--spotify-dir", str(fake_apps)]) == 0
    marker = config.data_root() / "data" / "reverse.json"
    marker.write_text("{oops", encoding="utf-8")

    rc = cli.main(["status", "--spotify-dir", str(fake_apps)])
    out = capsys.readouterr().out

    assert rc == 1  # traceback yerine temiz "bozuk" raporu
    assert "bozuk" in out


def test_watch_corrupt_marker_heals(fake_apps):
    assert cli.main(["install", "--yes", "--spotify-dir", str(fake_apps)]) == 0
    marker = config.data_root() / "data" / "reverse.json"
    marker.write_text("{oops", encoding="utf-8")

    res = watch.check_and_heal(str(fake_apps))  # JSONDecodeError fırlatmamalı
    assert res == "healed"
    data = json.loads(marker.read_text(encoding="utf-8"))
    assert "hash" in data and "version" in data


def test_adblock_info_reads_spa_entries():
    entries = {
        "reverse-loader.js": (
            b'const ADBLOCK_MODE = "ui+audio";\n'
            b'const ADBLOCK_SELECTORS = ["one", "two"];'
        )
    }
    assert _adblock_info(entries) == ("ui+audio", 2)


def test_install_no_autostart_when_spotify_closed(fake_apps, monkeypatch):
    calls = []
    monkeypatch.setattr(process, "start_spotify", lambda p: calls.append(p) or False)

    rc = cli.main(["install", "--yes", "--spotify-dir", str(fake_apps)])

    assert rc == 0
    assert calls == []  # kullanıcı Spotify'ı kapalı bıraktı → app açılmamalı


def test_install_restarts_when_spotify_was_running(fake_apps, monkeypatch):
    monkeypatch.setattr(process, "spotify_running", lambda: True)
    monkeypatch.setattr(process, "wait_for_spotify_exit", lambda t: True)
    monkeypatch.setattr(process, "kill_spotify", lambda: None)
    calls = []
    monkeypatch.setattr(process, "start_spotify", lambda p: calls.append(p) or False)

    rc = cli.main(["install", "--yes", "--spotify-dir", str(fake_apps)])

    assert rc == 0
    assert len(calls) == 1  # kullanıcıda açıktı → kapanıp geri açılmalı


def test_plugins_list_skips_corrupt_manifest(fake_apps, tmp_path, monkeypatch, capsys):
    proot = tmp_path / "plugins"
    good = proot / "good"
    good.mkdir(parents=True)
    (good / "manifest.json").write_text(
        json.dumps(
            {
                "id": "good",
                "name": "Good",
                "version": "1.0.0",
                "entry": "index.js",
                "permissions": [],
                "perfClass": "light",
            }
        ),
        encoding="utf-8",
    )
    (good / "index.js").write_text("// ok", encoding="utf-8")
    bad = proot / "bad"
    bad.mkdir()
    (bad / "manifest.json").write_text("{not json", encoding="utf-8")
    monkeypatch.setenv("REVERSESPOTIFY_PLUGINS", str(proot))

    rc = cli.main(["plugins", "list", "--spotify-dir", str(fake_apps)])
    out = capsys.readouterr().out

    assert rc == 0  # bozuk manifest traceback değil, uyarı ile atlanır
    assert "good" in out
    assert "uyari" in out


def test_watch_refreshes_wrapper_bat(fake_apps):
    bat = config.data_root() / "watch-once.bat"
    bat.parent.mkdir(parents=True, exist_ok=True)
    bat.write_text("STALE PATH\r\n", encoding="utf-8")

    rc = cli.main(["watch", "--once", "--spotify-dir", str(fake_apps)])  # vanilla → 2
    content = bat.read_text(encoding="utf-8")

    assert rc == 2
    assert "STALE PATH" not in content
    assert "reversespotify watch --once" in content


def test_config_lists_available_themes(fake_apps):
    assert cli.main(["install", "--yes", "--spotify-dir", str(fake_apps)]) == 0
    entries = spa.read_spa(fake_apps / "xpui.spa")
    cfg = json.loads(entries["reverse/config.json"])
    assert cfg.get("themes") == ["amber", "amoled", "clean-dark", "crimson", "forest", "lavender", "nord", "ocean"]
