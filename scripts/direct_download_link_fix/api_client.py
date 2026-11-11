#!/usr/bin/env python3
"""
CoolROM.com Direct Download Client
====================================
Downloads ROMs directly from coolrom.com without being redirected to Opera GX or other sites.

Flow:
1. GET the ROM page (e.g. https://coolrom.com/roms/atari2600/16080/Pac-Man.php)
2. Parse the HTML to extract the signed dlc.coolrom.com URL embedded in #delayedContent
3. GET the signed URL to receive the ZIP file as a direct attachment download

The signed URL is generated server-side and embedded in the page HTML on every load.
No JavaScript execution required — just parse the raw HTML.
"""

import re
import os
import sys
import requests
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse, unquote

# ---------------------------------------------------------------------------
# Browser-matched headers (from live Chrome traffic capture)
# ---------------------------------------------------------------------------
BASE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/156.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;"
        "q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,"
        "application/signed-exchange;v=b3;q=0.7"
    ),
    "Accept-Language": "es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "sec-ch-ua": '"Google Chrome";v="156", "Chromium";v="156", "Not:A-Brand";v="8"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Upgrade-Insecure-Requests": "1",
}

# Cookies extracted from live browser session on coolrom.com
# - lang: language preference
# - alert_opera: suppresses the Opera GX upsell nag
# - modal_cookie: marks the download modal as already seen (reduces friction)
# - csrf / _ga cookies are session-specific; fresh ones are set on first request
INITIAL_COOKIES = {
    "lang": "es",
    "alert_opera": "1.1794157162",
    "modal_cookie": "yes",
}

# Available systems on CoolROM (slug → display name)
SYSTEMS = {
    "atari2600":     "Atari 2600",
    "atari5200":     "Atari 5200",
    "atari7800":     "Atari 7800",
    "atarijaguar":   "Atari Jaguar",
    "atarilynx":     "Atari Lynx",
    "c64":           "Commodore 64",
    "cps1":          "CPS1",
    "cps2":          "CPS2",
    "mame":          "MAME",
    "namcosystem22": "Namco System 22",
    "neogeo":        "Neo Geo",
    "neogeocd":      "Neo Geo CD",
    "neogeopocket":  "Neo Geo Pocket",
    "segacd":        "Sega CD",
    "dc":            "Sega Dreamcast",
    "gamegear":      "Sega Game Gear",
    "genesis":       "Sega Genesis",
    "mastersystem":  "Sega Master System",
    "model2":        "Sega Model 2",
    "saturn":        "Sega Saturn",
    "psx":           "Sony PlayStation",
    "ps2":           "Sony PlayStation 2",
    "ps3":           "Sony PlayStation 3",
    "psp":           "Sony PSP",
    "xbox360":       "Xbox 360",
}


def create_session() -> requests.Session:
    """
    Create a requests.Session with browser-matching headers and seed cookies.
    The session accumulates any Set-Cookie headers from subsequent requests
    (csrf, _ga, etc.) automatically.
    """
    session = requests.Session()
    session.headers.update(BASE_HEADERS)
    session.cookies.update(INITIAL_COOKIES)
    return session


# ---------------------------------------------------------------------------
# Core API
# ---------------------------------------------------------------------------

def get_signed_download_url(session: requests.Session, rom_page_url: str) -> str:
    """
    Load a CoolROM ROM page and extract the signed dlc.coolrom.com download URL
    that is embedded directly in the page HTML.

    The URL looks like:
        https://dlc.coolrom.com/roms/{system}/{file}.zip/{token}/{ts}/{uid}/{v}/?r={ref}

    Args:
        session:       Active requests.Session.
        rom_page_url:  Full URL of the ROM detail page, e.g.:
                       https://coolrom.com/roms/atari2600/16080/Pac-Man.php

    Returns:
        The signed download URL string.

    Raises:
        requests.HTTPError: On a non-2xx response from coolrom.com.
        ValueError: If no signed URL is found in the page HTML.
    """
    headers = {
        "Referer": "https://coolrom.com/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
    }
    resp = session.get(rom_page_url, headers=headers, timeout=30)
    resp.raise_for_status()

    # The signed URL is embedded in the raw HTML inside #delayedContent:
    #   <a href="https://dlc.coolrom.com/roms/...">Continuar la descarga...</a>
    match = re.search(r'href="(https://dlc\.coolrom\.com/[^"]+)"', resp.text)
    if not match:
        raise ValueError(
            f"No dlc.coolrom.com download URL found in page HTML.\n"
            f"Page URL: {rom_page_url}\n"
            f"This ROM may have been removed (copyright) or the page structure changed."
        )
    return match.group(1)


