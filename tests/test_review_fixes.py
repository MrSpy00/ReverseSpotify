"""Final review Important #1-#2: pristine guard + inject ValueError temiz çıkış + resetDisabled."""

import json

from reversespotify import cli, config, spa, watch


def _install(apps):
    return cli.main(["install", "--spotify-dir", str(apps), "--yes"])


def _add(apps, *extra):
    return cli.main(["plugins", "add", "key-highlight", "--spotify-dir", str(apps), "--yes", *extra])


def test_install_refuses_to_capture_modded_pristine(fake_apps):
    # data root kaybı simülasyonu: pristine silinir, spa hâlâ modludur
    assert _install(fake_apps) == 0
    pristine = config.data_root() / "Backup" / "xpui.spa.pristine"
    pristine.unlink()

    assert _install(fake_apps) == 1  # modlu bayt asla pristine yapılmaz
    assert not pristine.exists()


def test_install_inject_failure_is_clean_exit(fake_apps, capsys):
    assert _install(fake_apps) == 0
    entries = spa.read_spa(fake_apps / "xpui.spa")
    entries["index.html"] = b"<html>enjeksiyon etiketi yok</html>"
    spa.write_spa(entries, fake_apps / "xpui.spa")

    rc = cli.main(["install", "--spotify-dir", str(fake_apps), "--yes"])
    assert rc == 1  # traceback yok, temiz hata
    assert "hata" in capsys.readouterr().out


def test_watch_maps_inject_failure_to_broken(fake_apps):
    assert _install(fake_apps) == 0
    entries = spa.read_spa(fake_apps / "xpui.spa")
    entries["index.html"] = b"<html>enjeksiyon etiketi yok</html>"
    spa.write_spa(entries, fake_apps / "xpui.spa")

    assert watch.check_and_heal(str(fake_apps)) == "broken"


def test_enable_writes_reset_disabled_into_config(fake_apps):
    assert _install(fake_apps) == 0
    assert _add(fake_apps) == 0
    assert cli.main(["plugins", "disable", "key-highlight", "--spotify-dir", str(fake_apps), "--yes"]) == 0
    assert cli.main(["plugins", "enable", "key-highlight", "--spotify-dir", str(fake_apps), "--yes"]) == 0

    cfg = json.loads(spa.read_spa(fake_apps / "xpui.spa")["reverse/config.json"])
    assert "plugin:key-highlight" in cfg.get("resetDisabled", [])


def test_force_readd_writes_reset_disabled(fake_apps):
    assert _install(fake_apps) == 0
    assert _add(fake_apps) == 0
    assert _add(fake_apps, "--force") == 0

    cfg = json.loads(spa.read_spa(fake_apps / "xpui.spa")["reverse/config.json"])
    assert cfg.get("resetDisabled", []).count("plugin:key-highlight") == 1  # tekil
