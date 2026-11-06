from reversespotify import cli


def test_status_reports_adblock_mode_and_selector_count(fake_apps, capsys):
    assert cli.main(["install", "--spotify-dir", str(fake_apps), "--yes"]) == 0
    capsys.readouterr()
    assert cli.main(["status", "--spotify-dir", str(fake_apps)]) == 0
    out = capsys.readouterr().out
    assert "adblock: ui-only" in out
    assert "seçik" in out
