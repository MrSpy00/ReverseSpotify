from types import SimpleNamespace

from reversespotify import process


def _run(args, stdout):
    return SimpleNamespace(stdout=stdout)


def test_spotify_running_parses_tasklist(monkeypatch):
    row = "Spotify.exe                   1234 Console    1  200,000 K"
    monkeypatch.setattr(process.subprocess, "run", lambda *a, **k: _run(a, row))
    assert process.spotify_running() is True

    info = "Bilgi: Belirtilen filtreyle eşleşen görev yok."
    monkeypatch.setattr(process.subprocess, "run", lambda *a, **k: _run(a, info))
    assert process.spotify_running() is False


def test_kill_spotify_kills_both_images(monkeypatch):
    calls = []
    monkeypatch.setattr(process.subprocess, "run", lambda *a, **k: calls.append(a) or _run(a, ""))
    monkeypatch.setattr(process.time, "sleep", lambda s: None)
    process.kill_spotify()
    killed = [cmd[cmd.index("/IM") + 1] for (cmd,) in calls if "/IM" in cmd]
    assert killed == ["Spotify.exe", "SpotifyLauncher.exe"]


def test_wait_for_spotify_exit(monkeypatch):
    monkeypatch.setattr(process.time, "sleep", lambda s: None)
    state = {"n": 0}

    def running():
        state["n"] += 1
        return state["n"] < 3

    monkeypatch.setattr(process, "spotify_running", running)
    assert process.wait_for_spotify_exit(timeout=5) is True

    monkeypatch.setattr(process, "spotify_running", lambda: True)
    assert process.wait_for_spotify_exit(timeout=2) is False
