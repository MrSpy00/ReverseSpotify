import json

import pytest

from reversespotify import cli, patch, spa, themes_cmd


def test_themes_set_updates_config_and_repacks(fake_apps):
    assert cli.main(["install", "--spotify-dir", str(fake_apps), "--yes"]) == 0

    assert cli.main(["themes", "set", "amoled", "--spotify-dir", str(fake_apps), "--yes"]) == 0

    entries = spa.read_spa(fake_apps / "xpui.spa")
    cfg = json.loads(entries["reverse/config.json"])
    assert cfg["theme"] == "amoled"
    assert cfg["plugins"] == []
    assert "reverse/themes/amoled/theme.css" in entries
    assert "reverse/themes/clean-dark/theme.css" in entries
    assert patch.has_loader(entries["index.html"].decode())
    assert cli.main(["status", "--spotify-dir", str(fake_apps)]) == 0


def test_themes_list_builtin():
    ids = [t["id"] for t in themes_cmd.list_themes()]
    assert "clean-dark" in ids
    assert "amoled" in ids


def test_themes_set_unknown_theme_fails(fake_apps):
    assert cli.main(["install", "--spotify-dir", str(fake_apps), "--yes"]) == 0
    rc = cli.main(["themes", "set", "yok-boyle-tema", "--spotify-dir", str(fake_apps), "--yes"])
    assert rc == 1


def test_invalid_manifest_raises_valueerror(tmp_path):
    root = tmp_path / "themes"
    (root / "bad").mkdir(parents=True)
    (root / "bad" / "manifest.json").write_text("{bozuk", encoding="utf-8")
    with pytest.raises(ValueError, match="manifest"):
        themes_cmd.list_themes(root)

    (root / "bad" / "manifest.json").write_text(json.dumps({"id": "bad"}), encoding="utf-8")
    with pytest.raises(ValueError, match="manifest"):
        themes_cmd.list_themes(root)


def test_theme_id_path_traversal_rejected(tmp_path):
    root = tmp_path / "themes"
    (root / "evil").mkdir(parents=True)
    (root / "evil" / "manifest.json").write_text(
        json.dumps(
            {"id": "../evil", "name": "x", "author": "y", "version": "1", "entryCss": "theme.css"}
        ),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="manifest"):
        themes_cmd.list_themes(root)


def test_entry_css_path_traversal_rejected(tmp_path):
    root = tmp_path / "themes"
    (root / "evil").mkdir(parents=True)
    (root / "evil" / "manifest.json").write_text(
        json.dumps(
            {"id": "evil", "name": "x", "author": "y", "version": "1", "entryCss": "../../index.html"}
        ),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="manifest"):
        themes_cmd.list_themes(root)
