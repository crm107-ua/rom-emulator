"""
CoolROM.com Public Catalog Scraper
====================================
Reverse-engineered from https://coolrom.com/roms/

The site is 100% server-rendered HTML — there are no REST/JSON API endpoints.
All "API calls" are plain GET requests that return HTML pages parsed with
BeautifulSoup.

No authentication required. All endpoints are public.
"""

from __future__ import annotations

import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Iterator, Optional
from urllib.parse import urljoin, urlencode

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BASE_URL = "https://coolrom.com"

# All systems available on the public catalog as of November 2026.
# Nintendo systems have been removed from the site.
SYSTEMS: dict[str, str] = {
    "atari2600":    "Atari 2600",
    "atari5200":    "Atari 5200",
    "atari7800":    "Atari 7800",
    "atarijaguar":  "Atari Jaguar",
    "atarilynx":    "Atari Lynx",
    "c64":          "Commodore 64",
    "cps1":         "CPS1",
    "cps2":         "CPS2",
    "mame":         "MAME",
    "namcosystem22": "Namco System 22",
    "neogeo":       "Neo Geo",
    "neogeocd":     "Neo Geo CD",
    "neogeopocket": "Neo Geo Pocket",
    "segacd":       "Sega CD",
    "dc":           "Sega Dreamcast",
    "gamegear":     "Sega Game Gear",
    "genesis":      "Sega Genesis",
    "mastersystem": "Sega Master System",
    "model2":       "Sega Model 2",
    "saturn":       "Sega Saturn",
    "psx":          "Sony PlayStation",
    "ps2":          "Sony PlayStation 2",
    "ps3":          "Sony PlayStation 3",
    "psp":          "Sony PSP",
    "xbox360":      "Xbox 360",
}

# Letters available for alphabetical navigation
LETTERS: list[str] = ["0"] + list("abcdefghijklmnopqrstuvwxyz")


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class SystemInfo:
    slug: str          # URL key, e.g. "genesis"
    name: str          # Display name, e.g. "Sega Genesis"
    count: int         # Total number of titles
    url: str           # Full category URL


@dataclass
class LetterLink:
    display: str       # "#" or "A"–"Z"
    slug: str          # "0" or "a"–"z"
    url: str


@dataclass
class RomEntry:
    title: str
    rom_id: str        # Numeric ID from URL
    region: Optional[str]   # Extracted from title parentheses if present
    url: str           # Full ROM detail page URL
    downloads: Optional[int] = None   # Only present in some listings


@dataclass
class SearchResult:
    system_slug: str
    system_name: str
    title: str
    rom_id: str
    region: Optional[str]
    url: str
    downloads: Optional[int]
    format: Optional[str] = None
    genre: Optional[str] = None
    rating: Optional[float] = None
    votes: Optional[int] = None
    filename: Optional[str] = None
    size: Optional[str] = None


# ---------------------------------------------------------------------------
# HTTP session (plain requests — no bot-detection workarounds needed for
# public HTML pages; the site serves without JS gating)
# ---------------------------------------------------------------------------

def make_session() -> requests.Session:
    """Return a requests.Session configured to look like a real browser."""
    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/130.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Referer": "https://coolrom.com/",
    })
    return session


def _get(session: requests.Session, url: str, params: dict | None = None) -> BeautifulSoup:
    """Fetch a URL and return a BeautifulSoup document."""
    resp = session.get(url, params=params, timeout=20)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "html.parser")


# ---------------------------------------------------------------------------
# 1. Catalog index — list all systems
# ---------------------------------------------------------------------------

