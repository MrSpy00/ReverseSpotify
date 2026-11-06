"""Global Constraint: repo kodunda mutlak kullanıcı yolu gömülü olamaz (runtime çözümleme şart)."""

from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1] / "tools"


def test_tools_scripts_have_no_baked_absolute_user_paths():
    offenders = []
    for py in TOOLS.glob("*.py"):
        src = py.read_text(encoding="utf-8", errors="ignore")
        if "C:\\Users" in src or "C:/Users" in src:
            offenders.append(py.name)
    assert not offenders, f"mutlak kullanıcı yolu gömülü: {offenders}"
