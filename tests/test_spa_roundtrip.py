import zipfile

from reversespotify import spa


def _make_spa(path):
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("index.html", "<html>app</html>")
        zf.writestr("chunks/1.js", "console.log(1)")


def test_extract_repack_preserves_bytes(tmp_path):
    spa_path = tmp_path / "xpui.spa"
    _make_spa(spa_path)

    entries = spa.read_spa(spa_path)
    out = tmp_path / "out.spa"
    spa.write_spa(entries, out)

    assert spa.read_spa(out) == entries
    assert entries["index.html"] == b"<html>app</html>"


def test_spa_hash_is_stable_and_distinct(tmp_path):
    import shutil

    a, b = tmp_path / "a.spa", tmp_path / "b.spa"
    _make_spa(a)
    shutil.copyfile(a, b)  # birebir kopya: hash eşitliği bayt düzeyinde kanıtlanır
    assert spa.spa_hash(a) == spa.spa_hash(b)

    with zipfile.ZipFile(b, "a") as zf:
        zf.writestr("index.html", "<html>changed</html>")
    assert spa.spa_hash(a) != spa.spa_hash(b)