def get_catalog(session: requests.Session) -> list[SystemInfo]:
    """
    Fetch the main catalog page and return every system with its metadata.

    URL: GET https://coolrom.com/roms/
    HTML: <a class="cri-card" href="/roms/{slug}/">
            <span class="cri-name">System Name</span>
            <span class="cri-count">645 titles</span>
          </a>
    Returns list of SystemInfo(slug, name, count, url).
    """
    soup = _get(session, f"{BASE_URL}/roms/")
    systems: list[SystemInfo] = []

    for a in soup.select("a.cri-card[href]"):
        href = a["href"]
        m = re.match(r"^/roms/([^/]+)/$", href)
        if not m:
            continue
        slug = m.group(1)
        name_el = a.select_one("span.cri-name")
        count_el = a.select_one("span.cri-count")
        name = name_el.get_text(strip=True) if name_el else slug
        count_text = re.sub(r"[^\d]", "", count_el.get_text() if count_el else "0")
        count = int(count_text) if count_text else 0
        full_url = urljoin(BASE_URL, href)
        systems.append(SystemInfo(slug=slug, name=name, count=count, url=full_url))

    return systems


# ---------------------------------------------------------------------------
# 2. Category page — letter and genre navigation links
# ---------------------------------------------------------------------------

def get_letter_links(session: requests.Session, system_slug: str) -> list[LetterLink]:
    """
    Fetch a system's category page and return all A-Z / # letter links.

    URL: GET https://coolrom.com/roms/{system_slug}/
    Pattern: /roms/{system}/{letter}/ where letter is 0 (for #) or a-z.
    """
    soup = _get(session, f"{BASE_URL}/roms/{system_slug}/")
    links: list[LetterLink] = []

    pattern = re.compile(rf"^/roms/{re.escape(system_slug)}/([a-z0])/\s*$")
    for a in soup.select("a[href]"):
        m = pattern.match(a.get("href", ""))
        if m:
            slug = m.group(1)
            display = "#" if slug == "0" else slug.upper()
            links.append(LetterLink(
                display=display,
                slug=slug,
                url=urljoin(BASE_URL, a["href"]),
            ))

    return links


# ---------------------------------------------------------------------------
# 3. Letter page — list all ROMs starting with a letter
# ---------------------------------------------------------------------------

_REGION_RE = re.compile(r"\(([^)]+)\)\s*$")


def _parse_region(title: str) -> Optional[str]:
    """Extract region from a title like 'Sonic (Japan)' → 'Japan'."""
    m = _REGION_RE.search(title)
    return m.group(1) if m else None


def _parse_rom_links(soup: BeautifulSoup, system_slug: str) -> list[RomEntry]:
    """
    Parse all ROM entry links from a category/letter/search page.

    URL pattern: /roms/{system}/{id}/{Title}.php
    """
    roms: list[RomEntry] = []
    pattern = re.compile(rf"/roms/{re.escape(system_slug)}/(\d+)/(.+)\.php$")
    seen_ids: set[str] = set()

    for a in soup.select(f"a[href*='/roms/{system_slug}/']"):
        href = a.get("href", "")
        m = pattern.search(href)
        if not m:
            continue
        rom_id = m.group(1)
        if rom_id in seen_ids:
            continue
        seen_ids.add(rom_id)

        title = a.get_text(" ").strip()
        # Strip download count if concatenated (e.g. "Sonic the Hedgehog2,823,552")
        title = re.sub(r"[\d,]+$", "", title).strip()

        # Extract optional download count from sibling text nodes
        raw = a.parent.get_text(" ") if a.parent else ""
        dl_match = re.search(r"([\d,]+)\s*$", raw)
        downloads = int(dl_match.group(1).replace(",", "")) if dl_match else None

        roms.append(RomEntry(
            title=title,
            rom_id=rom_id,
            region=_parse_region(title),
            url=urljoin(BASE_URL, href),
            downloads=downloads,
        ))

    return roms


def get_roms_by_letter(
    session: requests.Session,
    system_slug: str,
    letter: str,
) -> list[RomEntry]:
    """
    Return all ROMs in a system whose title starts with `letter`.

    Args:
        system_slug: e.g. "genesis"
        letter: "a"–"z" or "0" (for #/numeric titles)

    URL: GET https://coolrom.com/roms/{system_slug}/{letter}/
    """
    url = f"{BASE_URL}/roms/{system_slug}/{letter}/"
    soup = _get(session, url)
    return _parse_rom_links(soup, system_slug)


