# CoolROM.com API Client

Reverse-engineered Python client for [coolrom.com](https://coolrom.com).

## Discovered APIs

| # | Method | URL Pattern | Purpose |
|---|--------|-------------|---------|
| 1 | GET | `https://coolrom.com/roms/` | List all ROM systems |
| 2 | GET | `https://coolrom.com/roms/{system}/` | System overview (top-50, featured) |
| 3 | GET | `https://coolrom.com/roms/{system}/{letter}/` | ROMs by first letter |
| 4 | GET | `https://coolrom.com/roms/{system}/all/` | Full ROM list for a system |
| 5 | GET | `https://coolrom.com/search?q=...&system=...&sort=...&dir=...` | ROM search |
| 6 | GET | `https://coolrom.com/roms/{system}/{id}/{name}.php` | Game page (contains signed DL URL) |
| 7 | GET | `https://dlc.coolrom.com/roms/{system}/{file}/{token}/{ts}/{n}/{v}/?r=...` | Actual file download |

### Download URL Structure

The signed download URL is embedded directly in every game page's JavaScript:

```
https://dlc.coolrom.com/roms/{system}/{filename.7z}/{HMAC_token}/{unix_timestamp}/{n1}/{n2}/?r={referer_path}
```

- **token**: server-generated HMAC signature (Base64url, ~43 chars)
- **unix_timestamp**: expiry time (URL is valid for a limited window)
- **n1 / n2**: server-side parameters (observed as `2048` / `2`)
- **r**: URL-encoded referer path (e.g. `/roms/psx/39719/Tekken_3.php`)

A new signed URL is generated on every page load, so fetching the game page fresh always yields a valid URL.

## Authentication

- **No login required** — all endpoints are public
- **Bot-detection bypass**: set `modal_cookie=yes` and `count=9999` cookies to skip the Opera GX upsell modal
- **Language**: `lang=en` for English responses (default is geo-based)
- The `csrf` cookie is auto-set by the server; a stale value is accepted as long as the session cookie jar is consistent

## Available Systems

| Slug | Name |
|------|------|
| `atari2600` | Atari 2600 |
| `c64` | Commodore 64 |
| `mame` | MAME |
| `psx` | Sony Playstation |
| `ps2` | Sony Playstation 2 |
| `ps3` | Sony Playstation 3 |
| `psp` | Sony Playstation Portable |
| `genesis` | Sega Genesis |
| `dc` | Sega Dreamcast |
| `xbox360` | Xbox 360 |
| *(+ 15 more)* | |

## Requirements

```
pip install requests beautifulsoup4
```

## Quick Start

```python
from api_client import CoolROMClient

client = CoolROMClient()

# Search
results = client.search_roms("tekken", system="psx")
for r in results:
    print(r["id"], r["name"], r["downloads"])

# Get signed download URL
info = client.get_rom_info("psx", 39719, "Tekken_3")
print(info["download_url"])  # https://dlc.coolrom.com/roms/psx/Tekken%203.7z/...

# Download (streams to disk)
url = client.get_download_url("psx", 39719, "Tekken_3")
client.download_rom(url, "./downloads/")
```

## Running the Demo

```bash
python api_client.py
```

Expected output:
```
============================================================
CoolROM.com API Client — demo run
============================================================
[1] Fetching system list...
    Found 25 systems...
[2] Searching for 'tekken' on psx...
    Found 13 results...
[3] Fetching ROM info for Tekken 3 (PSX id=39719)...
    ✅ Download URL extracted successfully!
[4] Listing PSX ROMs starting with 'A'...
    Found 262 ROMs...
```

## Finding ROM IDs

ROM IDs are embedded in URLs: `https://coolrom.com/roms/psx/**39719**/Tekken_3.php`

- **Search** returns IDs: `client.search_roms("game name")`
- **List by letter** returns IDs: `client.list_roms("psx", letter="t")`
- **List all**: `client.list_roms("psx", all_roms=True)`

## Caveats

- Signed download URLs are **time-limited** — always fetch a fresh one from the game page immediately before downloading
- The site is served behind **Cloudflare**; excessive requests may trigger rate-limiting
- ROM downloads are large (100 MB – 4 GB+); always stream with `download_rom()`
- The `get_systems()` count field may show 0 if the page language differs from the regex; the slug/name fields are always correct
