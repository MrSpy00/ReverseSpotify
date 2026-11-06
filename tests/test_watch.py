import json

from reversespotify import cli, config, patch, spa, watch

FIXTURE_INDEX = "tests/fixtures/index.html"


def _install(apps):
    return cli.main(["install", "--spotify-dir", str(apps), "--yes"])


def _marker():
    return config.data_root() / "data" / "reverse.json"


def _vanilla_entries():
    from pathlib import Path

    return {"index.html": Path(FIXTURE_INDEX).read_bytes(), "xpui-snapshot.js": b"/*js*/"}


def test_heal_reinjects_when_hash_drifted(fake_apps):
    assert _install(fake_apps) == 0
    spa_path = fake_apps / "xpui.spa"

    # dışarıdan değişiklik (güncelleme/başka araç simülasyonu) → hash drift
    entries = spa.read_spa(spa_path)
    entries["xpui-snapshot.js"] = b"/*disaridan degisti*/"
    spa.write_spa(entries, spa_path)

    assert watch.check_and_heal(str(fake_apps)) == "healed"
    entries = spa.read_spa(spa_path)
    assert patch.has_loader(entries["index.html"].decode("utf-8"))
    assert json.loads(_marker().read_text(encoding="utf-8"))["hash"] == spa.spa_hash(spa_path)


def test_pristine_versioned_backup_on_upgrade(fake_apps):
    assert _install(fake_apps) == 0
    spa_path = fake_apps / "xpui.spa"
    unversioned_before = (config.data_root() / "Backup" / "xpui.spa.pristine").read_bytes()

    # yeni sürüm prefs'u + spa'nın güncellemeyle vanilla'ya dönmesi
    users = fake_apps.parent / "Users" / "u1"
    users.mkdir(parents=True)
    (users / "prefs").write_text(
        'app.last-launched-version="1.3.9.999.test"\n', encoding="utf-8"
    )
    spa.write_spa(_vanilla_entries(), spa_path)
    vanilla_bytes = spa_path.read_bytes()  # heal öncesi vanilla baytları

    assert watch.check_and_heal(str(fake_apps)) == "healed"
    versioned = config.data_root() / "Backup" / "xpui.spa.pristine.1.3.9.999.test"
    assert versioned.exists(), "yeni sürüm pristine'i ayrı dosyada korunmalı"
    assert versioned.read_bytes() == vanilla_bytes  # vanilla bayt korundu
    # eski pristine EZİLMEDİ (Global Constraint)
    assert (config.data_root() / "Backup" / "xpui.spa.pristine").read_bytes() == unversioned_before
    # marker sürümü tazelendi
    assert json.loads(_marker().read_text(encoding="utf-8"))["version"] == "1.3.9.999.test"


def test_vanilla_left_alone(fake_apps):
    spa_path = fake_apps / "xpui.spa"
    before = spa.spa_hash(spa_path)
    assert watch.check_and_heal(str(fake_apps)) == "vanilla"
    assert spa.spa_hash(spa_path) == before  # sessiz: dokunulmadı
    assert not _marker().exists()


def test_watch_cli_exit_codes(fake_apps):
    # vanilla → 2
    assert cli.main(["watch", "--spotify-dir", str(fake_apps)]) == 2
    # modded-sağlıklı → 0
    _install(fake_apps)
    assert cli.main(["watch", "--spotify-dir", str(fake_apps)]) == 0