def get_all_roms(session: requests.Session, system_slug: str) -> list[RomEntry]:
    """
    Fetch every ROM in a system by iterating all letters.

    URL: GET https://coolrom.com/roms/{system_slug}/all/
    Falls back to iterating A-Z/# if /all/ is not available.
    """
    try:
        soup = _get(session, f"{BASE_URL}/roms/{system_slug}/all/")
        roms = _parse_rom_links(soup, system_slug)
        if roms:
            return roms
    except requests.HTTPError:
        pass

    # Fallback: iterate all letters
    all_roms: list[RomEntry] = []
    seen: set[str] = set()
    for letter in LETTERS:
        try:
            entries = get_roms_by_letter(session, system_slug, letter)
            for e in entries:
                if e.rom_id not in seen:
                    seen.add(e.rom_id)
                    all_roms.append(e)
            time.sleep(0.3)  # polite crawl delay
        except requests.HTTPError:
            continue
    return all_roms


# ---------------------------------------------------------------------------
# 4. Search
# ---------------------------------------------------------------------------

def search_roms(
    session: requests.Session,
    query: str,
    system: Optional[str] = None,
    sort: Optional[str] = None,       # "name" | "downloads"
    direction: Optional[str] = None,  # "asc" | "desc"
) -> tuple[int, list[SearchResult]]:
    """
    Search the CoolROM catalog.

    URL: GET https://coolrom.com/search
    Params:
        q        – search term (required)
        system   – filter by system slug (optional)
        sort     – "name" or "downloads" (optional)
        dir      – "asc" or "desc" (optional)

    Returns:
        (total_count, list[SearchResult])
    """
    params: dict[str, str] = {"q": query}
    if system:
        params["system"] = system
    if sort:
        params["sort"] = sort
    if direction:
        params["dir"] = direction

    soup = _get(session, f"{BASE_URL}/search", params=params)

    # Extract total result count — appears as "108 results found for ..."
    total = 0
    body_text = soup.get_text(" ")
    count_m = re.search(r"(\d+)\s+results?\s+found", body_text, re.IGNORECASE)
    if count_m:
        total = int(count_m.group(1))

    results: list[SearchResult] = []
    rom_pattern = re.compile(r"/roms/([^/]+)/(\d+)/(.+)\.php$")
    seen_ids: set[str] = set()

    for a in soup.select("a[href*='.php']"):
        href = a.get("href", "")
        m = rom_pattern.search(href)
        if not m:
            continue
        sys_slug, rom_id, slug = m.group(1), m.group(2), m.group(3)
        key = f"{sys_slug}:{rom_id}"
        if key in seen_ids:
            continue
        seen_ids.add(key)

        raw_text = a.get_text(" ").strip()
        # Strip leading system name + trailing download count
        sys_name = SYSTEMS.get(sys_slug, sys_slug)
        title = raw_text
        if title.startswith(sys_name):
            title = title[len(sys_name):].strip()
        title = re.sub(r"[\d,]+$", "", title).strip()

        dl_match = re.search(r"([\d,]+)\s*$", raw_text)
        downloads = int(dl_match.group(1).replace(",", "")) if dl_match else None

        results.append(SearchResult(
            system_slug=sys_slug,
            system_name=sys_name,
            title=title,
            rom_id=rom_id,
            region=_parse_region(title),
            url=urljoin(BASE_URL, href),
            downloads=downloads,
        ))

    if results:
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(_completar_ficha, results))

    return total, results


