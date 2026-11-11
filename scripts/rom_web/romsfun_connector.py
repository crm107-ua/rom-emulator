#!/usr/bin/env python3
"""
romsfun.com Connector
======================
Acceso directo a ROMs de romsfun.com via su WordPress REST API + AJAX interno.

Flujo de descarga:
  1. Buscar la página detalle del ROM (p.ej. /roms/sega-genesis/sonic-with-knuckles.html)
  2. Extraer el enlace de descarga (/download/{slug}-{post_id})
  3. Visitar la página de descarga para obtener el índice de archivos
  4. Para cada archivo (/download/{slug}-{id}/1), llamar al endpoint AJAX
     action=k_get_download (Referer = URL del archivo)
  5. El AJAX devuelve HTML con la URL CDN firmada en sto.romsfast.com

Resiliencia 429:
  Todos los accesos HTTP pasan por _rf_get / _rf_post que:
    • Aplican un intervalo mínimo de 0.6 s entre llamadas (global, thread-safe).
    • Reintentan hasta 6 veces con backoff exponencial + jitter ante 429/5xx.
    • Respetan la cabecera Retry-After si el servidor la devuelve.
"""

from __future__ import annotations

import random
import re
import threading
import time
from html import unescape
from typing import Optional
from urllib.parse import unquote as _url_unquote

import requests

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

PROVIDER = "romsfun.com"
BASE_URL  = "https://romsfun.com"
AJAX_URL  = "https://romsfun.com/wp-admin/admin-ajax.php"
CDN_HOST  = "sto.romsfast.com"

# Mapa slug → nombre legible (extraído de la página /roms/)
SYSTEMS: dict[str, str] = {
    "atari-2600":            "Atari 2600",
    "atari-7800":            "Atari 7800",
    "atari-jaguar":          "Atari Jaguar",
    "atari-lynx":            "Atari Lynx",
    "game-boy":              "Game Boy",
    "game-boy-advance":      "Game Boy Advance",
    "game-boy-color":        "Game Boy Color",
    "gamecube":              "GameCube",
    "mame":                  "MAME",
    "neo-geo":               "Neo Geo",
    "neo-geo-cd":            "Neo Geo CD",
    "neo-geo-pocket":        "Neo Geo Pocket",
    "nes":                   "NES",
    "nintendo-3ds":          "Nintendo 3DS",
    "nintendo-64":           "Nintendo 64",
    "nintendo-ds":           "Nintendo DS",
    "nintendo-pokemon-mini": "Nintendo Pokémon Mini",
    "nintendo-virtual-boy":  "Nintendo Virtual Boy",
    "nintendo-wii":          "Nintendo Wii",
    "playstation":           "PlayStation",
    "playstation-2":         "PlayStation 2",
    "playstation-4":         "PlayStation 4",
    "playstation-portable":  "PSP",
    "ps-vita":               "PS Vita",
    "ps3":                   "PlayStation 3",
    "sega-cd":               "Sega CD",
    "sega-dreamcast":        "Sega Dreamcast",
    "sega-game-gear":        "Sega Game Gear",
    "sega-genesis":          "Sega Genesis",
    "sega-master-system":    "Sega Master System",
    "sega-saturn":           "Sega Saturn",
    "super-nintendo":        "Super Nintendo",
    "wii-u":                 "Wii U",
    "xbox":                  "Xbox",
    "xbox-360":              "Xbox 360",
}

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

# ---------------------------------------------------------------------------
# Rate-limiter + retry (thread-safe)
# ---------------------------------------------------------------------------

_lock: threading.Lock = threading.Lock()
_last_rf_call: float  = 0.0
_MIN_INTERVAL: float  = 0.6   # segundos mínimos entre peticiones HTTP a romsfun


def _rf_get(session: requests.Session, url: str, **kwargs) -> requests.Response:
    """
    GET con rate-limiting global y backoff exponencial ante 429 / 5xx.
    Hasta 6 intentos; backoff base 1.5 s, máximo de espera 60 s por intento.
    """
    global _last_rf_call
    max_retries = 6
    base_delay  = 1.5

    for attempt in range(max_retries):
        with _lock:
            gap = time.time() - _last_rf_call
            if gap < _MIN_INTERVAL:
                time.sleep(_MIN_INTERVAL - gap + random.uniform(0.0, 0.25))
            _last_rf_call = time.time()

        try:
            r = session.get(url, **kwargs)
        except requests.RequestException:
            if attempt < max_retries - 1:
                time.sleep(base_delay * (2 ** attempt) + random.uniform(0, 0.5))
                continue
            raise

        if r.status_code == 429:
            retry_after = r.headers.get("Retry-After")
            wait = float(retry_after) if retry_after else base_delay * (2 ** attempt)
            wait = min(wait, 60.0) + random.uniform(0.5, 2.0)
            print(f"  [RomsFun] 429 → esperando {wait:.1f}s (intento {attempt + 1})", flush=True)
            time.sleep(wait)
            continue

        if r.status_code in (500, 502, 503, 504):
            if attempt < max_retries - 1:
                wait = base_delay * (2 ** attempt) + random.uniform(0, 1)
                print(f"  [RomsFun] HTTP {r.status_code} → reintentando en {wait:.1f}s", flush=True)
                time.sleep(wait)
                continue

        r.raise_for_status()
        return r

    raise RuntimeError(f"[RomsFun] {max_retries} reintentos agotados: {url}")


