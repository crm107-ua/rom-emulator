#!/usr/bin/env python3
"""
CoolROM.com Direct Download Link Fetcher — con auto-renovación de token
========================================================================

Cómo funciona:
  1. Cada ROM se representa como un objeto RomLink (sistema + id + nombre).
  2. RomLink.get_url(session) devuelve siempre una URL válida:
       • Si el token almacenado en caché sigue vigente, lo reutiliza.
       • Si el token está caducado (o nunca se obtuvo), obtiene automáticamente
         una URL nueva desde la página HTML del ROM.
  3. download_rom() usa RomLink internamente: si recibe un 403/410 durante la
     descarga (token revocado antes de expirar) renueva el token y reintenta
     una vez en transparencia total para el llamador.

Los tokens duran ~12 horas. No se requiere cuenta ni contraseña.
"""

from __future__ import annotations

import re
import os
import sys
import time
import requests
from dataclasses import dataclass, field
from html import unescape as html_unescape
from urllib.parse import unquote, urlparse
from typing import Optional


# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

SESSION_COOKIES: dict[str, str] = {
    "lang": "es",
    "csrf": "6f54610ed77aaf3309660ada0d500cb7",
}

BASE_URL    = "https://coolrom.com"
DLC_BASE    = "https://dlc.coolrom.com"

# Margen de seguridad: renovar el token si quedan menos de 5 minutos
_EXPIRY_MARGIN_SECS = 300

REQUEST_HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/156.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;"
        "q=0.9,image/avif,image/webp,*/*;q=0.8"
    ),
    "Accept-Language": "es-ES,es;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest":  "document",
    "Sec-Fetch-Mode":  "navigate",
    "Sec-Fetch-Site":  "none",
    "Sec-Fetch-User":  "?1",
    "sec-ch-ua":          '"Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"',
    "sec-ch-ua-mobile":   "?0",
    "sec-ch-ua-platform": '"Windows"',
}


# ---------------------------------------------------------------------------
# Sesión HTTP
# ---------------------------------------------------------------------------

def create_session() -> requests.Session:
    """Devuelve una sesión con cabeceras y cookies ya configuradas."""
    s = requests.Session()
    s.headers.update(REQUEST_HEADERS)
    s.cookies.update(SESSION_COOKIES)
    return s


# ---------------------------------------------------------------------------
# RomLink — identidad + caché de URL con auto-renovación
# ---------------------------------------------------------------------------

@dataclass
class RomLink:
    """
    Referencia a un ROM de CoolROM que gestiona automáticamente su token.

    Atributos públicos:
        system   — slug del sistema  (p. ej. 'genesis', 'psx', 'gba')
        rom_id   — ID numérico       (p. ej. 1283)
        rom_name — nombre en la URL  (p. ej. 'Sonic_the_Hedgehog')

    Uso:
        link = RomLink("genesis", 1283, "Sonic_the_Hedgehog")
        url  = link.get_url(session)   # siempre válida
    """

    system:   str
    rom_id:   int
    rom_name: str

    # campos internos de caché (no forman parte de la identidad)
    _cached_url: Optional[str]  = field(default=None, repr=False, compare=False)
    _expiry:     Optional[int]  = field(default=None, repr=False, compare=False)

    # ---- propiedades --------------------------------------------------------

    @property
    def page_url(self) -> str:
        return f"{BASE_URL}/roms/{self.system}/{self.rom_id}/{self.rom_name}.php"

    @property
    def is_token_valid(self) -> bool:
        """True si el token cacheado sigue siendo válido (con margen de 5 min)."""
        if not self._cached_url or self._expiry is None:
            return False
        return int(time.time()) < (self._expiry - _EXPIRY_MARGIN_SECS)

    # ---- renovación ---------------------------------------------------------

    def _fetch_fresh_url(self, session: requests.Session) -> str:
        """
        Accede a la página del ROM y extrae una URL de descarga nueva.
        Lanza RuntimeError si no encuentra la URL en el HTML.
        """
        resp = session.get(self.page_url, timeout=30)
        resp.raise_for_status()

        url = _extract_download_url_from_html(resp.text)
        if not url:
            raise RuntimeError(
                f"No se encontró URL de descarga en la página: {self.page_url}"
            )

        # Guardar en caché junto con su fecha de expiración
        self._cached_url = url
        info = _parse_url(url)
        self._expiry = info.get("expiry")
        return url

    def get_url(self, session: requests.Session) -> str:
        """
        Devuelve una URL de descarga CDN siempre válida.

        • Si la URL cacheada sigue siendo válida, la reutiliza sin red.
        • Si está caducada (o no hay caché), la renueva automáticamente.
        """
        if self.is_token_valid:
            return self._cached_url  # type: ignore[return-value]

        # Token caducado o no inicializado → renovar
        expires_in: Optional[int] = None
        if self._expiry:
            expires_in = self._expiry - int(time.time())
        if expires_in is not None and expires_in <= 0:
            print(f"  [RomLink] Token caducado para '{self.rom_name}', renovando…")
        else:
            print(f"  [RomLink] Obteniendo URL para '{self.rom_name}'…")

        return self._fetch_fresh_url(session)

    def invalidate(self) -> None:
        """Fuerza la renovación del token en la próxima llamada a get_url()."""
        self._cached_url = None
        self._expiry     = None


