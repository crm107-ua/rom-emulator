"""Arranca la API Flask + Boxshelf (fork) para PC Windows.

1. Sube scripts/rom_web en http://127.0.0.1:5000
2. Lanza Electron Boxshelf desde tools/boxshelf (npm start)
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
API = ROOT / "scripts" / "rom_web" / "web_app.py"
BOX = ROOT / "tools" / "boxshelf"
VENV_PY = ROOT / ".venv" / "Scripts" / "python.exe"


def python() -> str:
    if VENV_PY.exists():
        return str(VENV_PY)
    return sys.executable


def wait_health(url: str = "http://127.0.0.1:5000/api/health", timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urlopen(url, timeout=2) as r:
                if r.status == 200:
                    return True
        except (URLError, OSError):
            time.sleep(0.4)
    return False


def main() -> int:
    if not API.exists():
        print(f"No está la API en {API}")
        return 1
    if not BOX.exists():
        print(f"No está el fork Boxshelf en {BOX}")
        return 1

    print("→ API Flask (rom_web)…")
    api_proc = subprocess.Popen(
        [python(), str(API)],
        cwd=str(API.parent),
        env={**os.environ},
    )
    try:
        if not wait_health():
            print("La API no respondió en /api/health")
            api_proc.terminate()
            return 1
        print("  OK http://127.0.0.1:5000")

        npm = shutil.which("npm") or shutil.which("npm.cmd")
        if not npm:
            print("npm no está en PATH. Instala Node.js LTS y vuelve a ejecutar.")
            print("La API sigue en marcha (PID %s)." % api_proc.pid)
            return 2

        node_modules = BOX / "node_modules"
        if not node_modules.exists():
            print("→ npm install (primera vez)…")
            r = subprocess.call([npm, "install"], cwd=str(BOX), shell=False)
            if r != 0:
                print("npm install falló")
                return r

        print("→ Boxshelf (Electron)…")
        print("  Settings → Library → Wanikoko Loader")
        code = subprocess.call([npm, "run", "windowed"], cwd=str(BOX), shell=False)
        return code
    finally:
        if api_proc.poll() is None:
            api_proc.terminate()
            try:
                api_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                api_proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