def _rf_post(session: requests.Session, url: str, **kwargs) -> requests.Response:
    """
    POST con rate-limiting global y backoff exponencial ante 429 / 5xx.
    """
    global _last_rf_call
    max_retries = 6
    base_delay  = 1.5

    for attempt in range(max_retries):
        with _lock:
            gap = time.time() - _last_rf_call
            if gap < _MIN_INTERVAL:
                time.sleep(_MIN_INTERVAL - gap + random.uniform(0.0, 0.25))
            _last_rf_call = time.time()

        try:
            r = session.post(url, **kwargs)
        except requests.RequestException:
            if attempt < max_retries - 1:
                time.sleep(base_delay * (2 ** attempt) + random.uniform(0, 0.5))
                continue
            raise

        if r.status_code == 429:
            retry_after = r.headers.get("Retry-After")
            wait = float(retry_after) if retry_after else base_delay * (2 ** attempt)
            wait = min(wait, 60.0) + random.uniform(0.5, 2.0)
            print(f"  [RomsFun] 429 (POST) → esperando {wait:.1f}s (intento {attempt + 1})", flush=True)
            time.sleep(wait)
            continue

        if r.status_code in (500, 502, 503, 504):
            if attempt < max_retries - 1:
                wait = base_delay * (2 ** attempt) + random.uniform(0, 1)
                time.sleep(wait)
                continue

        r.raise_for_status()
        return r

    raise RuntimeError(f"[RomsFun] {max_retries} reintentos agotados (POST): {url}")


# ---------------------------------------------------------------------------
# Sesión HTTP
# ---------------------------------------------------------------------------

def create_session() -> requests.Session:
    """Crea una sesión con cabeceras de navegador."""
    s = requests.Session()
    s.headers.update({
        "User-Agent":        _UA,
        "Accept":            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language":   "en-US,en;q=0.9",
        # Sin "br": requests no decodifica Brotli sin el paquete brotli
        # y romsfun.com sí lo envía → HTML binario y parseo vacío.
        "Accept-Encoding":   "gzip, deflate",
    })
    return s


# ---------------------------------------------------------------------------
# Búsqueda (paginada)
# ---------------------------------------------------------------------------

def search_roms(
    session: requests.Session,
    query: str,
    max_pages: int = 5,
) -> list[dict]:
    """
    Busca ROMs en romsfun.com usando la búsqueda nativa de WordPress.
    Pagina automáticamente hasta max_pages páginas (20 resultados/página).

    Returns:
        Lista de dicts con claves:
        id, name, url, system, platform, image_url, provider,
        download_page_url, download_url
    """
    results: list[dict] = []
    seen: set[str]      = set()

    for page in range(1, max_pages + 1):
        params: dict = {"s": query}
        if page > 1:
            params["paged"] = page

        try:
            r = _rf_get(session, BASE_URL, params=params, timeout=25)
        except Exception as exc:
            print(f"  [RomsFun] search p{page} error: {exc}", flush=True)
            break

        page_results = _parse_rom_list(r.text, system_filter=None)
        new_this_page = 0
        for rom in page_results:
            if rom["url"] not in seen:
                seen.add(rom["url"])
                results.append(rom)
                new_this_page += 1

        if new_this_page == 0:
            break   # no hay más resultados nuevos

    return results


# ---------------------------------------------------------------------------
# Listado por sistema
# ---------------------------------------------------------------------------

def list_roms(
    session: requests.Session,
    system_slug: str,
    page: int = 1,
) -> list[dict]:
    """
    Devuelve los ROMs de un sistema (paginado a 20 por defecto en WordPress).

    Args:
        session:     Sesión HTTP activa.
        system_slug: Slug del sistema, p.ej. 'playstation', 'sega-genesis'.
        page:        Número de página (empieza en 1).

    Returns:
        Lista de dicts (mismo esquema que search_roms).
    """
    url = f"{BASE_URL}/roms/{system_slug}/"
    if page > 1:
        url += f"page/{page}/"
    r = _rf_get(session, url, timeout=20)
    r.raise_for_status()
    return _parse_rom_list(r.text, system_filter=system_slug)