def download_rom(
    session: requests.Session,
    rom_page_url: str,
    output_dir: str = "downloads",
    filename: Optional[str] = None,
    verbose: bool = True,
) -> str:
    """
    Download a ROM from CoolROM directly (no browser redirect, no Opera GX popup).

    Args:
        session:       Active requests.Session.
        rom_page_url:  URL of the ROM detail page.
        output_dir:    Directory to save the downloaded file (created if needed).
        filename:      Override the saved filename; auto-detected if None.
        verbose:       Print progress to stdout.

    Returns:
        Absolute path of the saved file.
    """
    if verbose:
        print(f"[1/3] Loading ROM page: {rom_page_url}")

    signed_url = get_signed_download_url(session, rom_page_url)
    if verbose:
        print(f"[2/3] Signed URL: {signed_url[:90]}...")

    # Request the file from dlc.coolrom.com
    dl_headers = {
        "Referer": "https://coolrom.com/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-site",
        "Sec-Fetch-User": "?1",
    }
    resp = session.get(signed_url, headers=dl_headers, stream=True, timeout=60)
    resp.raise_for_status()

    # Determine filename from Content-Disposition header, then fall back to URL path
    if not filename:
        cd = resp.headers.get("Content-Disposition", "")
        cd_match = re.search(r'filename="([^"]+)"', cd)
        if cd_match:
            filename = cd_match.group(1)
        else:
            path = urlparse(signed_url).path
            # Path format: /roms/{system}/{file}.zip/{token}/...
            # The filename is the 3rd segment (index 3 of parts after split)
            parts = path.strip("/").split("/")
            filename = unquote(parts[2]) if len(parts) > 2 else "rom_download.zip"

    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, filename)

    total = int(resp.headers.get("Content-Length", 0))
    received = 0

    if verbose:
        print(f"[3/3] Saving → {filepath}")

    with open(filepath, "wb") as f:
        for chunk in resp.iter_content(chunk_size=16_384):
            if chunk:
                f.write(chunk)
                received += len(chunk)
                if verbose and total:
                    pct = received / total * 100
                    print(f"\r    {received}/{total} bytes  ({pct:.1f}%)", end="", flush=True)

    if verbose:
        print(f"\n✓  Downloaded {received:,} bytes → {os.path.abspath(filepath)}")

    return os.path.abspath(filepath)


def search_roms(session: requests.Session, query: str) -> list[dict]:
    """
    Search CoolROM.com for ROMs matching *query*.

    Args:
        session: Active requests.Session.
        query:   Search term (game name, partial match works).

    Returns:
        List of dicts: [{'name': str, 'url': str, 'system': str, 'id': str}, ...]
    """
    search_url = f"https://coolrom.com/search?q={requests.utils.quote(query)}"
    headers = {
        "Referer": "https://coolrom.com/",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "navigate",
    }
    resp = session.get(search_url, headers=headers, timeout=30)
    resp.raise_for_status()

    results = []
    seen = set()
    # CoolROM search results HTML structure (single line, no DOTALL needed):
    # <a class="crs-row" href="/roms/{system}/{id}/{name}.php"><table><tr>
    #   <td width="1"><span class="crs-sys">{System}</span></td>
    #   <td class="crs-name">{Name}</td>
    #   <td class="crs-dl">{Downloads}</td></tr></table></a>
    pattern = re.compile(
        r'href="(/roms/([^/]+)/(\d+)/[^"]+\.php)"[^>]*>'
        r'[^<]*<table><tr>[^<]*<td[^>]*>[^<]*<span[^>]*>([^<]+)</span>[^<]*</td>'
        r'[^<]*<td class="crs-name">([^<]+)</td>'
    )
    for m in pattern.finditer(resp.text):
        rel_path = m.group(1)
        if rel_path in seen:
            continue
        seen.add(rel_path)
        system_slug = m.group(2)
        results.append({
            "name":   m.group(5).strip(),
            "url":    f"https://coolrom.com{rel_path}",
            "system": SYSTEMS.get(system_slug, system_slug),
            "id":     m.group(3),
        })
    return results


