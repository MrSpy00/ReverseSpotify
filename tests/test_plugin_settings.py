"""Manifest şeması genişlemesi: description (açıklama) + settings (ayar listesi)."""

import pytest

from reversespotify import plugins_cmd
from reversespotify.plugins_cmd import validate_manifest

BASE = {
    "id": "demo",
    "name": "Demo",
    "version": "1.0.0",
    "entry": "index.js",
    "permissions": ["ui"],
    "perfClass": "light",
}


def _with(**kw):
    data = dict(BASE)
    data.update(kw)
    return data


def test_description_optional_but_must_be_short_string():
    assert validate_manifest(_with(description="kısa açıklama"), "ctx") is not None
    with pytest.raises(ValueError):
        validate_manifest(_with(description=123), "ctx")
    with pytest.raises(ValueError):
        validate_manifest(_with(description="x" * 301), "ctx")


def test_settings_schema_valid():
    data = _with(
        settings=[
            {
                "key": "position",
                "label": "Konum",
                "type": "select",
                "options": ["alt-orta", "sag-alt"],
                "default": "alt-orta",
                "help": "chip'in görüneceği yer",
            },
            {"key": "show", "label": "Göster", "type": "toggle", "default": True},
        ]
    )
    assert validate_manifest(data, "ctx") is data


def test_settings_rejects_bad_shapes():
    with pytest.raises(ValueError):
        validate_manifest(_with(settings="x"), "ctx")
    with pytest.raises(ValueError):
        validate_manifest(
            _with(settings=[{"label": "a", "type": "toggle", "default": True}]), "ctx"
        )
    with pytest.raises(ValueError):
        validate_manifest(
            _with(settings=[{"key": "k", "label": "a", "type": "range", "default": 1}]),
            "ctx",
        )
    # select: options zorunlu
    with pytest.raises(ValueError):
        validate_manifest(
            _with(settings=[{"key": "k", "label": "a", "type": "select", "default": "x"}]),
            "ctx",
        )
    # select: default options içinde olmalı
    with pytest.raises(ValueError):
        validate_manifest(
            _with(
                settings=[
                    {"key": "k", "label": "a", "type": "select", "options": ["x"], "default": "y"}
                ]
            ),
            "ctx",
        )
    # toggle: default bool
    with pytest.raises(ValueError):
        validate_manifest(
            _with(settings=[{"key": "k", "label": "a", "type": "toggle", "default": "yes"}]),
            "ctx",
        )
    # key slug formatı
    with pytest.raises(ValueError):
        validate_manifest(
            _with(settings=[{"key": "Bad Key", "label": "a", "type": "toggle", "default": True}]),
            "ctx",
        )


def test_repo_plugins_all_have_description():
    metas = plugins_cmd.list_repo_plugins()
    assert metas, "repo plugin envanteri boş"
    for m in metas:
        d = m.get("description")
        assert isinstance(d, str) and d.strip(), f"{m['id']}: description yok"
        assert len(d) <= 300


def test_remaining_time_declares_position_setting():
    metas = {m["id"]: m for m in plugins_cmd.list_repo_plugins()}
    rt = metas["remaining-time"]
    keys = {s["key"] for s in rt.get("settings", [])}
    assert "position" in keys
    assert rt["permissions"] == ["settings", "ui"]
