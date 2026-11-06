"""Kalite seçenek filtresi ve gate bağlamını çıkar."""

import re
from pathlib import Path

SRC = Path(r"C:\Users\mrSpy\AppData\Local\Temp\opencode\xpui_probe\xpui-routes-desktop-settings.js")
s = SRC.read_text(encoding="utf-8", errors="ignore")

for pat in (r"filter\(\(\{quality", r"VERY_HIGH", r"LOSSLESS", r"PETREL"):
    print(f"===== {pat} =====")
    for m in list(re.finditer(pat, s))[:5]:
        a, b = max(0, m.start() - 350), min(len(s), m.end() + 350)
        print(s[a:b].replace("\n", " "))
        print("---")
    print()
