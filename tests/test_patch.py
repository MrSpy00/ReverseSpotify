import pytest

from reversespotify import patch

FIXTURE = "tests/fixtures/index.html"
TAG = '<script defer="defer" src="/xpui-snapshot.js"></script>'


def _fixture():
    return open(FIXTURE, encoding="utf-8").read()


def test_has_loader_false_on_vanilla():
    assert patch.has_loader(_fixture()) is False


def test_inject_loader_inserts_loader_before_xpui_script():
    out = patch.inject_loader(_fixture())
    assert out.index("/reverse-loader.js") < out.index("/xpui-snapshot.js")
    # xpui script etiketi değişmeden kalır
    assert TAG in out
    # loader etiketi tam bir script etiketi olarak durur
    assert '<script defer="defer" src="/reverse-loader.js"></script>' in out


def test_inject_loader_is_idempotent():
    once = patch.inject_loader(_fixture())
    twice = patch.inject_loader(once)
    assert twice == once
    assert twice.count("/reverse-loader.js") == 1


def test_has_loader_true_after_inject():
    assert patch.has_loader(patch.inject_loader(_fixture())) is True


def test_inject_loader_raises_without_xpui_tag():
    with pytest.raises(ValueError, match="xpui"):
        patch.inject_loader("<html><body>yok</body></html>")
