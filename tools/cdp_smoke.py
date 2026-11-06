"""CDP smoke yardÄ±mcÄ±sÄ± (T5-T9): Spotify'Ä± debug bayraÄŸÄ±yla baÅŸlat, JS deÄŸerlendir, istersen ekran gÃ¶rÃ¼ntÃ¼sÃ¼ al.

KullanÄ±m: python tools/cdp_smoke.py "<js expr>" [screenshot.png]
"""

import base64
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.request

import websocket

SPOTIFY = str(pathlib.Path(os.environ["APPDATA"]) / "Spotify" / "Spotify.exe")


def kill():
    subprocess.run(["taskkill", "/F", "/IM", "Spotify.exe"], capture_output=True)
    subprocess.run(["taskkill", "/F", "/IM", "SpotifyLauncher.exe"], capture_output=True)
    time.sleep(2)


def launch():
    subprocess.Popen([SPOTIFY, "--remote-debugging-port=9222", "--remote-allow-origins=*"])
    for _ in range(60):
        time.sleep(1)
        try:
            tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json/list"))
            for t in tabs:
                if t.get("type") == "page" and "xpui" in t.get("url", ""):
                    return t["webSocketDebuggerUrl"]
        except Exception:
            continue
    raise SystemExit("CDP sayfasÄ± bulunamadÄ±")


def main():
    expr = sys.argv[1]
    shot = sys.argv[2] if len(sys.argv) > 2 else None
    kill()
    ws_url = launch()
    ws = websocket.create_connection(ws_url, origin="")
    mid = 0

    def call(method, params=None):
        nonlocal mid
        mid += 1
        ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            r = json.loads(ws.recv())
            if r.get("id") == mid:
                return r

    # boot bekle: dataset.rs=1 + modÃ¼ller
    for _ in range(40):
        r = call("Runtime.evaluate", {"expression": "document.documentElement.dataset.rs||''", "returnByValue": True})
        if r.get("result", {}).get("result", {}).get("value") == "1":
            break
        time.sleep(1)
    time.sleep(3)  # theme-engine run (config+css fetch) iÃ§in

    r = call(
        "Runtime.evaluate",
        {"expression": expr, "returnByValue": True, "awaitPromise": True},
    )
    print(json.dumps(r.get("result", {}).get("result", {}), ensure_ascii=False, indent=2))

    if shot:
        call("Page.enable")
        r = call("Page.captureScreenshot", {"format": "png"})
        res = r.get("result", {})
        data = res.get("data") or (res.get("result") or {}).get("data")
        if data is None:
            raise SystemExit(f"screenshot baÅŸarÄ±sÄ±z: {json.dumps(r)[:300]}")
        open(shot, "wb").write(base64.b64decode(data))
        print(f"screenshot: {shot}")
    ws.close()


if __name__ == "__main__":
    main()
