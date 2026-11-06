"""Repo plugin envanteri: tüm plugin'ler manifest+lint+syntax sağlığına sahip olmalı."""

from reversespotify import plugins_cmd

EXPECTED = {
    "key-highlight",
    "back-to-top",
    "shortcuts-help",
    "copy-now-playing",
    "remaining-time",
    "rs-inspect",
}


def test_all_repo_plugins_present_and_valid():
    metas = plugins_cmd.list_repo_plugins()
    ids = {m["id"] for m in metas}
    assert ids == EXPECTED, f"eksik/fazla plugin: {sorted(EXPECTED ^ ids)}"
    for m in metas:
        src = (plugins_cmd.plugins_root() / m["id"] / m["entry"]).read_bytes()
        assert plugins_cmd.lint_bytes(src) == [], f"{m['id']}: lint RED"
        assert m["perfClass"] in ("light", "medium")


def test_registry_lists_all_plugins():
    import json

    reg = json.loads(plugins_cmd.REGISTRY_PATH.read_text(encoding="utf-8"))
    ids = {item["id"] for item in reg["plugins"]}
    assert ids == EXPECTED
    for item in reg["plugins"]:
        assert item["repo"] == "https://github.com/MrSpy00/ReverseSpotify"
