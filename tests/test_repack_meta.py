"""_repack: themeMeta + repo (tek kaynak) + arkaplan varlıklarının paketlenmesi."""

import json

from reversespotify import cli, spa

REPO = "https://github.com/MrSpy00/ReverseSpotify"


def test_repack_writes_theme_meta_and_repo(fake_apps):
    assert cli.main(["install", "--spotify-dir", str(fake_apps), "--yes"]) == 0

    entries = spa.read_spa(fake_apps / "xpui.spa")
    cfg = json.loads(entries["reverse/config.json"])
    assert cfg["repo"] == REPO
    assert cfg["links"] == {
        "repo": REPO,
        "site": "https://aegissoft.com.tr",
        "author": "https://github.com/MrSpy00",
    }
    meta = cfg["themeMeta"]
    assert meta["crimson"]["background"] == "wallpaper.svg"
    assert meta["crimson"]["swatch"] == ["#140b0d", "#201417"]
    assert meta["clean-dark"]["swatch"] == ["#0e0e10", "#1a1a1c"]
    assert meta["amoled"]["name"] == "AMOLED Black"
    assert "background" not in meta["ocean"]


def test_repack_packs_background_assets(fake_apps):
    assert cli.main(["install", "--spotify-dir", str(fake_apps), "--yes"]) == 0

    entries = spa.read_spa(fake_apps / "xpui.spa")
    assert "reverse/themes/crimson/wallpaper.svg" in entries
    assert entries["reverse/themes/crimson/wallpaper.svg"].lstrip().startswith(b"<svg")
    # loader manifest fetch eder (swatch/arkaplan bilgisi runtime'da buradan)
    assert "reverse/themes/crimson/manifest.json" in entries
    assert json.loads(entries["reverse/themes/crimson/manifest.json"])["background"] == "wallpaper.svg"
    # tüm temaların css'i + meta eşleşmeli
    cfg = json.loads(entries["reverse/config.json"])
    for tid in cfg["themes"]:
        assert f"reverse/themes/{tid}/theme.css" in entries
        assert tid in cfg["themeMeta"]


def test_add_plugin_records_repo_url(fake_apps):
    assert cli.main(["install", "--spotify-dir", str(fake_apps), "--yes"]) == 0
    assert cli.main(["plugins", "add", "key-highlight", "--spotify-dir", str(fake_apps), "--yes"]) == 0

    entries = spa.read_spa(fake_apps / "xpui.spa")
    cfg = json.loads(entries["reverse/config.json"])
    [p] = cfg["plugins"]
    assert p["id"] == "key-highlight"
    assert p["repo"] == REPO


def test_repack_backfills_plugin_meta_for_panel(fake_apps):
    """Panel açıklama/ayarları config entry'lerinden okur — manifest tek kaynaktır."""
    assert cli.main(["install", "--spotify-dir", str(fake_apps), "--yes"]) == 0
    assert cli.main(["plugins", "add", "remaining-time", "--spotify-dir", str(fake_apps), "--yes"]) == 0

    entries = spa.read_spa(fake_apps / "xpui.spa")
    cfg = json.loads(entries["reverse/config.json"])
    p = cfg["plugins"][0]
    assert p["id"] == "remaining-time"
    assert p["description"] and len(p["description"]) <= 300
    assert p["perfClass"] == "light"
    assert p["settings"][0]["key"] == "position"
    assert p["settings"][0]["default"] == "alt-orta"

    # eski kurulum simülasyonu: meta alanları sil → install → backfill geri gelir
    for k in ("name", "perfClass", "description", "settings"):
        p.pop(k, None)
    entries["reverse/config.json"] = json.dumps(cfg).encode("utf-8")
    spa.write_spa(entries, fake_apps / "xpui.spa")

    assert cli.main(["install", "--spotify-dir", str(fake_apps), "--yes"]) == 0
    cfg2 = json.loads(spa.read_spa(fake_apps / "xpui.spa")["reverse/config.json"])
    p2 = cfg2["plugins"][0]
    assert p2["description"]
    assert p2["perfClass"] == "light"
    assert p2["settings"][0]["key"] == "position"
