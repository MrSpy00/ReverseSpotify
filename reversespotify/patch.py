"""index.html loader enjeksiyonu (idempotent)."""

import re

LOADER_TAG = '<script defer="defer" src="/reverse-loader.js"></script>'
_XPUI_SCRIPT = re.compile(r'<script[^>]*src="/xpui-snapshot\.js"[^>]*>\s*</script>')


def has_loader(html: str) -> bool:
    return "/reverse-loader.js" in html


def inject_loader(html: str) -> str:
    if has_loader(html):
        return html
    m = _XPUI_SCRIPT.search(html)
    if not m:
        raise ValueError("xpui script tag not found — desteklenmeyen index.html sürümü")
    # defer'lı scriptler sırayla çalışır: loader xpui-snapshot.js'den ÖNCE gelmeli
    return html[: m.start()] + LOADER_TAG + html[m.start() :]
