"""T7 keşif: xpui chunk'larından ad/upsell testid'leri ve kalite-gate terimlerini topla."""

import re
from pathlib import Path

ROOT = Path(r"C:\Users\mrSpy\AppData\Local\Temp\opencode\xpui_probe")

TESTID_RE = re.compile(r'data-testid["\']?\s*[:=]\s*["\']([^"\']+)["\']')
Q_RE = re.compile(r".{60}(?:very_high|veryHigh|bitrate|audio-quality|audioQuality|entitlement).{60}", re.I)
AD_NAME_RE = re.compile(r"ad|upsell|upgrade|leavebehind|announcement|sponsor|nudge|banner", re.I)


def main() -> None:
    ids: dict[str, set[str]] = {}
    for f in ROOT.glob("*.js"):
        s = f.read_text(encoding="utf-8", errors="ignore")
        for m in TESTID_RE.finditer(s):
            ids.setdefault(m.group(1), set()).add(f.name)

    print("== data-testid ad/upsell related ==")
    for k in sorted(ids):
        if AD_NAME_RE.search(k):
            print(f"{k}  <- {sorted(ids[k])[:3]}")

    print()
    print("== quality/entitlement term hits ==")
    for f in sorted(ROOT.glob("*.js")):
        s = f.read_text(encoding="utf-8", errors="ignore")
        ms = Q_RE.findall(s)
        if not ms:
            continue
        if f.name in (
            "xpui-routes-desktop-settings.js",
            "xpui-routes-settings.js",
            "xpui-desktop-routes-settings.js",
            "xpui-snapshot.js",
        ) or "quality" in f.name.lower():
            print(f"-- {f.name}: {len(ms)} hits")
            for h in ms[:4]:
                print("   ", h.replace("\n", " ")[:160])


if __name__ == "__main__":
    main()
