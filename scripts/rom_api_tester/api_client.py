#!/usr/bin/env python3
"""
ROM Manager API Client — Verificación de proveedores + descargas directas
=========================================================================
Testa la interfaz web en localhost:5000 construida sobre dos proveedores:
  • CoolROM  (coolrom.com)   → CDN: dlc.coolrom.com
  • RomsFun  (romsfun.com)   → CDN: sto.romsfast.com / statics.romsfun.com

Endpoints Flask que se ejercitan:
  GET /api/roms?system={slug}&letter={letra}&provider={proveedor}
  GET /api/url?system={slug}&id={id}&name={nombre}            (CoolROM)
  GET /api/url?rom_url={url_rom}&provider=romsfun.com         (RomsFun)
  GET /api/search?q={query}&provider={proveedor}
  GET /download?system=...&id=...&name=...                    (CoolROM stream)
  GET /download?provider=romsfun.com&rom_url=...              (RomsFun stream)
  GET /proxy/image?url={url_imagen}

Ejecutar:
    python api_client.py

Requisito previo:
    La app Flask debe estar corriendo:  python web_app.py   (puerto 5000)
"""

from __future__ import annotations

import io
import os
import sys
import random
import time
import requests
from typing import Optional

# Force UTF-8 output on Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = "http://localhost:5000"

# ---------------------------------------------------------------------------
# Sesión HTTP
# ---------------------------------------------------------------------------

def create_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": "ROMManagerClient/1.0",
        "Accept": "application/json, */*",
        "Accept-Language": "es-ES,es;q=0.9",
    })
    return s


SESSION = create_session()


# ---------------------------------------------------------------------------
# /api/roms — listado de ROMs por sistema
# ---------------------------------------------------------------------------

def list_roms(
    system: str,
    provider: str = "coolrom.com",
    letter: str = "",
) -> list[dict]:
    """
    Devuelve la lista de ROMs para un sistema y proveedor.

    Args:
        system:   slug del sistema  (p.ej. 'genesis', 'psx', 'sega-genesis', 'nintendo-64')
        provider: 'coolrom.com' o 'romsfun.com'
        letter:   filtro de letra inicial (sólo CoolROM; '' = todos)

    Returns:
        Lista de dicts con id, name, url_name, system, provider, etc.
    """
    params = {"system": system, "provider": provider, "letter": letter}
    r = SESSION.get(f"{BASE}/api/roms", params=params, timeout=30)
    r.raise_for_status()
    data = r.json()
    return data.get("roms", [])


# ---------------------------------------------------------------------------
# /api/url — obtener URL de descarga directa
# ---------------------------------------------------------------------------

