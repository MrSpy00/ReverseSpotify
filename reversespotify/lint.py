"""Plugin performans bütçesi lint'i (regex tabanlı, hard-fail).

Kurallar (Review Focus #5):
- setInterval literal < 100ms
- MutationObserver + .observe( — throttle/debounce/RAF emaresi yoksa
- backdrop-filter (sınırsız blur)
- senkron querySelectorAll döngüsü (for/while/forEach birlikte)

Bilinen limit: literal değerlere bakılır; değişkenle verilen aralık (setInterval(fn, n))
yakalanmaz — upgrade: sabit-propagasyon/lint için AST (esbuild/biome) eklenirse kaldırılır.
"""

import re

# ilk argüman iç içe parantez içerebilir (arrow + çağrılar): virgüle kadarki her şey
_INTERVAL_RE = re.compile(r"setInterval\s*\(.*?,\s*(\d+)\s*\)")
_THROTTLE_HINT_RE = re.compile(r"debounce|throttle|requestAnimationFrame|\brAF\b", re.IGNORECASE)
_BACKDROP_RE = re.compile(r"backdrop-?filter", re.IGNORECASE)
_QUERY_RE = re.compile(r"querySelectorAll")
_LOOP_RE = re.compile(r"\bfor\s*\(|\bwhile\s*\(|\.forEach\s*\(")


def lint_source(js: str) -> list[str]:
    violations: list[str] = []

    for m in _INTERVAL_RE.finditer(js):
        if int(m.group(1)) < 100:
            violations.append(f"setInterval {m.group(1)}ms < 100ms (performans bütçesi)")

    if "MutationObserver" in js and ".observe(" in js and not _THROTTLE_HINT_RE.search(js):
        violations.append("MutationObserver .observe( — throttle/debounce/requestAnimationFrame yok")

    if _BACKDROP_RE.search(js):
        violations.append("backdrop-filter kullanımı (sınırsız blur, performans bütçesi)")

    if _QUERY_RE.search(js) and _LOOP_RE.search(js):
        violations.append("senkron querySelectorAll döngüsü (reflow riski)")

    return violations
