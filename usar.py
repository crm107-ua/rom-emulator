"""Lanza reverse-api-engineer contra la web guardada en sitio.json.

El desarrollo queda en este directorio: las capturas van a runs/ y el
cliente generado aparece en scripts/.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITIO = ROOT / "sitio.json"
RUNS = ROOT / "runs"


def cargar() -> dict:
    if not SITIO.exists():
        return {"url": "", "objetivo": ""}
    return json.loads(SITIO.read_text(encoding="utf-8"))


def guardar(datos: dict) -> None:
    SITIO.write_text(json.dumps(datos, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def cli() -> Path:
    nombre = "reverse-api-engineer.exe" if sys.platform == "win32" else "reverse-api-engineer"
    ruta = Path(sys.executable).with_name(nombre)
    if not ruta.exists():
        raise SystemExit(
            "No está instalado reverse-api-engineer en este entorno. Ejecuta: uv sync"
        )
    return ruta


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Indica la web y captura su API con reverse-api-engineer."
    )
    parser.add_argument("--url", "-u", help="Web de partida. Se guarda en sitio.json.")
    parser.add_argument("--objetivo", "-p", help="Qué quieres obtener de esa web.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Comprueba entorno y configuración sin abrir el navegador.",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Navegador sin ventana. Sirve para sitios públicos.",
    )
    parser.add_argument(
        "--json-stream",
        action="store_true",
        help="Escribe el progreso en rae-run.ndjson y el registro en rae-run.log.",
    )
    args = parser.parse_args()

    datos = cargar()
    if args.url is not None:
        datos["url"] = args.url.strip()
    if args.objetivo is not None:
        datos["objetivo"] = args.objetivo.strip()
    if args.url is not None or args.objetivo is not None:
        guardar(datos)

    url = str(datos.get("url") or "").strip()
    objetivo = str(datos.get("objetivo") or "").strip()
    if not url or not objetivo:
        print("Falta la web o el objetivo.")
        print("Edita sitio.json o ejecuta:")
        print(
            '  uv run python usar.py --url https://ejemplo.com --objetivo "qué quieres extraer"'
        )
        return 2

    RUNS.mkdir(exist_ok=True)
    comando = [
        str(cli()),
        "agent",
        "--prompt",
        objetivo,
        "--url",
        url,
        "--output-dir",
        str(RUNS),
    ]
    if args.dry_run:
        comando.append("--dry-run")
    if args.headless:
        comando.append("--headless")
    if args.json_stream:
        comando.append("--json-stream")
        salida = open(ROOT / "rae-run.ndjson", "w", encoding="utf-8")
        errores = open(ROOT / "rae-run.log", "w", encoding="utf-8")
        try:
            return subprocess.call(comando, cwd=ROOT, stdout=salida, stderr=errores)
        finally:
            salida.close()
            errores.close()

    return subprocess.call(comando, cwd=ROOT)


if __name__ == "__main__":
    raise SystemExit(main())
