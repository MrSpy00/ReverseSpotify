import json

import pytest

from reversespotify import cli, config, patch, process, spa

FIXTURE_INDEX = "tests/fixtures/index.html"


@pytest.fixture
def fake_apps(tmp_path, monkeypatch):
    """Sahte Apps dizini + sahte xpui.spa; data_root izole edilir."""
    monkeypatch.setenv("REVERSESPOTIFY_HOME", str(tmp_path / "RShome"))
    monkeypatch.setattr(process, "spotify_running", lambda: False)

    apps = tmp_path / "Apps"
    apps.mkdir()
    index = open(FIXTURE_INDEX, "rb").read()
    spa.write_spa({"index.html": index, "xpui-snapshot.js": b"/*js*/"}, apps / "xpui.spa")
    return apps


def _install(apps, extra=()):
    return cli.main(["install", "--spotify-dir", str(apps), "--yes", *extra])


def test_install_uses_backup_and_patches(fake_apps):
    pristine = config.data_root() / "Backup" / "xpui.spa.pristine"
    before = spa.spa_hash(fake_apps / "xpui.spa")

    assert _install(fake_apps) == 0
    entries = spa.read_spa(fake_apps / "xpui.spa")
    assert patch.has_loader(entries["index.html"].decode())
    assert "reverse-loader.js" in entries
    assert json.loads(entries["reverse/config.json"]) == {"theme": None, "plugins": []}
    assert pristine.exists()
    assert spa.spa_hash(pristine) == before  # pristine orijinal baytlardır

    # ikinci install pristine'i EZMEZ (idempotent + asla ezme kuralı)
    _install(fake_apps)
    assert spa.spa_hash(pristine) == before


def test_restore_returns_bit_identical(fake_apps):
    before = spa.spa_hash(fake_apps / "xpui.spa")
    _install(fake_apps)
    assert cli.main(["status", "--spotify-dir", str(fake_apps)]) == 0

    assert cli.main(["restore", "--spotify-dir", str(fake_apps)]) == 0
    assert spa.spa_hash(fake_apps / "xpui.spa") == before
    assert cli.main(["status", "--spotify-dir", str(fake_apps)]) == 2


def test_status_codes(fake_apps):
    assert cli.main(["status", "--spotify-dir", str(fake_apps)]) == 2  # vanilla
    _install(fake_apps)
    assert cli.main(["status", "--spotify-dir", str(fake_apps)]) == 0

    # hash marker bozulursa -> bozuk (1)
    marker = config.data_root() / "data" / "reverse.json"
    marker.write_text(json.dumps({"hash": "0" * 64}), encoding="utf-8")
    assert cli.main(["status", "--spotify-dir", str(fake_apps)]) == 1


def test_install_kills_spotify_when_yes_and_still_running(monkeypatch):
    calls = {"kill": 0}
    monkeypatch.setattr(process, "spotify_running", lambda: True)
    monkeypatch.setattr(process, "wait_for_spotify_exit", lambda timeout=30: False)

    def kill():
        calls["kill"] += 1

    monkeypatch.setattr(process, "kill_spotify", kill)

    with pytest.raises(SystemExit) as e:
        cli.main(["install", "--spotify-dir", "C:/nonexistent", "--yes"])
    assert e.value.code == 1
    assert calls["kill"] == 1  # --yes: prompt yok, kill politikası
