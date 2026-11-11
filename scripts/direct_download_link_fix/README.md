# CoolROM.com Direct Download Client

Python script to download ROMs from [coolrom.com](https://coolrom.com) **directly** — bypassing the Opera GX popup and all browser redirects.

## How it works

Each ROM detail page on CoolROM embeds a **signed, time-limited download URL** (`dlc.coolrom.com`) directly in the initial HTML response. The script:

1. **GETs the ROM page** (e.g. `https://coolrom.com/roms/atari2600/16080/Pac-Man.php`)
2. **Extracts the signed URL** from the `#delayedContent` anchor in the raw HTML using a regex — no JavaScript execution needed
3. **GETs the signed URL** from `dlc.coolrom.com`, which responds with the ZIP file as a `Content-Disposition: attachment` download

The signed URL format is:
```
https://dlc.coolrom.com/roms/{system}/{filename.zip}/{hmac_token}/{unix_timestamp}/{uid}/{ver}/?r={referer}
```
Every page load generates a fresh token — the script fetches a new one each time.

## Requirements

```
pip install requests
```

No other dependencies needed.

## Quick start

```python
from api_client import create_session, download_rom

session = create_session()
path = download_rom(session, "https://coolrom.com/roms/atari2600/16080/Pac-Man.php", output_dir="downloads")
print(f"Saved to: {path}")
```

## API Reference

### `create_session() → requests.Session`
Returns a `requests.Session` pre-configured with browser-matching headers and seed cookies.

---

### `get_signed_download_url(session, rom_page_url) → str`
Loads a ROM page and returns the signed `dlc.coolrom.com` download URL embedded in the HTML.

```python
signed_url = get_signed_download_url(session, "https://coolrom.com/roms/genesis/40171/Pac-Man_2.php")
```

---

### `download_rom(session, rom_page_url, output_dir="downloads", filename=None, verbose=True) → str`
Downloads a ROM to disk. Returns the absolute path of the saved file.

```python
path = download_rom(session, "https://coolrom.com/roms/atari2600/15882/River_Raid.php")
```

---

### `search_roms(session, query) → list[dict]`
Searches CoolROM and returns a list of matching ROM entries.

Each dict: `{"name": str, "url": str, "system": str, "id": str}`

```python
results = search_roms(session, "Pac-Man")
for r in results:
    print(r["name"], r["system"], r["url"])
```

---

### `list_top_roms(session, system) → list[dict]`
Returns the top downloaded ROMs for a given system slug.

Each dict: `{"name": str, "url": str, "id": str}`

```python
top = list_top_roms(session, "genesis")
for r in top[:20]:
    print(r["name"], r["url"])
```

---

## Available Systems

| Slug | System |
|------|--------|
| `atari2600` | Atari 2600 |
| `atari5200` | Atari 5200 |
| `atari7800` | Atari 7800 |
| `atarijaguar` | Atari Jaguar |
| `atarilynx` | Atari Lynx |
| `c64` | Commodore 64 |
| `cps1` | CPS1 |
| `cps2` | CPS2 |
| `mame` | MAME |
| `neogeo` | Neo Geo |
| `neogeocd` | Neo Geo CD |
| `neogeopocket` | Neo Geo Pocket |
| `segacd` | Sega CD |
| `dc` | Sega Dreamcast |
| `gamegear` | Sega Game Gear |
| `genesis` | Sega Genesis |
| `mastersystem` | Sega Master System |
| `model2` | Sega Model 2 |
| `saturn` | Sega Saturn |
| `psx` | Sony PlayStation |
| `ps2` | Sony PlayStation 2 |
| `ps3` | Sony PlayStation 3 |
| `psp` | Sony PSP |
| `xbox360` | Xbox 360 |

## Caveats

- **Signed URLs expire** (time-limited HMAC tokens). The script always fetches a fresh one per download — never cache signed URLs.
- Some systems (GBA, NES, SNES, N64) were removed from CoolROM due to Nintendo DMCA takedowns. Attempting to access them redirects to `/removed.php`.
- The site is behind Cloudflare but does **not** require Cloudflare clearance cookies; standard browser headers are sufficient.
- Downloads are ZIP archives. Extract with any standard unzip tool.

## Example: batch download

```python
from api_client import create_session, list_top_roms, download_rom

session = create_session()
top = list_top_roms(session, "atari2600")

for rom in top[:5]:
    print(f"Downloading {rom['name']}…")
    try:
        download_rom(session, rom["url"], output_dir="downloads/atari2600")
    except Exception as e:
        print(f"  Failed: {e}")
```
