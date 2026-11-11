#!/usr/bin/env python3
"""
Multi-provider ROM API Client
Providers: CoolROM (coolrom.com) · RomsFun (romsfun.com)

- Sistema unificado sin duplicados: cada sistema mapea a qué proveedor(es) lo tienen
  y cuál es su slug en cada uno.
- list_endpoints() documenta todas las operaciones disponibles en tiempo de ejecución.
- CoolROM: completamente funcional (scraping + URLs firmadas).
- RomsFun: implementado; requiere cookies Cloudflare válidas del navegador del usuario
  (Turnstile bot-check — no bypasseable con requests simples).

Run: python api_client.py
"""

from __future__ import annotations

import os
import re
import sys
from typing import Optional
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

# ─────────────────────────────────────────────────────────────────────────────
# Catálogo unificado de sistemas (sin duplicados)
#
# Estructura de cada entrada:
#   "nombre_canónico": {
#       "providers": {
#           "coolrom": "slug_en_coolrom",   # None si no está disponible
#           "romsfun": "slug_en_romsfun",   # None si no está disponible
#       }
#   }
# ─────────────────────────────────────────────────────────────────────────────

SYSTEMS: dict[str, dict] = {
    # ── Atari ──────────────────────────────────────────────────────────────
    "Atari 2600": {
        "providers": {"coolrom": "atari2600",   "romsfun": "atari-2600"}
    },
    "Atari 5200": {
        "providers": {"coolrom": "atari5200",   "romsfun": None}
    },
    "Atari 7800": {
        "providers": {"coolrom": "atari7800",   "romsfun": "atari-7800"}
    },
    "Atari Jaguar": {
        "providers": {"coolrom": "atarijaguar", "romsfun": "atari-jaguar"}
    },
    "Atari Lynx": {
        "providers": {"coolrom": "atarilynx",   "romsfun": "atari-lynx"}
    },
    # ── Commodore ──────────────────────────────────────────────────────────
    "Commodore 64": {
        "providers": {"coolrom": "c64",         "romsfun": None}
    },
    # ── Arcade ─────────────────────────────────────────────────────────────
    "CPS1": {
        "providers": {"coolrom": "cps1",        "romsfun": None}
    },
    "CPS2": {
        "providers": {"coolrom": "cps2",        "romsfun": None}
    },
    "MAME": {
        "providers": {"coolrom": "mame",        "romsfun": "mame"}
    },
    "Namco System 22": {
        "providers": {"coolrom": "namcosystem22","romsfun": None}
    },
    # ── Neo Geo ────────────────────────────────────────────────────────────
    "Neo Geo": {
        "providers": {"coolrom": "neogeo",      "romsfun": "neo-geo"}
    },
    "Neo Geo CD": {
        "providers": {"coolrom": "neogeocd",    "romsfun": "neo-geo-cd"}
    },
    "Neo Geo Pocket": {
        "providers": {"coolrom": "neogeopocket","romsfun": "neo-geo-pocket"}
    },
    # ── Nintendo (solo RomsFun) ────────────────────────────────────────────
    "NES": {
        "providers": {"coolrom": None,          "romsfun": "nes"}
    },
    "Super Nintendo": {
        "providers": {"coolrom": None,          "romsfun": "super-nintendo"}
    },
    "Nintendo 64": {
        "providers": {"coolrom": None,          "romsfun": "nintendo-64"}
    },
    "GameCube": {
        "providers": {"coolrom": None,          "romsfun": "gamecube"}
    },
    "Nintendo Wii": {
        "providers": {"coolrom": None,          "romsfun": "nintendo-wii"}
    },
    "Wii U": {
        "providers": {"coolrom": None,          "romsfun": "wii-u"}
    },
    "Game Boy": {
        "providers": {"coolrom": None,          "romsfun": "game-boy"}
    },
    "Game Boy Color": {
        "providers": {"coolrom": None,          "romsfun": "game-boy-color"}
    },
    "Game Boy Advance": {
        "providers": {"coolrom": None,          "romsfun": "game-boy-advance"}
    },
    "Nintendo DS": {
        "providers": {"coolrom": None,          "romsfun": "nintendo-ds"}
    },
    "Nintendo 3DS": {
        "providers": {"coolrom": None,          "romsfun": "nintendo-3ds"}
    },
    "Nintendo Pokémon Mini": {
        "providers": {"coolrom": None,          "romsfun": "pokemon-mini"}
    },
    "Nintendo Virtual Boy": {
        "providers": {"coolrom": None,          "romsfun": "virtual-boy"}
    },
    # ── Sega ───────────────────────────────────────────────────────────────
    "Sega Master System": {
        "providers": {"coolrom": "mastersystem","romsfun": "sega-master-system"}
    },
    "Sega Genesis": {
        "providers": {"coolrom": "genesis",     "romsfun": "sega-genesis"}
    },
    "Sega CD": {
        "providers": {"coolrom": "segacd",      "romsfun": "sega-cd"}
    },
    "Sega Saturn": {
        "providers": {"coolrom": "saturn",      "romsfun": "sega-saturn"}
    },
    "Sega Dreamcast": {
        "providers": {"coolrom": "dc",          "romsfun": "sega-dreamcast"}
    },
    "Sega Game Gear": {
        "providers": {"coolrom": "gamegear",    "romsfun": "sega-game-gear"}
    },
    "Sega Model 2": {
        "providers": {"coolrom": "model2",      "romsfun": None}
    },
    # ── Sony ───────────────────────────────────────────────────────────────
    "PlayStation": {
        "providers": {"coolrom": "psx",         "romsfun": "playstation"}
    },
    "PlayStation 2": {
        "providers": {"coolrom": "ps2",         "romsfun": "playstation-2"}
    },
    "PlayStation 3": {
        "providers": {"coolrom": "ps3",         "romsfun": "playstation-3"}
    },
    "PlayStation 4": {
        "providers": {"coolrom": None,          "romsfun": "playstation-4"}
    },
    "PSP": {
        "providers": {"coolrom": "psp",         "romsfun": "psp"}
    },
    "PS Vita": {
        "providers": {"coolrom": None,          "romsfun": "ps-vita"}
    },
    # ── Microsoft ─────────────────────────────────────────────────────────
    "Xbox": {
        "providers": {"coolrom": None,          "romsfun": "xbox"}
    },
    "Xbox 360": {
        "providers": {"coolrom": "xbox360",     "romsfun": "xbox-360"}
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# Helpers: consultar el catálogo
# ─────────────────────────────────────────────────────────────────────────────

def systems_for_provider(provider: str) -> dict[str, str]:
    """
    Devuelve {nombre_canónico: slug} para todos los sistemas que tiene *provider*.
    """
    return {
        name: info["providers"][provider]
        for name, info in SYSTEMS.items()
        if info["providers"].get(provider) is not None
    }


def providers_for_system(system_name: str) -> dict[str, str]:
    """
    Devuelve {proveedor: slug} para todos los proveedores que tienen *system_name*.
    """
    info = SYSTEMS.get(system_name)
    if not info:
        return {}
    return {p: s for p, s in info["providers"].items() if s is not None}


# ─────────────────────────────────────────────────────────────────────────────
# Registro de endpoints (meta-API)
# ─────────────────────────────────────────────────────────────────────────────

ENDPOINTS: list[dict] = [
    # ── Catálogo ────────────────────────────────────────────────────────────
    {
        "id":       "list_systems",
        "provider": "*",
        "method":   "GET",
        "url":      "(local)",
        "desc":     "Lista todos los sistemas del catálogo unificado (sin duplicados). "
                    "Indica qué proveedor(es) tienen cada sistema.",
        "params":   {"provider": "opcional — filtra por proveedor: 'coolrom' | 'romsfun'"},
        "fn":       "list_systems(provider=None)",
    },
    {
        "id":       "list_endpoints",
        "provider": "*",
        "method":   "GET",
        "url":      "(local)",
        "desc":     "Devuelve este mismo listado de endpoints disponibles.",
        "params":   {},
        "fn":       "list_endpoints()",
    },
    # ── CoolROM ─────────────────────────────────────────────────────────────
    {
        "id":       "coolrom.get_systems",
        "provider": "coolrom",
        "method":   "GET",
        "url":      "https://coolrom.com/roms/",
        "desc":     "Obtiene el listado de sistemas scrapeando la página principal de ROMs.",
        "params":   {},
        "fn":       "CoolROMClient().get_systems()",
    },
    {
        "id":       "coolrom.list_roms",
        "provider": "coolrom",
        "method":   "GET",
        "url":      "https://coolrom.com/roms/{system}/[{letter}/|all/]",
        "desc":     "Lista ROMs de un sistema. Filtra por letra inicial o devuelve todos.",
        "params":   {
            "system":   "slug del sistema, ej. 'psx'",
            "letter":   "opcional — 'a'–'z' o '0' para números",
            "all_roms": "si True usa /all/ (lista completa)",
        },
        "fn":       "CoolROMClient().list_roms(system, letter=None, all_roms=False)",
    },
    {
        "id":       "coolrom.search",
        "provider": "coolrom",
        "method":   "GET",
        "url":      "https://coolrom.com/search?q={q}&system={s}&sort={sort}&dir={dir}",
        "desc":     "Busca ROMs por nombre. Filtra opcionalmente por sistema.",
        "params":   {
            "query":     "texto a buscar",
            "system":    "opcional — slug del sistema",
            "sort":      "'name' | 'downloads'  (default 'downloads')",
            "direction": "'asc' | 'desc'",
        },
        "fn":       "CoolROMClient().search_roms(query, system=None, sort='downloads', direction='desc')",
    },
    {
        "id":       "coolrom.get_rom_info",
        "provider": "coolrom",
        "method":   "GET",
        "url":      "https://coolrom.com/roms/{system}/{id}/{name}.php",
        "desc":     "Obtiene metadatos del juego y extrae la URL de descarga firmada "
                    "(incrustada en el JS de la página).",
        "params":   {
            "system":        "slug del sistema, ej. 'psx'",
            "rom_id":        "ID numérico, ej. 39719",
            "rom_name_slug": "slug URL, ej. 'Tekken_3'",
        },
        "fn":       "CoolROMClient().get_rom_info(system, rom_id, rom_name_slug)",
    },
    {
        "id":       "coolrom.get_download_url",
        "provider": "coolrom",
        "method":   "GET",
        "url":      "https://coolrom.com/roms/{system}/{id}/{name}.php",
        "desc":     "Atajo: sólo devuelve la URL firmada de descarga del juego.",
        "params":   {
            "system":        "slug del sistema",
            "rom_id":        "ID numérico",
            "rom_name_slug": "slug URL",
        },
        "fn":       "CoolROMClient().get_download_url(system, rom_id, rom_name_slug)",
    },
    {
        "id":       "coolrom.download_rom",
        "provider": "coolrom",
        "method":   "GET",
        "url":      "https://dlc.coolrom.com/roms/{system}/{file}/{token}/{ts}/{n}/{v}/?r=...",
        "desc":     "Descarga el archivo ROM a disco. Usa streaming. "
                    "La URL firmada expira — obtenerla fresca antes de descargar.",
        "params":   {
            "download_url": "URL firmada obtenida con get_download_url()",
            "output_path":  "ruta local (directorio o fichero completo)",
            "chunk_size":   "tamaño de chunk en bytes (default 65536)",
        },
        "fn":       "CoolROMClient().download_rom(download_url, output_path)",
    },
    # ── RomsFun ─────────────────────────────────────────────────────────────
    {
        "id":       "romsfun.list_roms",
        "provider": "romsfun",
        "method":   "GET",
        "url":      "https://romsfun.com/roms/{system}/",
        "desc":     "Lista ROMs de un sistema en RomsFun. "
                    "⚠ Requiere cookies Cloudflare válidas (Turnstile).",
        "params":   {
            "system":    "slug del sistema, ej. 'playstation'",
            "page":      "número de página (default 1)",
        },
        "fn":       "RomsFunClient().list_roms(system, page=1)",
    },
    {
        "id":       "romsfun.search",
        "provider": "romsfun",
        "method":   "GET",
        "url":      "https://romsfun.com/search/?q={q}",
        "desc":     "Busca ROMs en RomsFun. ⚠ Requiere cookies Cloudflare.",
        "params":   {"query": "texto a buscar"},
        "fn":       "RomsFunClient().search_roms(query)",
    },
    {
        "id":       "romsfun.get_rom_info",
        "provider": "romsfun",
        "method":   "GET",
        "url":      "https://romsfun.com/roms/{system}/{slug}/",
        "desc":     "Metadatos y URL de descarga de un juego en RomsFun. "
                    "⚠ Requiere cookies Cloudflare.",
        "params":   {
            "system": "slug del sistema",
            "slug":   "slug del juego, ej. 'tekken-3'",
        },
        "fn":       "RomsFunClient().get_rom_info(system, slug)",
    },
]


def list_endpoints(provider: Optional[str] = None) -> list[dict]:
    """
    Devuelve la lista completa de endpoints disponibles en este cliente.

    Parameters
    ----------
    provider : opcional — filtra por 'coolrom', 'romsfun' o '*' (global)
    """
    if provider is None:
        return ENDPOINTS
    return [e for e in ENDPOINTS if e["provider"] in (provider, "*")]


def list_systems(provider: Optional[str] = None) -> list[dict]:
    """
    Devuelve el catálogo unificado de sistemas (sin duplicados).

    Parameters
    ----------
    provider : opcional — filtra mostrando sólo sistemas disponibles en ese proveedor

    Returns list of:
      {"name": str, "providers": {"coolrom": slug|None, "romsfun": slug|None}}
    """
    result = []
    for name, info in SYSTEMS.items():
        provs = info["providers"]
        if provider and provs.get(provider) is None:
            continue
        result.append({"name": name, "providers": provs})
    return result


# ─────────────────────────────────────────────────────────────────────────────
# CoolROM client
# ─────────────────────────────────────────────────────────────────────────────

COOLROM_BASE = "https://coolrom.com"
COOLROM_DLC  = "https://dlc.coolrom.com"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
}

# modal_cookie=yes + count=9999 → omite el modal de Opera GX sin clics extra
_COOLROM_COOKIES = {
    "lang":         "en",
    "modal_cookie": "yes",
    "count":        "9999",
    "csrf":         "6f54610ed77aaf3309660ada0d500cb7",
}


class CoolROMClient:
    """
    Cliente HTTP para coolrom.com.

    Endpoints clave
    ---------------
    GET /roms/                                    → lista de sistemas
    GET /roms/{system}/                           → top-50 + destacados
    GET /roms/{system}/{letter}/                  → por letra inicial (a-z, 0)
    GET /roms/{system}/all/                       → lista completa del sistema
    GET /search?q=...&system=...&sort=...&dir=... → búsqueda
    GET /roms/{system}/{id}/{name}.php            → página del juego (URL firmada)
    GET https://dlc.coolrom.com/roms/...          → descarga del archivo
    """

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(_HEADERS)
        for k, v in _COOLROM_COOKIES.items():
            self.session.cookies.set(k, v, domain="coolrom.com")

    # ── Sistemas ─────────────────────────────────────────────────────────

    def get_systems(self) -> list[dict]:
        """Lista de sistemas disponibles en CoolROM scrapeando /roms/."""
        resp = self.session.get(f"{COOLROM_BASE}/roms/", timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        slugs = {v: k for k, v in systems_for_provider("coolrom").items()}
        results, seen = [], set()
        for a in soup.select("a[href*='/roms/']"):
            href = a.get("href", "")
            m = re.match(r"(?:https?://coolrom\.com)?/roms/([a-z0-9]+)/$", href)
            if not m or m.group(1) not in slugs:
                continue
            slug = m.group(1)
            if slug in seen:
                continue
            seen.add(slug)
            text = a.get_text(" ", strip=True)
            cnt_m = re.search(r"([\d,]+)\s+t(?:ítulo|itle)", text)
            count = int(cnt_m.group(1).replace(",", "")) if cnt_m else 0
            results.append({
                "slug":  slug,
                "name":  slugs[slug],
                "count": count,
                "url":   f"{COOLROM_BASE}/roms/{slug}/",
            })
        return results

    # ── Listado ──────────────────────────────────────────────────────────

    def list_roms(
        self,
        system: str,
        letter: Optional[str] = None,
        all_roms: bool = False,
    ) -> list[dict]:
        """
        Lista ROMs de un sistema.

        system   : slug de CoolROM, ej. 'psx'
        letter   : 'a'–'z' o '0' para títulos numéricos
        all_roms : True → /all/ (devuelve todos los ROMs del sistema)
        """
        if all_roms:
            url = f"{COOLROM_BASE}/roms/{system}/all/"
        elif letter:
            url = f"{COOLROM_BASE}/roms/{system}/{letter.lower()}/"
        else:
            url = f"{COOLROM_BASE}/roms/{system}/"

        resp = self.session.get(url, timeout=30)
        resp.raise_for_status()
        return self._parse_rom_list(resp.text)

    def _parse_rom_list(self, html: str) -> list[dict]:
        soup = BeautifulSoup(html, "html.parser")
        results, seen = [], set()
        for a in soup.select("a[href*='/roms/']"):
            href = a.get("href", "")
            m = re.match(
                r"(?:https?://coolrom\.com)?/roms/([a-z0-9]+)/(\d+)/([^/]+\.php)$",
                href,
            )
            if not m:
                continue
            system, rom_id = m.group(1), int(m.group(2))
            if rom_id in seen:
                continue
            seen.add(rom_id)
            name = m.group(3).replace(".php", "").replace("_", " ")
            text = a.get_text(" ", strip=True)
            dl_m = re.search(r"([\d,]+)$", text)
            downloads = int(dl_m.group(1).replace(",", "")) if dl_m else 0
            full_url = href if href.startswith("http") else f"{COOLROM_BASE}{href}"
            results.append({
                "id": rom_id, "system": system, "name": name,
                "url": full_url, "downloads": downloads,
            })
        return results

    # ── Búsqueda ─────────────────────────────────────────────────────────

    def search_roms(
        self,
        query: str,
        system: Optional[str] = None,
        sort: str = "downloads",
        direction: str = "desc",
    ) -> list[dict]:
        """
        Busca ROMs.

        query     : texto libre
        system    : slug opcional, ej. 'psx'
        sort      : 'name' | 'downloads'
        direction : 'asc' | 'desc'
        """
        params: dict = {"q": query, "sort": sort, "dir": direction}
        if system:
            params["system"] = system
        resp = self.session.get(f"{COOLROM_BASE}/search", params=params, timeout=30)
        resp.raise_for_status()
        return self._parse_rom_list(resp.text)

    # ── Página del juego → URL firmada ───────────────────────────────────

    def get_rom_info(self, system: str, rom_id: int, rom_name_slug: str) -> dict:
        """
        Obtiene metadatos y URL firmada de descarga.

        system        : slug, ej. 'psx'
        rom_id        : ID numérico, ej. 39719
        rom_name_slug : slug URL, ej. 'Tekken_3'
        """
        page_url = f"{COOLROM_BASE}/roms/{system}/{rom_id}/{rom_name_slug}.php"
        resp = self.session.get(page_url, timeout=30)
        resp.raise_for_status()
        html = resp.text
        soup = BeautifulSoup(html, "html.parser")

        # Nombre
        name = ""
        h = soup.find("h1") or soup.find("h2")
        if h:
            name = h.get_text(strip=True)
        if not name:
            t = soup.find("title")
            if t:
                name = t.get_text(strip=True).split(" ROM")[0]

        # Formato y tamaño
        fmt_m  = re.search(r"\.(7z|zip|rar|iso|bin)\b", html, re.I)
        size_m = re.search(r"([\d,]+\.?\d*)\s*MB", html)
        fmt    = ("." + fmt_m.group(1).lower()) if fmt_m else ""
        size   = float(size_m.group(1).replace(",", "")) if size_m else 0.0

        # Descargas
        dl_m  = re.search(r"(?:Downloads|Descargas)[^0-9]+([\d,]+)", html)
        count = int(dl_m.group(1).replace(",", "")) if dl_m else 0

        return {
            "name":         name,
            "system":       system,
            "format":       fmt,
            "size_mb":      size,
            "downloads":    count,
            "download_url": self._extract_download_url(html),
            "page_url":     page_url,
            "provider":     "coolrom",
        }

    def _extract_download_url(self, html: str) -> Optional[str]:
        for pat in (
            r'window\.open\("(https://dlc\.coolrom\.com/[^"]+)"',
            r'href="(https://dlc\.coolrom\.com/[^"]+)"',
            r'(https://dlc\.coolrom\.com/roms/[^\s"\'<>]+)',
        ):
            m = re.search(pat, html)
            if m:
                return m.group(1)
        return None

    def get_download_url(self, system: str, rom_id: int, rom_name_slug: str) -> Optional[str]:
        """Atajo — devuelve sólo la URL firmada de descarga."""
        return self.get_rom_info(system, rom_id, rom_name_slug).get("download_url")

    # ── Descarga ─────────────────────────────────────────────────────────

    def download_rom(
        self,
        download_url: str,
        output_path: str,
        referer: Optional[str] = None,
        chunk_size: int = 65536,
    ) -> str:
        """
        Descarga un ROM en streaming.

        download_url : URL firmada de dlc.coolrom.com (expira — obtener fresca)
        output_path  : directorio o ruta completa del fichero destino
        """
        if not referer:
            r_m = re.search(r"[?&]r=([^&]+)", download_url)
            if r_m:
                from urllib.parse import unquote
                referer = COOLROM_BASE + unquote(r_m.group(1))

        resp = self.session.get(
            download_url,
            headers={**_HEADERS, "Referer": referer or COOLROM_BASE, "Sec-Fetch-Site": "cross-site"},
            stream=True, timeout=60, allow_redirects=True,
        )
        resp.raise_for_status()

        # Nombre del fichero
        cd = resp.headers.get("Content-Disposition", "")
        fname = None
        if cd:
            fn_m = re.search(r'filename="?([^";\n]+)"?', cd)
            if fn_m:
                fname = fn_m.group(1).strip()
        if not fname:
            from urllib.parse import unquote
            fname = unquote(download_url.split("?")[0].rstrip("/").split("/")[-1])
        if os.path.isdir(output_path):
            output_path = os.path.join(output_path, fname)

        total = int(resp.headers.get("Content-Length", 0))
        done  = 0
        with open(output_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=chunk_size):
                if chunk:
                    f.write(chunk)
                    done += len(chunk)
                    if total:
                        print(
                            f"\r  {done/total*100:5.1f}%  "
                            f"({done>>20} MB / {total>>20} MB)",
                            end="", flush=True,
                        )
        print()
        return output_path


# ─────────────────────────────────────────────────────────────────────────────
# RomsFun client
# ─────────────────────────────────────────────────────────────────────────────

ROMSFUN_BASE = "https://romsfun.com"


class RomsFunClient:
    """
    Cliente HTTP para romsfun.com.

    ⚠️  RomsFun usa Cloudflare Turnstile (verificación humana).
       Para que funcione hay que inyectar las cookies cf_clearance y __cf_bm
       obtenidas del navegador del usuario (Chrome, Firefox, etc.).

    Endpoints clave
    ---------------
    GET /roms/{system}/               → lista de ROMs del sistema
    GET /roms/{system}/?page={n}      → paginación
    GET /search/?q={q}                → búsqueda global
    GET /roms/{system}/{slug}/        → página del juego
    """

    # Cookies Cloudflare — reemplazar con las del navegador del usuario
    # para que las peticiones pasen la verificación Turnstile.
    CF_COOKIES: dict[str, str] = {
        "cf_clearance": "",   # obtener de DevTools → Application → Cookies
        "__cf_bm":      "",   # idem
    }

    def __init__(self, cf_cookies: Optional[dict] = None):
        self.session = requests.Session()
        self.session.headers.update({
            **_HEADERS,
            "Referer": ROMSFUN_BASE,
        })
        cookies = {**self.CF_COOKIES, **(cf_cookies or {})}
        for k, v in cookies.items():
            if v:
                self.session.cookies.set(k, v, domain="romsfun.com")

    def _check_cloudflare(self, resp: requests.Response) -> None:
        if "challenge" in resp.url or "Un momento" in resp.text[:500]:
            raise RuntimeError(
                "RomsFun bloqueado por Cloudflare Turnstile.\n"
                "Abre romsfun.com en tu navegador, pasa la verificación,\n"
                "luego copia 'cf_clearance' y '__cf_bm' de las cookies y\n"
                "pásalas a RomsFunClient(cf_cookies={'cf_clearance': '...', '__cf_bm': '...'})."
            )

    def list_roms(self, system: str, page: int = 1) -> list[dict]:
        """
        Lista ROMs de un sistema.

        system : slug de RomsFun, ej. 'playstation'
        page   : número de página (paginación de 30 resultados)
        """
        url    = f"{ROMSFUN_BASE}/roms/{system}/"
        params = {"page": page} if page > 1 else {}
        resp   = self.session.get(url, params=params, timeout=30)
        resp.raise_for_status()
        self._check_cloudflare(resp)
        return self._parse_rom_list(resp.text, system)

    def search_roms(self, query: str) -> list[dict]:
        """Búsqueda global en RomsFun."""
        resp = self.session.get(
            f"{ROMSFUN_BASE}/search/",
            params={"q": query},
            timeout=30,
        )
        resp.raise_for_status()
        self._check_cloudflare(resp)
        return self._parse_rom_list(resp.text)

    def get_rom_info(self, system: str, slug: str) -> dict:
        """
        Metadatos y URL de descarga de un juego.

        system : slug del sistema, ej. 'playstation'
        slug   : slug del juego,   ej. 'tekken-3'
        """
        page_url = f"{ROMSFUN_BASE}/roms/{system}/{slug}/"
        resp     = self.session.get(page_url, timeout=30)
        resp.raise_for_status()
        self._check_cloudflare(resp)
        html = resp.text
        soup = BeautifulSoup(html, "html.parser")

        name = ""
        h = soup.find("h1")
        if h:
            name = h.get_text(strip=True)

        # Buscar enlace de descarga
        dl_url = None
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "download" in href.lower() or "dl." in href.lower():
                dl_url = href if href.startswith("http") else ROMSFUN_BASE + href
                break

        size_m = re.search(r"([\d,]+\.?\d*)\s*(?:MB|GB)", html)
        size   = float(size_m.group(1).replace(",", "")) if size_m else 0.0

        return {
            "name":         name,
            "system":       system,
            "slug":         slug,
            "size_mb":      size,
            "download_url": dl_url,
            "page_url":     page_url,
            "provider":     "romsfun",
        }

    def _parse_rom_list(self, html: str, system: str = "") -> list[dict]:
        soup = BeautifulSoup(html, "html.parser")
        results, seen = [], set()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            # Patrón: /roms/{system}/{slug}/
            m = re.match(r"/roms/([^/]+)/([^/]+)/$", href)
            if not m:
                continue
            sys_slug, rom_slug = m.group(1), m.group(2)
            if rom_slug in ("", "page") or rom_slug in seen:
                continue
            seen.add(rom_slug)
            name = a.get_text(strip=True) or rom_slug.replace("-", " ").title()
            full_url = ROMSFUN_BASE + href
            results.append({
                "slug":   rom_slug,
                "system": sys_slug or system,
                "name":   name,
                "url":    full_url,
            })
        return results


# ─────────────────────────────────────────────────────────────────────────────
# Demo / smoke-test
# ─────────────────────────────────────────────────────────────────────────────

def main():
    print("=" * 65)
    print("ROM API Client — demo multi-proveedor")
    print("=" * 65)

    # 1. Endpoints disponibles
    print("\n[1] list_endpoints() — operaciones disponibles:")
    for ep in list_endpoints():
        flag = "⚠ CF" if "romsfun" in ep["id"] and ep["provider"] == "romsfun" else "  "
        print(f"  {flag} {ep['id']:40s} {ep['method']} {ep['url'][:55]}")

    # 2. Catálogo unificado de sistemas (sin duplicados)
    print(f"\n[2] list_systems() — {len(SYSTEMS)} sistemas únicos:")
    both  = [s for s in list_systems() if all(v for v in s["providers"].values())]
    only_cr = [s for s in list_systems("coolrom") if s["providers"]["romsfun"] is None]
    only_rf = [s for s in list_systems("romsfun") if s["providers"]["coolrom"] is None]
    print(f"  Ambos proveedores  : {len(both)} sistemas")
    print(f"  Solo CoolROM       : {len(only_cr)} sistemas")
    print(f"  Solo RomsFun       : {len(only_rf)} sistemas")
    for s in both[:5]:
        print(f"    {s['name']:22s}  coolrom={s['providers']['coolrom']:15s}  romsfun={s['providers']['romsfun']}")
    if len(both) > 5:
        print(f"    … y {len(both)-5} más")

    # 3. CoolROM — búsqueda
    print("\n[3] CoolROMClient().search_roms('tekken', system='psx'):")
    cr = CoolROMClient()
    res = cr.search_roms("tekken", system="psx")
    print(f"  {len(res)} resultados")
    for r in res[:4]:
        print(f"    [{r['id']}] {r['name']}  ({r['downloads']:,} descargas)")

    # 4. CoolROM — info + URL firmada
    print("\n[4] CoolROMClient().get_rom_info('psx', 39719, 'Tekken_3'):")
    info = cr.get_rom_info("psx", 39719, "Tekken_3")
    print(f"  Nombre   : {info['name']}")
    print(f"  Formato  : {info['format']}  |  Tamaño: {info['size_mb']} MB")
    if info["download_url"]:
        print(f"  ✅ URL firmada: {info['download_url'][:72]}...")
    else:
        print("  ⚠️  URL firmada no encontrada")

    # 5. RomsFun — estado
    print("\n[5] RomsFunClient — estado:")
    print("  ⚠️  Cloudflare Turnstile activo en romsfun.com.")
    print("  Pasa las cookies cf_clearance y __cf_bm de tu navegador:")
    print("  RomsFunClient(cf_cookies={'cf_clearance': '...', '__cf_bm': '...'})")

    print("\n" + "=" * 65)
    print("OK — cliente listo. Consulta list_endpoints() para la API completa.")
    print("=" * 65)

    return info


if __name__ == "__main__":
    result = main()
    sys.exit(0 if result and result.get("download_url") else 1)