# ---------------------------------------------------------------------------
# Funciones de bajo nivel (HTML / URL)
# ---------------------------------------------------------------------------

def _extract_download_url_from_html(html: str) -> Optional[str]:
    """Extrae la URL CDN firmada que el servidor incrusta en el HTML del ROM."""
    pattern = r'https?://dlc\.coolrom\.com/roms/[^\s"\'<>]+'
    matches = re.findall(pattern, html)
    if matches:
        return matches[0].rstrip('"\' >')
    return None


def _parse_url(url: str) -> dict:
    """
    Descompone una URL CDN en sus partes.

    Ruta: /roms/{system}/{filename}.zip/{token}/{expiry}/{size_param}/{disk}/
    """
    parts = urlparse(url).path.strip('/').split('/')
    return {
        "system":     parts[1] if len(parts) > 1 else None,
        "filename":   unquote(parts[2]) if len(parts) > 2 else None,
        "token":      parts[3] if len(parts) > 3 else None,
        "expiry":     int(parts[4]) if len(parts) > 4 and parts[4].isdigit() else None,
        "size_param": parts[5] if len(parts) > 5 else None,
        "disk":       parts[6] if len(parts) > 6 else "1",
    }


# ---------------------------------------------------------------------------
# API pública de alto nivel
# ---------------------------------------------------------------------------

def get_direct_download_url(
    session:  requests.Session,
    system:   str,
    rom_id:   int,
    rom_name: str,
) -> str:
    """
    Obtiene una URL de descarga CDN siempre fresca.

    Atajo equivalente a:
        RomLink(system, rom_id, rom_name).get_url(session)
    """
    return RomLink(system, rom_id, rom_name).get_url(session)


