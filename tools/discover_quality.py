"""Kalite seÃ§enek filtresi ve gate baÄŸlamÄ±nÄ± Ã§Ä±kar."""

import os
import re
import sys
from pathlib import Path

_ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(os.environ.get("APPDATA", "")) / "Local" / "Temp" / "opencode" / "xpui_probe"
SRC = _ROOT / "xpui-routes-desktop-settings.js"
s = SRC.read_text(encoding="utf-8", errors="ignore")

for pat in (r"filter\(\(\{quality", r"VERY_HIGH", r"LOSSLESS", r"PETREL"):
    print(f"===== {pat} =====")
    for m in list(re.finditer(pat, s))[:5]:
        a, b = max(0, m.start() - 350), min(len(s), m.end() + 350)
        print(s[a:b].replace("\n", " "))
        print("---")
    print()