# ---------------------------------------------------------------------------
# URL de descarga directa
# ---------------------------------------------------------------------------

def get_download_url(session: requests.Session, rom_detail_url: str) -> str:
    """
    Obtiene la URL CDN firmada para un ROM de romsfun.com.

    Flujo:
      1. GET de la página detalle para extraer el enlace /download/{slug}-{id}
      2. GET de esa página para obtener el primer archivo /download/{slug}-{id}/1
      3. GET de esa página para obtener la URL CDN pre-incrustada o llamar AJAX

    Args:
        session:        Sesión HTTP activa.
        rom_detail_url: URL de la ficha del ROM,
                        p.ej. https://romsfun.com/roms/sega-genesis/sonic.html

    Returns:
        URL de descarga CDN firmada (sto.romsfast.com / statics.romsfun.com).
    """
    # Paso 1: página detalle → enlace /download/…
    r1 = _rf_get(session, rom_detail_url, timeout=30,
                 headers={"Referer": BASE_URL})
    dl_page_m = re.search(
        r'href="(https://romsfun\.com/download/[^"]+)"',
        r1.text,
    )
    if not dl_page_m:
        raise ValueError(f"No se encontró enlace de descarga en {rom_detail_url}")
    dl_page_url = dl_page_m.group(1)

    # Paso 2: página /download/{slug}-{id} → primer archivo /download/.../1
    r2 = _rf_get(session, dl_page_url, timeout=30,
                 headers={"Referer": rom_detail_url})
    file_links = re.findall(
        r'href="(https://romsfun\.com/download/[^"]+/\d+)"',
        r2.text,
    )
    if not file_links:
        raise ValueError(f"No se encontraron archivos en {dl_page_url}")

    file_url = file_links[0]

    # Paso 3: obtener URL CDN
    return _resolve_file_url(session, file_url)


def get_rom_image(session: requests.Session, rom_detail_url: str) -> Optional[str]:
    """
    Obtiene la URL de la portada (cover art) del ROM desde su página detalle.

    Returns:
        URL absoluta de la imagen, o None si no se encuentra.
    """
    try:
        r = _rf_get(session, rom_detail_url, timeout=20, headers={"Referer": BASE_URL})
        return _extract_image(r.text)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Funciones internas
# ---------------------------------------------------------------------------

def _parse_rom_list(html: str, system_filter: Optional[str]) -> list[dict]:
    """
    Extrae entradas ROM del HTML de una página de listado o búsqueda.

    Estrategia de dos pasadas:
      1. Regex compleja (img + título): extrae imagen real del cover.
      2. Fallback suelto: cualquier URL /roms/{sys}/{slug}.html no capturada
         todavía → deriva el nombre del slug.
    """
    results: list[dict] = []
    seen: set[str]      = set()

    # --- Pasada 1: regex estricta con imagen y título -----------------------
    if system_filter:
        strict_pat = re.compile(
            rf'href="(https://romsfun\.com/roms/{re.escape(system_filter)}/[^"]+\.html)"'
            r'[^>]*>\s*<img[^>]+src="([^"]+)"[^>]*/?>.*?'
            r'href="https://romsfun\.com/roms/[^"]+\.html"[^>]*>([^<]+)</a>',
            re.DOTALL,
        )
    else:
        strict_pat = re.compile(
            r'href="(https://romsfun\.com/roms/[^"]+\.html)"'
            r'[^>]*>\s*<img[^>]+src="([^"]+)"[^>]*/?>.*?'
            r'href="https://romsfun\.com/roms/[^"]+\.html"[^>]*>([^<]+)</a>',
            re.DOTALL,
        )

    for m in strict_pat.finditer(html):
        url, img, title = m.group(1), m.group(2), m.group(3)
        if url in seen:
            continue
        seen.add(url)

        sys_m = re.search(r'/roms/([^/]+)/', url)
        slug  = sys_m.group(1) if sys_m else ""
        rom_id = url.rstrip("/").split("/")[-1].replace(".html", "")

        results.append({
            "id":                rom_id,
            "name":              unescape(title.strip()),
            "url":               url,
            "system":            slug,
            "platform":          SYSTEMS.get(slug, slug.replace("-", " ").title()),
            "image_url":         img,
            "provider":          PROVIDER,
            "download_page_url": None,
            "download_url":      None,
        })

    # --- Pasada 2: fallback suelto — cualquier enlace de ROM no capturado ---
    if system_filter:
        loose_pat = re.compile(
            rf'href="(https://romsfun\.com/roms/{re.escape(system_filter)}/[^"]+\.html)"'
        )
    else:
        loose_pat = re.compile(
            r'href="(https://romsfun\.com/roms/([^/]+)/[^"]+\.html)"'
        )

    for m2 in loose_pat.finditer(html):
        url2 = m2.group(1)
        if url2 in seen:
            continue
        seen.add(url2)

        sys_m2 = re.search(r'/roms/([^/]+)/', url2)
        slug2  = sys_m2.group(1) if sys_m2 else ""
        rom_id2 = url2.rstrip("/").split("/")[-1].replace(".html", "")

        # Derivar nombre legible del slug
        name2 = _url_unquote(rom_id2).replace("-", " ").replace("_", " ").title()

        results.append({
            "id":                rom_id2,
            "name":              name2,
            "url":               url2,
            "system":            slug2,
            "platform":          SYSTEMS.get(slug2, slug2.replace("-", " ").title()),
            "image_url":         None,
            "provider":          PROVIDER,
            "download_page_url": None,
            "download_url":      None,
        })

    return results