def download_rom(
    session:      requests.Session,
    rom_or_url:   "str | RomLink",
    output_dir:   str = ".",
    filename:     Optional[str] = None,
    chunk_size:   int = 65536,
    show_progress: bool = True,
) -> str:
    """
    Descarga un ROM en disco con renovación automática de token.

    Args:
        session:       Sesión HTTP activa.
        rom_or_url:    RomLink (recomendado) o URL de descarga directa.
                       Si se pasa una URL y recibe 403/410, la función no puede
                       renovar el token (no tiene la identidad del ROM).
                       Con RomLink, la renovación es completamente automática.
        output_dir:    Carpeta de destino (se crea si no existe).
        filename:      Nombre de fichero; por defecto se toma de la URL.
        chunk_size:    Tamaño de cada bloque de descarga en bytes.
        show_progress: Muestra el progreso en stdout.

    Returns:
        Ruta absoluta al fichero descargado.

    Raises:
        RuntimeError   si falla tras renovación de token.
        requests.HTTPError para otros errores HTTP.
    """
    dl_headers = {
        "Referer":        "https://coolrom.com/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-site",
    }

    link: Optional[RomLink] = None
    if isinstance(rom_or_url, RomLink):
        link = rom_or_url

    def _attempt(url: str) -> requests.Response:
        r = session.get(url, headers=dl_headers, stream=True,
                        timeout=60, allow_redirects=True)
        r.raise_for_status()
        return r

    # Primer intento
    if link:
        url = link.get_url(session)
    else:
        url = rom_or_url  # type: ignore[assignment]

    try:
        resp = _attempt(url)
    except requests.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else 0
        # Token revocado antes de caducar → renovar y reintentar una vez
        if code in (401, 403, 410) and link is not None:
            print(f"  [download_rom] HTTP {code} — renovando token y reintentando…")
            link.invalidate()
            url = link.get_url(session)
            resp = _attempt(url)
        else:
            raise

    # ----- determinar nombre del fichero -----
    if not filename:
        content_disp = resp.headers.get("Content-Disposition", "")
        if "filename=" in content_disp:
            filename = content_disp.split("filename=")[-1].strip('" ')
        else:
            parts = urlparse(url).path.strip('/').split('/')
            filename = unquote(parts[2]) if len(parts) > 2 else "rom.zip"

    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, filename)

    total      = int(resp.headers.get("Content-Length", 0))
    downloaded = 0

    with open(output_path, "wb") as fh:
        for chunk in resp.iter_content(chunk_size=chunk_size):
            if chunk:
                fh.write(chunk)
                downloaded += len(chunk)
                if show_progress and total:
                    pct = downloaded / total * 100
                    print(f"\r  {pct:5.1f}%  {downloaded:,} / {total:,} bytes",
                          end="", flush=True)

    if show_progress and total:
        print()

    return os.path.abspath(output_path)


# ---------------------------------------------------------------------------
# Listados
# ---------------------------------------------------------------------------

def list_roms_for_system(
    session:      requests.Session,
    system:       str,
    letter:       str = "",
    resolve_urls: bool = False,
    delay:        float = 0.3,
) -> list[dict]:
    """
    Devuelve los ROMs del sistema filtrados por letra inicial.

    Args:
        system:       slug del sistema (p. ej. 'genesis')
        letter:       'a'–'z', '0' para números, '' para la página principal
        resolve_urls: si True, obtiene el enlace de descarga directa de cada ROM
                      (hace una petición HTTP por ítem — usar con moderación)
        delay:        segundos de espera entre peticiones cuando resolve_urls=True

    Returns:
        Lista de dicts: { id, name, url_name, system, page_url, link, download_url }
        • 'link'         — RomLink listo para usar (siempre presente)
        • 'download_url' — URL de descarga directa (solo si resolve_urls=True,
                           None si falla la obtención)
    """
    base = f"{BASE_URL}/roms/{system}/{letter}/" if letter else f"{BASE_URL}/roms/{system}/"
    resp = session.get(base, timeout=30)
    resp.raise_for_status()

    pattern = rf'/roms/{re.escape(system)}/(\d+)/([^"\'<]+?)\.php'
    seen: set[str] = set()
    roms: list[dict] = []

    for rom_id, rom_name in re.findall(pattern, resp.text):
        key = f"{rom_id}_{rom_name}"
        if key in seen:
            continue
        seen.add(key)
        # Decode HTML entities (&#039; → ', &amp; → &, &amp;amp; → &, etc.)
        # so the URL we build actually matches what the server expects
        clean_name = html_unescape(html_unescape(rom_name))
        roms.append({
            "id":           int(rom_id),
            "name":         unquote(clean_name).replace("_", " "),
            "url_name":     clean_name,
            "system":       system,
            "page_url":     f"{BASE_URL}/roms/{system}/{rom_id}/{clean_name}.php",
            "link":         RomLink(system, int(rom_id), clean_name),
            "download_url": None,
        })

    if resolve_urls:
        print(f"  Resolviendo URLs de descarga para {len(roms)} ROMs…")
        for i, rom in enumerate(roms):
            try:
                rom["download_url"] = rom["link"].get_url(session)
            except Exception as exc:
                print(f"  ⚠  [{rom['id']}] {rom['name']}: {exc}")
                rom["download_url"] = None
            if delay and i < len(roms) - 1:
                time.sleep(delay)

    return roms