def datos_ficha(session: requests.Session, url: str) -> dict:
    """Lee los datos visibles de una ficha: formato, género, nota, votos, archivo y tamaño."""
    soup = _get(session, url)
    datos: dict = {
        "format": None,
        "genre": None,
        "rating": None,
        "votes": None,
        "filename": None,
        "size": None,
        "downloads": None,
    }
    for fact in soup.select(".crd-fact"):
        texto = fact.get_text(" ", strip=True)
        etiqueta, _, resto = texto.partition(" ")
        clave = etiqueta.lower()
        if clave == "format":
            datos["format"] = resto.strip() or None
        elif clave == "genre":
            datos["genre"] = resto.strip() or None
        elif clave == "downloads":
            numero = re.sub(r"[^\d]", "", resto)
            datos["downloads"] = int(numero) if numero else None
        elif clave == "rating":
            nota = re.search(r"([\d.]+)", resto)
            votos = re.search(r"\|\s*([\d,]+)", resto)
            if nota:
                datos["rating"] = float(nota.group(1))
            if votos:
                datos["votes"] = int(votos.group(1).replace(",", ""))
    nombre = soup.select_one(".crd-mname")
    tamano = soup.select_one(".crd-size")
    if nombre:
        datos["filename"] = nombre.get_text(strip=True) or None
    if tamano:
        datos["size"] = tamano.get_text(strip=True) or None
    if datos["votes"] is None:
        votos_el = soup.select_one(".crd-votes")
        if votos_el:
            numero = re.sub(r"[^\d]", "", votos_el.get_text())
            datos["votes"] = int(numero) if numero else None
    return datos


def _completar_ficha(resultado: SearchResult) -> SearchResult:
    try:
        extra = datos_ficha(make_session(), resultado.url)
    except (requests.RequestException, ValueError):
        return resultado
    if extra.get("downloads") is not None:
        resultado.downloads = extra["downloads"]
    resultado.format = extra.get("format")
    resultado.genre = extra.get("genre")
    resultado.rating = extra.get("rating")
    resultado.votes = extra.get("votes")
    resultado.filename = extra.get("filename")
    resultado.size = extra.get("size")
    return resultado


def search_filter_by_system(
    session: requests.Session,
    query: str,
    system: str,
) -> tuple[int, list[SearchResult]]:
    """Convenience: search and filter by a specific system slug."""
    return search_roms(session, query, system=system)


# ---------------------------------------------------------------------------
# Main — demo / smoke-test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    session = make_session()

    # --- 1. List all systems ---
    print("=" * 60)
    print("CATALOG — ALL SYSTEMS")
    print("=" * 60)
    catalog = get_catalog(session)
    for s in catalog:
        print(f"  {s.name:<30} {s.count:>7,} titles   {s.url}")

    print(f"\nTotal systems: {len(catalog)}\n")

    # --- 2. Letter links for Sega Genesis ---
    print("=" * 60)
    print("LETTER NAVIGATION — Sega Genesis")
    print("=" * 60)
    letters = get_letter_links(session, "genesis")
    for lk in letters:
        print(f"  {lk.display:<3}  {lk.url}")

    # --- 3. ROMs starting with 'A' in Sega Genesis ---
    print("\n" + "=" * 60)
    print("ROMs starting with 'A' — Sega Genesis (first 10)")
    print("=" * 60)
    roms_a = get_roms_by_letter(session, "genesis", "a")
    for r in roms_a[:10]:
        region_label = f"[{r.region}]" if r.region else ""
        print(f"  id={r.rom_id:<6}  {r.title:<55} {region_label}")
    print(f"  ... total on this page: {len(roms_a)}")

    # --- 4. Search ---
    print("\n" + "=" * 60)
    print("SEARCH — query='sonic'")
    print("=" * 60)
    total, results = search_roms(session, "sonic")
    print(f"  Total results: {total}")
    for r in results[:8]:
        region_label = f"[{r.region}]" if r.region else ""
        dl = f"{r.downloads:,}" if r.downloads else "?"
        print(f"  [{r.system_slug:<14}] {r.title:<50} {region_label:<12} {dl} dl")

    # --- 4b. Search filtered by system ---
    print("\n" + "=" * 60)
    print("SEARCH — query='sonic', system='genesis'")
    print("=" * 60)
    total2, results2 = search_filter_by_system(session, "sonic", "genesis")
    print(f"  Total results: {total2}")
    for r in results2[:5]:
        dl = f"{r.downloads:,}" if r.downloads else "?"
        print(f"  id={r.rom_id:<6}  {r.title:<50}  {dl} dl")
