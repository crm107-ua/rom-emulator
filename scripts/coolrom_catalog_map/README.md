# CoolROM.com Public Catalog — API Client

Reverse-engineered scraper for `https://coolrom.com/roms/`

---

## Overview

CoolROM is a **fully server-rendered HTML site** — there are no REST or JSON API endpoints.
Every "API call" is a plain `GET` request that returns an HTML page parsed with
BeautifulSoup. No authentication is required; all endpoints are public.

---

## Discovered Endpoints

| # | Method | URL | Description |
|---|--------|-----|-------------|
| 1 | GET | `/roms/` | Main catalog — all systems |
| 2 | GET | `/roms/{system}/` | Category page (letter/genre nav) |
| 3 | GET | `/roms/{system}/{letter}/` | ROMs starting with that letter (`0` = `#`) |
| 4 | GET | `/roms/{system}/all/` | All ROMs in a system (single page) |
| 5 | GET | `/roms/{system}/{genre}/` | ROMs filtered by genre |
| 6 | GET | `/roms/{system}/{id}/{Title}.php` | Individual ROM detail page |
| 7 | GET | `/search?q={query}` | Full-text search across all systems |
| 8 | GET | `/search?q={query}&system={slug}` | Search filtered to one system |
| 9 | GET | `/search?q={query}&sort={field}&dir={asc\|desc}` | Sorted search |

---

## Systems Catalog (25 systems as of Nov 2026)

> Nintendo systems have been removed from the site.

| Slug | Name | Titles |
|------|------|--------|
| `atari2600` | Atari 2600 | 645 |
| `atari5200` | Atari 5200 | 94 |
| `atari7800` | Atari 7800 | 58 |
| `atarijaguar` | Atari Jaguar | 44 |
| `atarilynx` | Atari Lynx | 85 |
| `c64` | Commodore 64 | 5,649 |
| `cps1` | CPS1 | 24 |
| `cps2` | CPS2 | 32 |
| `mame` | MAME | 29,633 |
| `namcosystem22` | Namco System 22 | 2 |
| `neogeo` | Neo Geo | 125 |
| `neogeocd` | Neo Geo CD | 94 |
| `neogeopocket` | Neo Geo Pocket | 87 |
| `segacd` | Sega CD | 147 |
| `dc` | Sega Dreamcast | 262 |
| `gamegear` | Sega Game Gear | 337 |
| `genesis` | Sega Genesis | 1,630 |
| `mastersystem` | Sega Master System | 309 |
| `model2` | Sega Model 2 | 25 |
| `saturn` | Sega Saturn | 133 |
| `psx` | Sony PlayStation | 5,029 |
| `ps2` | Sony PlayStation 2 | 3,189 |
| `ps3` | Sony PlayStation 3 | 1,214 |
| `psp` | Sony PSP | 2,789 |
| `xbox360` | Xbox 360 | 1,638 |

---

## URL Patterns

### Category letter navigation
```
https://coolrom.com/roms/{system}/{letter}/
```
- `letter` = `0` (for titles starting with #/digits) or `a`–`z`
- Example: `https://coolrom.com/roms/genesis/a/`

### ROM detail page
```
https://coolrom.com/roms/{system}/{id}/{Title_with_underscores}.php
```
- `id` = numeric ROM identifier
- Example: `https://coolrom.com/roms/genesis/1283/Sonic_the_Hedgehog.php`

### ROM data fields (from listing pages)
| Field | Source |
|-------|--------|
| `title` | Anchor text, e.g. `"Sonic the Hedgehog"` |
| `rom_id` | Extracted from URL path, e.g. `"1283"` |
| `region` | Parenthesised suffix in title, e.g. `"(Japan)"` → `"Japan"` |
| `url` | Full ROM detail page URL |
| `downloads` | Download count shown next to title |

### Search parameters
| Param | Values | Description |
|-------|--------|-------------|
| `q` | any string | Search query (required) |
| `system` | system slug | Filter to one system |
| `sort` | `name` \| `downloads` | Sort field |
| `dir` | `asc` \| `desc` | Sort direction |

---

## Authentication

None. All pages are publicly accessible without cookies, tokens, or sessions.

---

## Installation

```bash
pip install requests beautifulsoup4
```

---

## Usage Examples

```python
from api_client import make_session, get_catalog, get_letter_links, \
                       get_roms_by_letter, get_all_roms, search_roms

session = make_session()

# 1. List all systems
catalog = get_catalog(session)
for system in catalog:
    print(f"{system.name}: {system.count} titles — {system.url}")

# 2. Get letter navigation links for a system
letters = get_letter_links(session, "genesis")
for lk in letters:
    print(f"{lk.display}: {lk.url}")

# 3. Get all ROMs starting with 'S' in Sega Genesis
roms = get_roms_by_letter(session, "genesis", "s")
for rom in roms:
    print(f"[{rom.rom_id}] {rom.title} ({rom.region or 'World'}) — {rom.url}")

# 4. Get ALL ROMs in a system (iterates all letters)
all_roms = get_all_roms(session, "neogeo")
print(f"Total Neo Geo ROMs: {len(all_roms)}")

# 5. Search across all systems
total, results = search_roms(session, "street fighter")
print(f"Found {total} results")
for r in results:
    print(f"[{r.system_slug}] {r.title} — {r.downloads:,} downloads")

# 6. Search within a specific system
total, results = search_roms(session, "mario", system="genesis")

# 7. Search with sorting
total, results = search_roms(session, "sonic", sort="downloads", direction="desc")
```

---

## Bot Detection / Rate Limiting

The site does not employ active bot-detection (no Cloudflare, no JS challenges).
Standard `requests` with a browser `User-Agent` works fine.
Add a small sleep (`time.sleep(0.3)`) between requests when crawling many pages
to be a polite client.

---

## Caveats

- **Nintendo ROMs removed**: NES, SNES, N64, GBA, GBC, DS systems are no longer
  listed on the site (confirmed Nov 2026).
- **Titles include region variants**: The same game appears multiple times for
  different regions — `(USA)`, `(Europe)`, `(Japan)`, `(World)`.
- **Download counts are live**: They change on each page load.
- **Search shows all results at once**: No pagination — all matching titles are
  returned on a single page.
- The `get_all_roms()` letter-iteration path adds a 0.3s delay between letters
  to avoid overwhelming the server.