# ---------------------------------------------------------------------------
# Demo / test
# ---------------------------------------------------------------------------

def main() -> None:
    session = create_session()

    print("=" * 62)
    print("  CoolROM.com — Direct Download con Auto-renovación de Token")
    print("=" * 62)
    print()

    # ── 1. Obtener URL y mostrar estado del token ──────────────────────────
    print("[1] Sonic the Hedgehog (Sega Genesis, ID 1283)")
    link1 = RomLink("genesis", 1283, "Sonic_the_Hedgehog")
    url1  = link1.get_url(session)
    info1 = _parse_url(url1)
    exp1  = info1.get("expiry", 0) or 0
    rem   = max(0, exp1 - int(time.time()))
    print(f"    URL    : {url1}")
    print(f"    Token  : {info1['token']}")
    print(f"    Expira : {exp1}  ({rem // 3600}h {(rem % 3600) // 60}m restantes)")
    print(f"    Válida : {link1.is_token_valid}")
    print()

    # ── 2. Simular token caducado → renovación automática ─────────────────
    print("[2] Simulando token caducado en link1…")
    link1._expiry = int(time.time()) - 1          # forzar expiración
    assert not link1.is_token_valid, "debería estar caducado"
    url1_renewed = link1.get_url(session)         # debe renovar solo
    print(f"    Nueva URL: {url1_renewed[:80]}…")
    print(f"    Válida    : {link1.is_token_valid}")
    print()

    # ── 3. Streets of Rage ────────────────────────────────────────────────
    print("[3] Streets of Rage (Sega Genesis, ID 1213)")
    link2 = RomLink("genesis", 1213, "Streets_of_Rage")
    url2  = link2.get_url(session)
    print(f"    URL   : {url2}")
    print(f"    Válida: {link2.is_url_valid if hasattr(link2, 'is_url_valid') else link2.is_token_valid}")
    print()

    # ── 4. HEAD request al CDN para verificar que sirve bytes ─────────────
    print("[4] Verificando que la URL CDN devuelve bytes reales (HEAD)…")
    head = session.head(url1_renewed,
                        headers={"Referer": "https://coolrom.com/"},
                        timeout=15, allow_redirects=True)
    ct = head.headers.get("Content-Type", "?")
    cl = head.headers.get("Content-Length", "?")
    print(f"    HTTP {head.status_code}  Content-Type: {ct}  Content-Length: {cl}")
    if head.status_code == 200:
        print("    ✓ URL activa y sirviendo datos")
    else:
        print(f"    ✗ Estado inesperado {head.status_code}")
        sys.exit(1)
    print()

    # ── 5. Listado de ROMs con enlace de descarga directa por ítem ──────────
    print("[5] ROMs en Genesis / letra S  (resolve_urls=True → URL directa por ítem)")
    roms = list_roms_for_system(session, "genesis", "s",
                                resolve_urls=True, delay=0.25)[:5]
    print()
    for rom in roms:
        dl = rom["download_url"] or "— no obtenida —"
        valid = rom["link"].is_token_valid if rom["download_url"] else False
        print(f"  [{rom['id']:>6}]  {rom['name']}")
        print(f"           download_url : {dl}")
        print(f"           token válido : {valid}")
        print()

    print("Todos los tests completados.")


if __name__ == "__main__":
    main()
