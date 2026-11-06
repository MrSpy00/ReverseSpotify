"""Manifest genişletmesi: swatch (panel önizleme) + background/backgroundVideo varlıklar."""

import json

import pytest

from reversespotify import themes_cmd

REQUIRED = {"id": "x", "name": "x", "author": "y", "version": "1", "entryCss": "theme.css"}


def _write_theme(root, tid, extra):
    d = root / tid
    d.mkdir(parents=True)
    manifest = {**REQUIRED, "id": tid, **extra}
    (d / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (d / "theme.css").write_text("/* css */", encoding="utf-8")
    return d


def test_swatch_valid_passthrough(tmp_path):
    root = tmp_path / "themes"
    _write_theme(root, "t1", {"swatch": ["#101010", "#1a1a1c"]})
    [t] = themes_cmd.list_themes(root)
    assert t["swatch"] == ["#101010", "#1a1a1c"]


@pytest.mark.parametrize(
    "swatch",
    [["#101010"], ["#101010", "kirmizi"], "not-a-list", ["#101010", "#1a1a1c", "#000000"]],
)
def test_swatch_invalid_rejected(tmp_path, swatch):
    root = tmp_path / "themes"
    _write_theme(root, "t1", {"swatch": swatch})
    with pytest.raises(ValueError, match="manifest"):
        themes_cmd.list_themes(root)


def test_background_with_existing_file_ok(tmp_path):
    root = tmp_path / "themes"
    d = _write_theme(root, "t1", {"background": "wall.jpg", "swatch": ["#101010", "#1a1a1c"]})
    (d / "wall.jpg").write_bytes(b"\xff\xd8fake")
    [t] = themes_cmd.list_themes(root)
    assert t["background"] == "wall.jpg"


def test_background_missing_file_rejected(tmp_path):
    root = tmp_path / "themes"
    _write_theme(root, "t1", {"background": "yok.jpg"})
    with pytest.raises(ValueError, match="manifest"):
        themes_cmd.list_themes(root)


@pytest.mark.parametrize("bad", ["../evil.jpg", "alt/dosya.jpg", "/abs.jpg", "x"])
def test_background_path_traversal_rejected(tmp_path, bad):
    root = tmp_path / "themes"
    _write_theme(root, "t1", {"backgroundVideo": bad})
    with pytest.raises(ValueError, match="manifest"):
        themes_cmd.list_themes(root)


def test_background_video_with_existing_file_ok(tmp_path):
    root = tmp_path / "themes"
    d = _write_theme(root, "t1", {"backgroundVideo": "loop.mp4"})
    (d / "loop.mp4").write_bytes(b"mp4fake")
    [t] = themes_cmd.list_themes(root)
    assert t["backgroundVideo"] == "loop.mp4"


def test_builtin_themes_have_swatch():
    for t in themes_cmd.list_themes():
        sw = t.get("swatch")
        assert isinstance(sw, list) and len(sw) == 2, f"{t['id']}: swatch yok/geçersiz"
