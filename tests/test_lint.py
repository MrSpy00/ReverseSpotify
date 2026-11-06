import pytest

from reversespotify import lint


@pytest.mark.parametrize(
    "src,frag",
    [
        ("setInterval(()=>el.querySelectorAll('div').forEach(f), 50)", "setInterval"),
        ("new MutationObserver(cb).observe(x,{})", "MutationObserver"),
        ("el.style.backdropFilter='blur(20px)'", "backdrop-filter"),
        ("for (const el of document.querySelectorAll('.x')) { el.remove(); }", "querySelectorAll"),
    ],
)
def test_lint_flags_heavy_patterns(src, frag):  # Review Focus #5
    assert any(frag in v for v in lint.lint_source(src))


def test_lint_allows_throttled_observer():
    assert lint.lint_source("rafThrottled.observe(x)") == []


def test_lint_allows_observer_with_debounce():
    assert lint.lint_source("new MutationObserver(debounce(cb,100)).observe(x,{})") == []


def test_lint_allows_slow_interval():
    assert lint.lint_source("setInterval(tick, 1000)") == []


def test_lint_allows_single_query_selector():
    assert lint.lint_source("document.querySelectorAll('.a')") == []