def _extract_image(html: str) -> Optional[str]:
    """
    Extrae la URL de portada de una página detalle de romsfun.com.
    Excluye logotipos y favicons.
    """
    for img in re.findall(
        r'src="(https://romsfun\.com/wp-content/uploads/\d{4}/\d{2}/[^"]+\.(?:jpg|jpeg|png|webp))"',
        html, re.I,
    ):
        low = img.lower()
        if "logo" not in low and "cropped" not in low and "favicon" not in low:
            return img
    return None


def _resolve_file_url(session: requests.Session, file_page_url: str) -> str:
    """
    Visita la página de archivo (/download/{slug}-{id}/N) y obtiene la URL CDN:
    1. Extrae la URL pre-incrustada (si no está caducada)
    2. Si está caducada o ausente, llama al AJAX k_get_download
    """
    r = _rf_get(session, file_page_url, timeout=30, headers={"Referer": BASE_URL})
    html = r.text

    # Intentar URL pre-incrustada en #download-link
    embedded = re.search(
        r'id="download-link"[^>]+href="([^"]*' + re.escape(CDN_HOST) + r'[^"]*)"',
        html,
    )
    if embedded:
        url = unescape(embedded.group(1))
        exp_m = re.search(r'[?&]e=(\d+)', url)
        if exp_m and int(exp_m.group(1)) > int(time.time()) + 60:
            return url  # aún vigente

    # Llamar AJAX para obtener URL fresca
    ajax_resp = _rf_post(
        session,
        AJAX_URL,
        data={"action": "k_get_download"},
        headers={
            "Content-Type":     "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer":          file_page_url,
            "Origin":           BASE_URL,
            "Accept":           "application/json, text/javascript, */*; q=0.01",
        },
        timeout=30,
    )
    data = ajax_resp.json()

    if not data.get("success"):
        raise RuntimeError(f"k_get_download falló: {data}")

    snippet = data["data"]["html"]

    # Extraer href del CDN principal
    cdn_m = re.search(rf'href="([^"]*{re.escape(CDN_HOST)}[^"]*)"', snippet)
    if cdn_m:
        return unescape(cdn_m.group(1))

    # Fallback: CDN alternativo (statics.romsfun.com)
    alt_m = re.search(r'href="(https://statics\.romsfun\.com/[^"]+)"', snippet)
    if alt_m:
        return unescape(alt_m.group(1))

    # Fallback final: cualquier href en el snippet
    any_href = re.search(r'href="(https?://[^"]+)"', snippet)
    if any_href:
        return unescape(any_href.group(1))

    raise ValueError(f"No se encontró URL CDN en respuesta AJAX:\n{snippet[:300]}")


# ---------------------------------------------------------------------------
# CLI / test rápido
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    session = create_session()

    print("=== romsfun.com — Test de integración ===\n")

    # 1. Búsqueda paginada
    print("[1] Búsqueda: 'sonic genesis'  (hasta 3 páginas)")
    results = search_roms(session, "sonic genesis", max_pages=3)
    print(f"    {len(results)} resultados")
    for r in results[:3]:
        print(f"    • {r['name']}  [{r['platform']}]  {r['url']}")

    if not results:
        print("    Sin resultados — saliendo.")
        sys.exit(1)

    # 2. Descarga del primer resultado
    test_url = results[0]["url"]
    print(f"\n[2] URL de descarga para: {results[0]['name']}")
    try:
        dl_url = get_download_url(session, test_url)
        print(f"    CDN URL: {dl_url[:80]}…")
    except Exception as e:
        print(f"    ERROR: {e}")

    # 3. Imagen de portada
    print(f"\n[3] Imagen de portada")
    img = get_rom_image(session, test_url)
    print(f"    {img or 'No encontrada'}")

    # 4. Listado de sistema
    print("\n[4] Listado de Sega Genesis (primera página)")
    roms = list_roms(session, "sega-genesis")
    print(f"    {len(roms)} ROMs en primera página")
    for r in roms[:5]:
        print(f"    • {r['name']}  img={'✓' if r['image_url'] else '✗'}")
