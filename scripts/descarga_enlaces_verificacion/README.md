# CoolROM.com API Client

Fetches **direct, always-valid download URLs** for ROM files hosted on [coolrom.com](https://coolrom.com),  
with **automatic token renewal** — expired links are refreshed transparently, zero manual action needed.

## How it works

CoolROM generates **signed CDN URLs** server-side and embeds them in each ROM's HTML page.  
The `RomLink` class caches the URL and renews it automatically when it expires (~12 h).

```
RomLink.get_url()
  │
  ├─ token still valid? ──→ return cached URL  (no network)
  │
  └─ expired / missing?  ──→ fetch ROM page  →  extract new signed URL  →  cache & return
```

`download_rom()` also catches HTTP 403/410 mid-download and renews + retries once automatically.

### Signed URL structure

```
https://dlc.coolrom.com/roms/{system}/{filename}.zip
                             /{token}/{expiry}/{size_param}/{disk}/
                             ?r={referrer_path}
```

| Segment | Example | Meaning |
|---|---|---|
| `system` | `genesis` | Platform slug |
| `filename` | `Sonic%20the%20Hedgehog.zip` | ROM archive name |
| `token` | `qjOHIOx-uPuelm_1x...` | HMAC signature (server-generated) |
| `expiry` | `1794201119` | Unix timestamp — URL expires ~12 h after page load |
| `size_param` | `2048` | Internal CDN parameter |
| `disk` | `2` | Disc number (multi-disc games) |

## Requirements

```
pip install requests
```

## Quick start

```python
from api_client import create_session, RomLink, download_rom

session = create_session()

# --- Recommended: use RomLink for automatic token renewal ---
link = RomLink("genesis", 1283, "Sonic_the_Hedgehog")

# Always returns a live URL — renews token silently if expired
url = link.get_url(session)
print(url)
# → https://dlc.coolrom.com/roms/genesis/Sonic%20the%20Hedgehog.zip/...

# Download (also auto-renews on 403/410)
path = download_rom(session, link, output_dir="downloads")
print(f"Saved to: {path}")
```

```bash
python api_client.py    # runs built-in tests including renewal simulation
```

## API reference

### `RomLink(system, rom_id, rom_name)`
Core class. Holds the ROM identity and an internal signed-URL cache.

| Attribute | Type | Example |
|---|---|---|
| `system` | `str` | `"genesis"` / `"psx"` / `"gba"` / `"snes"` |
| `rom_id` | `int` | `1283` |
| `rom_name` | `str` | `"Sonic_the_Hedgehog"` *(underscores, no extension)* |

**Key methods:**

| Method | Description |
|---|---|
| `link.get_url(session)` | Returns a valid CDN URL; re-fetches page if token is expired |
| `link.is_token_valid` | `True` if cached token still has >5 min remaining |
| `link.invalidate()` | Force renewal on the next `get_url()` call |

---

### `create_session() → requests.Session`
Returns a session with browser-matching headers and the site's cookies pre-loaded.

---

### `get_direct_download_url(session, system, rom_id, rom_name) → str`
One-shot helper: creates a fresh `RomLink` and calls `get_url()`.  
Equivalent to `RomLink(system, rom_id, rom_name).get_url(session)`.

---

### `download_rom(session, rom_or_url, output_dir, filename, show_progress) → str`
Stream-downloads the ROM ZIP. Accepts a `RomLink` **or** a plain URL string.

- With `RomLink`: on HTTP 403/410 it calls `link.invalidate()` + `get_url()` and retries once.
- With a plain URL string: no renewal possible (no identity stored), raises on 403/410.

Returns the absolute path to the saved file.

---

### `list_roms_for_system(session, system, letter) → list[dict]`
Returns ROMs from the browse page. Each dict includes a ready-to-use `"link"` (`RomLink`).

```python
roms = list_roms_for_system(session, "genesis", letter="s")
for r in roms:
    url = r["link"].get_url(session)   # always valid, auto-renews
```

## Supported systems (platform slugs)

| Slug | System |
|---|---|
| `genesis` | Sega Genesis |
| `psx` | Sony PlayStation |
| `ps2` | Sony PlayStation 2 |
| `ps3` | Sony PlayStation 3 |
| `psp` | PlayStation Portable |
| `gba` | Game Boy Advance |
| `snes` | Super Nintendo |
| `n64` | Nintendo 64 |
| `dc` | Sega Dreamcast |
| `mame` | MAME Arcade |
| `neogeo` | Neo Geo |
| `atari2600` | Atari 2600 |
| `c64` | Commodore 64 |
| `xbox360` | Xbox 360 |

Find the slug from the URL: `coolrom.com/roms/**{slug}**/`

## Finding ROM IDs

ROM IDs come from the URL on the game's page:  
`coolrom.com/roms/genesis/**1283**/Sonic_the_Hedgehog.php`

## Authentication

No login is required.  
The site issues signed CDN URLs to anonymous visitors.  
The hardcoded `csrf` cookie in the script matches a live browser session and helps avoid any rate-limit differences, but the script works without it too.

## Caveats

- **Token lifetime ~12 hours** — always fetch a fresh page; don't cache URLs.
- The CDN is behind Cloudflare; heavy parallel fetching may trigger rate limits.
- CoolROM serves a Cloudflare HTML challenge on unusual traffic — the included headers are matched to pass it.
