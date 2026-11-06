from pathlib import Path

import pytest

from reversespotify import process, spa

FIXTURE_INDEX = Path("tests/fixtures/index.html")


@pytest.fixture
def fake_apps(tmp_path, monkeypatch):
    """Sahte Apps dizini + sahte xpui.spa; data_root izole edilir."""
    monkeypatch.setenv("REVERSESPOTIFY_HOME", str(tmp_path / "RShome"))
    monkeypatch.setattr(process, "spotify_running", lambda: False)

    apps = tmp_path / "Apps"
    apps.mkdir()
    index = FIXTURE_INDEX.read_bytes()
    spa.write_spa({"index.html": index, "xpui-snapshot.js": b"/*js*/"}, apps / "xpui.spa")
    return apps