def list_top_roms(session: requests.Session, system: str) -> list[dict]:
    """
    List the top downloaded ROMs for a given system.

    Args:
        session: Active requests.Session.
        system:  System slug, e.g. 'atari2600', 'genesis', 'psx'.

    Returns:
        List of dicts: [{'name': str, 'url': str, 'id': str}, ...]
    """
    list_url = f"https://coolrom.com/roms/{system}/"
    resp = session.get(list_url, headers={"Referer": "https://coolrom.com/"}, timeout=30)
    resp.raise_for_status()

    results = []
    seen = set()
    # Listing page HTML structure (single line per entry):
    # <a class="crb-row" href="/roms/{system}/{id}/{name}.php"><table><tr>
    #   <td class="crb-name">{Name}</td>
    #   <td class="crb-num">{Downloads}</td></tr></table></a>
    pattern = re.compile(
        rf'href="(/roms/{re.escape(system)}/(\d+)/[^"]+\.php)"[^>]*>'
        r'[^<]*<table><tr>[^<]*<td class="crb-name">([^<]+)</td>'
    )
    for m in pattern.finditer(resp.text):
        rel_path = m.group(1)
        if rel_path in seen:
            continue
        seen.add(rel_path)
        name = m.group(3).strip()
        if name:
            results.append({
                "name": name,
                "url":  f"https://coolrom.com{rel_path}",
                "id":   m.group(2),
            })
    return results


# ---------------------------------------------------------------------------
# CLI entry point / example usage
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    session = create_session()

    # -----------------------------------------------------------------------
    # Example 1 — Download a ROM by its page URL
    # -----------------------------------------------------------------------
    test_url = "https://coolrom.com/roms/atari2600/16080/Pac-Man.php"
    print("=" * 60)
    print("Example 1: Direct download by ROM page URL")
    print("=" * 60)
    try:
        path = download_rom(session, test_url, output_dir="downloads")
        print(f"\nResult: {path}")
    except Exception as exc:
        print(f"ERROR: {exc}")
        sys.exit(1)

    # -----------------------------------------------------------------------
    # Example 2 — Search and download the first result
    # -----------------------------------------------------------------------
    print("\n" + "=" * 60)
    print("Example 2: Search for 'River Raid' and download first result")
    print("=" * 60)
    results = search_roms(session, "River Raid")
    if results:
        print(f"Found {len(results)} result(s):")
        for i, r in enumerate(results[:5], 1):
            print(f"  {i}. {r['name']:<30}  [{r['system']}]")
        print(f"\nDownloading first match: {results[0]['name']} [{results[0]['system']}]")
        try:
            path2 = download_rom(session, results[0]["url"], output_dir="downloads")
            print(f"Result: {path2}")
        except Exception as exc:
            print(f"ERROR: {exc}")
    else:
        print("No results found.")

    # -----------------------------------------------------------------------
    # Example 3 — List top ROMs for a system
    # -----------------------------------------------------------------------
    print("\n" + "=" * 60)
    print("Example 3: Top ROMs for Atari 2600")
    print("=" * 60)
    top = list_top_roms(session, "atari2600")
    for i, r in enumerate(top[:10], 1):
        print(f"  {i:2}. {r['name']:<40}  {r['url']}")