def get_url_coolrom(system: str, rom_id: int, url_name: str) -> dict:
    """
    Obtiene la URL de descarga CDN para un ROM de CoolROM.

    Returns:
        dict con claves: download_url, image_url, platform, provider, valid
    """
    params = {"system": system, "id": str(rom_id), "name": url_name}
    r = SESSION.get(f"{BASE}/api/url", params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def get_url_romsfun(rom_url: str) -> dict:
    """
    Obtiene la URL de descarga CDN para un ROM de RomsFun.

    Args:
        rom_url: URL completa de la página del ROM en romsfun.com
                 p.ej. 'https://romsfun.com/roms/sega-genesis/sonic-with-knuckles.html'

    Returns:
        dict con claves: download_url, image_url
    """
    params = {"rom_url": rom_url, "provider": "romsfun.com"}
    r = SESSION.get(f"{BASE}/api/url", params=params, timeout=30)
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------------------
# /api/search — búsqueda global
# ---------------------------------------------------------------------------

def search_roms(query: str, provider: str = "all") -> list[dict]:
    """
    Búsqueda de ROMs en uno o todos los proveedores.

    Args:
        query:    texto a buscar
        provider: 'all', 'coolrom.com', 'romsfun.com'

    Returns:
        Lista de dicts con resultados de búsqueda.
    """
    params: dict = {"q": query}
    if provider != "all":
        params["provider"] = provider
    r = SESSION.get(f"{BASE}/api/search", params=params, timeout=30)
    r.raise_for_status()
    return r.json().get("roms", [])


# ---------------------------------------------------------------------------
# /download — descarga streaming (devuelve bytes en memoria para demo)
# ---------------------------------------------------------------------------

def download_coolrom(
    system: str,
    rom_id: int,
    url_name: str,
    output_dir: str = ".",
    max_bytes: Optional[int] = None,
) -> str:
    """
    Descarga un ROM de CoolROM a través del servidor proxy Flask.

    Args:
        system:     slug del sistema
        rom_id:     ID numérico del ROM
        url_name:   nombre en la URL
        output_dir: carpeta de destino
        max_bytes:  si se indica, trunca la descarga (sólo para prueba)

    Returns:
        Ruta al fichero descargado.
    """
    params = {"system": system, "id": str(rom_id), "name": url_name}
    r = SESSION.get(f"{BASE}/download", params=params, stream=True, timeout=120)
    r.raise_for_status()
    return _save_stream(r, output_dir, max_bytes)


def download_romsfun(
    rom_url: str,
    output_dir: str = ".",
    max_bytes: Optional[int] = None,
) -> str:
    """
    Descarga un ROM de RomsFun a través del servidor proxy Flask.

    Args:
        rom_url:    URL de la página del ROM en romsfun.com
        output_dir: carpeta de destino
        max_bytes:  si se indica, trunca la descarga (sólo para prueba)

    Returns:
        Ruta al fichero descargado.
    """
    params = {"provider": "romsfun.com", "rom_url": rom_url}
    r = SESSION.get(f"{BASE}/download", params=params, stream=True, timeout=120)
    r.raise_for_status()
    return _save_stream(r, output_dir, max_bytes)


def _save_stream(
    resp: requests.Response,
    output_dir: str,
    max_bytes: Optional[int],
) -> str:
    """Guarda la respuesta streaming en un fichero."""
    cd = resp.headers.get("Content-Disposition", "")
    if "filename=" in cd:
        filename = cd.split("filename=")[-1].strip('" ')
    else:
        filename = resp.url.split("?")[0].rstrip("/").split("/")[-1] or "rom_download"

    os.makedirs(output_dir, exist_ok=True)
    path = os.path.join(output_dir, filename)

    written = 0
    with open(path, "wb") as fh:
        for chunk in resp.iter_content(65536):
            if chunk:
                fh.write(chunk)
                written += len(chunk)
                if max_bytes and written >= max_bytes:
                    break  # sólo descarga parcial para test

    return os.path.abspath(path)


# ---------------------------------------------------------------------------
# Verificación de URL CDN con HEAD (sin descargar el archivo completo)
# ---------------------------------------------------------------------------

def verify_cdn_url(cdn_url: str) -> dict:
    """
    Realiza un HEAD a la URL CDN para verificar que sirve bytes.

    Returns:
        dict con status, content_type, content_length, ok
    """
    h = SESSION.head(cdn_url, timeout=20, allow_redirects=True,
                     headers={"Referer": "https://coolrom.com/"})
    return {
        "status":         h.status_code,
        "content_type":   h.headers.get("Content-Type", "?"),
        "content_length": h.headers.get("Content-Length", "?"),
        "ok":             h.status_code == 200,
    }


# ---------------------------------------------------------------------------
# main — demo/test completo
# ---------------------------------------------------------------------------

def main() -> None:
    LINE = "─" * 68

    print(f"\n{'=' * 68}")
    print("  ROM Manager — Verificación de proveedores + descargas directas")
    print(f"  API: {BASE}")
    print(f"{'=' * 68}\n")

    # ── 1. CoolROM: Sega Genesis ─────────────────────────────────────────
    print(f"[1] CoolROM → Sega Genesis")
    genesis_roms = list_roms("genesis", provider="coolrom.com")
    print(f"    ROMs cargados: {len(genesis_roms)}")
    assert len(genesis_roms) > 0, "No se obtuvieron ROMs de CoolROM Genesis"

    # 5 aleatorios para resolver y verificar URL CDN
    sample_genesis = random.sample(genesis_roms, min(5, len(genesis_roms)))
    print(f"    Verificando 5 URLs aleatorias:")
    for rom in sample_genesis:
        info = get_url_coolrom(rom["system"], rom["id"], rom["url_name"])
        cdn  = info.get("download_url", "")
        chk  = verify_cdn_url(cdn) if cdn else {"ok": False, "status": "—"}
        mark = "✓" if chk["ok"] else "✗"
        print(f"      {mark} [{rom['id']:>6}] {rom['name'][:40]}")
        print(f"           CDN: {cdn[:80]}…")
        print(f"           HTTP {chk['status']}  len={chk.get('content_length','?')}")
    print()

    # ── 2. CoolROM: PlayStation ──────────────────────────────────────────
    print(f"[2] CoolROM → PlayStation")
    psx_roms = list_roms("psx", provider="coolrom.com")
    print(f"    ROMs cargados: {len(psx_roms)}")
    assert len(psx_roms) > 0, "No se obtuvieron ROMs de CoolROM PSX"

    sample_psx = random.sample(psx_roms, min(5, len(psx_roms)))
    print(f"    Verificando 5 URLs aleatorias:")
    for rom in sample_psx:
        info = get_url_coolrom(rom["system"], rom["id"], rom["url_name"])
        cdn  = info.get("download_url", "")
        chk  = verify_cdn_url(cdn) if cdn else {"ok": False, "status": "—"}
        mark = "✓" if chk["ok"] else "✗"
        print(f"      {mark} [{rom['id']:>6}] {rom['name'][:40]}")
        print(f"           CDN: {cdn[:80]}…")
        print(f"           HTTP {chk['status']}  len={chk.get('content_length','?')}")
    print()

    # ── 3. RomsFun: Sega Genesis ─────────────────────────────────────────
    print(f"[3] RomsFun → Sega Genesis")
    rfgen_roms = list_roms("sega-genesis", provider="romsfun.com")
    print(f"    ROMs cargados: {len(rfgen_roms)}")
    assert len(rfgen_roms) > 0, "No se obtuvieron ROMs de RomsFun Genesis"

    sample_rfgen = rfgen_roms[:5]  # los primeros 5 (menos rate-limit)
    print(f"    Verificando hasta 5 URLs:")
    for rom in sample_rfgen:
        try:
            info = get_url_romsfun(rom.get("url", ""))
            cdn  = info.get("download_url", "")
            chk  = verify_cdn_url(cdn) if cdn else {"ok": False, "status": "—"}
            mark = "✓" if chk["ok"] else "✗"
            print(f"      {mark} {rom['name'][:42]}")
            print(f"           CDN: {cdn[:80]}…")
            print(f"           HTTP {chk['status']}  len={chk.get('content_length','?')}")
        except Exception as e:
            print(f"      ✗ {rom['name'][:42]}  →  {e}")
        time.sleep(0.3)  # respetar rate-limit de romsfun
    print()

    # ── 4. RomsFun: Nintendo 64 ──────────────────────────────────────────
    print(f"[4] RomsFun → Nintendo 64")
    rfn64_roms = list_roms("nintendo-64", provider="romsfun.com")
    print(f"    ROMs cargados: {len(rfn64_roms)}")
    assert len(rfn64_roms) > 0, "No se obtuvieron ROMs de RomsFun N64"

    sample_rfn64 = rfn64_roms[:5]
    print(f"    Verificando hasta 5 URLs:")
    for rom in sample_rfn64:
        try:
            info = get_url_romsfun(rom.get("url", ""))
            cdn  = info.get("download_url", "")
            chk  = verify_cdn_url(cdn) if cdn else {"ok": False, "status": "—"}
            mark = "✓" if chk["ok"] else "✗"
            print(f"      {mark} {rom['name'][:42]}")
            print(f"           CDN: {cdn[:80]}…")
            print(f"           HTTP {chk['status']}  len={chk.get('content_length','?')}")
        except Exception as e:
            print(f"      ✗ {rom['name'][:42]}  →  {e}")
        time.sleep(0.3)
    print()

    # ── 5. Búsqueda global ───────────────────────────────────────────────
    print(f"[5] Búsqueda global — 'sonic'")
    results = search_roms("sonic")
    cool_hits = [r for r in results if r.get("provider") == "coolrom.com"]
    rfun_hits  = [r for r in results if r.get("provider") == "romsfun.com"]
    print(f"    Total: {len(results)}  |  CoolROM: {len(cool_hits)}  |  RomsFun: {len(rfun_hits)}")
    for r in results[:5]:
        print(f"      [{r.get('provider','?'):<12}] {r.get('name','')[:50]}")
    print()

    # ── 6. Descarga directa parcial (sólo primeros 128 KB por archivo) ──
    out_dir = os.path.join(os.path.dirname(__file__), "downloads_test")
    print(f"[6] Descarga directa parcial (128 KB) — CoolROM")
    print(f"    Destino: {out_dir}")

    # CoolROM: 1 ROM conocido
    test_cr = {
        "system": "genesis", "id": 1283,
        "url_name": "Sonic_the_Hedgehog",
        "name": "Sonic the Hedgehog",
    }
    try:
        path = download_coolrom(
            test_cr["system"], test_cr["id"], test_cr["url_name"],
            output_dir=out_dir, max_bytes=131072,
        )
        size = os.path.getsize(path)
        print(f"    ✓ {test_cr['name']} → {os.path.basename(path)} ({size:,} bytes parciales)")
    except Exception as e:
        print(f"    ✗ {test_cr['name']} → {e}")

    print(f"\n[7] Descarga directa parcial (128 KB) — RomsFun")
    test_rf = {
        "url": "https://romsfun.com/roms/nintendo-64/portal-64.html",
        "name": "Portal 64",
    }
    try:
        path = download_romsfun(
            test_rf["url"],
            output_dir=out_dir, max_bytes=131072,
        )
        size = os.path.getsize(path)
        print(f"    ✓ {test_rf['name']} → {os.path.basename(path)} ({size:,} bytes parciales)")
    except Exception as e:
        print(f"    ✗ {test_rf['name']} → {e}")

    print(f"\n{'=' * 68}")
    print("  Verificación completada.")
    print(f"{'=' * 68}\n")


if __name__ == "__main__":
    main()
