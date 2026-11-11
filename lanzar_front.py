"""Arranca el front de pruebas del ROM Manager en http://localhost:5000."""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent / "scripts" / "rom_web" / "web_app.py"


def main() -> int:
    if not APP.exists():
        print(f"No está el front en {APP}")
        return 1
    sys.path.insert(0, str(APP.parent))
    runpy.run_path(str(APP), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
