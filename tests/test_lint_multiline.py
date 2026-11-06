"""Fix: multi-line setInterval gövdesi lint'ten kaçıyordu (re.DOTALL yokluğu)."""

from reversespotify.lint import lint_source


def test_multiline_set_interval_under_100ms_is_flagged():
    js = "setInterval(() => {\n  doWork();\n}, 50)\n"
    assert any("setInterval" in v for v in lint_source(js)), lint_source(js)


def test_multiline_set_interval_at_100ms_is_allowed():
    js = "setInterval(() => {\n  doWork();\n}, 250)\n"
    assert not any("setInterval" in v for v in lint_source(js)), lint_source(js)
