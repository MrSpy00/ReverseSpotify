import json
import shutil
import zipfile
from io import BytesIO
from pathlib import Path

import pytest

from reversespotify import cli, patch, plugins_cmd, spa

MANIFEST = {
    "id": "key-highlight",
    "name": "Key Highlight",
    "version": "1.0.0",
    "entry": "index.js",
    "permissions": ["ui"],
    "perfClass": "light",
}


@pytest.fixture
def fake_plugins_root(tmp_path, monkeypatch):
    """Repo plugins/ kopyası geçici köke taşınır — testler gerçek repoyu kirletmez."""
    root = tmp_path / "plugins"
    shutil.copytree(plugins_cmd.PLUGINS_ROOT, root)
    monkeypatch.setenv("REVERSESPOTIFY_PLUGINS", str(root))
    return root


def _install(apps):
    return cli.main(["install", "--spotify-dir", str(apps), "--yes"])


def _cfg(apps):
    return json.loads(spa.read_spa(apps / "xpui.spa")["reverse/config.json"])


def _add(apps, ref, *extra):
    return cli.main(["plugins", "add", ref, "--spotify-dir", str(apps), "--yes", *extra])


def test_add_builtin_plugin(fake_apps, fake_plugins_root):
    assert _install(fake_apps) == 0
    assert _add(fake_apps, "key-highlight") == 0

    cfg = _cfg(fake_apps)
    assert cfg["plugins"][0]["id"] == "key-highlight"
    assert cfg["plugins"][0]["enabled"] is True
    assert cfg["plugins"][0]["entry"] == "index.js"

    entries = spa.read_spa(fake_apps / "xpui.spa")
    assert "reverse/plugins/key-highlight/index.js" in entries
    assert patch.has_loader(entries["index.html"].decode())
    assert cli.main(["status", "--spotify-dir", str(fake_apps)]) == 0


def test_add_builtin_does_not_rewrite_manifest(fake_apps, fake_plugins_root):
    """Yerel plugin add'i repo/fixture dosyalarını bayt-düzeyinde olduğu gibi bırakır."""
    before = (fake_plugins_root / "key-highlight" / "manifest.json").read_bytes()
    assert _install(fake_apps) == 0
    assert _add(fake_apps, "key-highlight") == 0
    after = (fake_plugins_root / "key-highlight" / "manifest.json").read_bytes()
    assert after == before


def test_add_unknown_fails(fake_apps, fake_plugins_root):
    assert _install(fake_apps) == 0
    assert _add(fake_apps, "yok-boyle-plugin") == 1


def test_add_rejects_non_github_url(fake_apps, fake_plugins_root):
    assert _install(fake_apps) == 0
    assert _add(fake_apps, "https://evil.com/x.zip") == 1
    assert _cfg(fake_apps)["plugins"] == []


def test_add_lint_hard_fail_even_with_force(fake_apps, fake_plugins_root):
    assert _install(fake_apps) == 0
    bad = fake_plugins_root / "agir"
    bad.mkdir()
    (bad / "manifest.json").write_text(json.dumps(MANIFEST | {"id": "agir"}), encoding="utf-8")
    (bad / "index.js").write_text("el.style.backdropFilter='blur(99px)'", encoding="utf-8")

    assert _add(fake_apps, "agir", "--force") == 1  # lint = hard-fail, --force bile geçemez
    assert _cfg(fake_apps)["plugins"] == []
    entries = spa.read_spa(fake_apps / "xpui.spa")
    assert "reverse/plugins/agir/index.js" not in entries


def test_disable_enable_remove(fake_apps, fake_plugins_root):
    assert _install(fake_apps) == 0
    assert _add(fake_apps, "key-highlight") == 0

    assert cli.main(["plugins", "disable", "key-highlight", "--spotify-dir", str(fake_apps), "--yes"]) == 0
    assert _cfg(fake_apps)["plugins"][0]["enabled"] is False
    assert cli.main(["status", "--spotify-dir", str(fake_apps)]) == 0

    assert cli.main(["plugins", "enable", "key-highlight", "--spotify-dir", str(fake_apps), "--yes"]) == 0
    assert _cfg(fake_apps)["plugins"][0]["enabled"] is True

    assert cli.main(["plugins", "remove", "key-highlight", "--spotify-dir", str(fake_apps), "--yes"]) == 0
    assert _cfg(fake_apps)["plugins"] == []
    entries = spa.read_spa(fake_apps / "xpui.spa")
    assert not any(k.startswith("reverse/plugins/") for k in entries)  # bayat giriş temizlenir
    assert cli.main(["status", "--spotify-dir", str(fake_apps)]) == 0


def test_add_from_github_zip(fake_apps, fake_plugins_root, monkeypatch):
    assert _install(fake_apps) == 0

    buf = BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "repo-main/plugins/ext/manifest.json",
            json.dumps(MANIFEST | {"id": "ext"}),
        )
        zf.writestr("repo-main/plugins/ext/index.js", "ReverseSpotify.onReady(()=>{});")
    monkeypatch.setattr(plugins_cmd, "_download_zip", lambda url: buf.getvalue())

    assert _add(fake_apps, "https://github.com/some/repo") == 0
    cfg = _cfg(fake_apps)
    assert cfg["plugins"][0]["id"] == "ext"
    entries = spa.read_spa(fake_apps / "xpui.spa")
    assert "reverse/plugins/ext/index.js" in entries
