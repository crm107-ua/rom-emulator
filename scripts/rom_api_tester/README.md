# ROM Manager API Client — Verificación de Proveedores

## Resumen

Client Python que verifica y ejercita la interfaz web ROM Manager en `localhost:5000`.
La app Flask actúa como proxy sobre dos proveedores de ROMs:

| Proveedor | CDN | Plataformas de ejemplo |
|-----------|-----|------------------------|
| **CoolROM** (`coolrom.com`) | `dlc.coolrom.com` | Sega Genesis, PlayStation, PSP, PS2, … |
| **RomsFun** (`romsfun.com`) | `sto.romsfast.com`, `statics.romsfun.com` | Sega Genesis, Nintendo 64, SNES, GBA, … |

---

## Requisitos previos

1. La app Flask debe estar corriendo:
   ```
   uv run python lanzar_front.py
   # o: uv run python scripts/rom_web/web_app.py
   # → http://localhost:5000
   ```
2. Dependencia: `requests` (ya instalada en el virtualenv del proyecto).

---

## Ejecución

```bash
# Desde la raíz del proyecto rom-manager:
uv run python scripts/rom_api_tester/api_client.py
```

---

## Endpoints ejercitados

### `GET /api/roms`
Lista de ROMs por sistema y proveedor.

```python
# CoolROM
roms = list_roms("genesis",      provider="coolrom.com")
roms = list_roms("psx",          provider="coolrom.com")

# RomsFun
roms = list_roms("sega-genesis", provider="romsfun.com")
roms = list_roms("nintendo-64",  provider="romsfun.com")
```

Parámetros:
- `system`   — slug del sistema (ver listas en `api_client.py` y `romsfun_connector.py`)
- `provider` — `coolrom.com` | `romsfun.com`
- `letter`   — `a`–`z` / `#` / `""` (sólo CoolROM)

---

### `GET /api/url` — URL de descarga directa CDN

**CoolROM:**
```python
info = get_url_coolrom("genesis", 1283, "Sonic_the_Hedgehog")
# → {"download_url": "https://dlc.coolrom.com/roms/genesis/Sonic...", "image_url": ..., "valid": true, ...}
```

**RomsFun:**
```python
info = get_url_romsfun("https://romsfun.com/roms/nintendo-64/portal-64.html")
# → {"download_url": "https://sto.romsfast.com/Mods/Homebrew/Portal...", "image_url": ...}
```

---

### `GET /api/search` — Búsqueda global
```python
results = search_roms("sonic")            # todos los proveedores
results = search_roms("mario", "coolrom.com")
results = search_roms("zelda", "romsfun.com")
```

---

### `GET /download` — Streaming de descarga

**CoolROM:**
```
GET /download?system=genesis&id=1283&name=Sonic_the_Hedgehog
```

**RomsFun:**
```
GET /download?provider=romsfun.com&rom_url=https%3A%2F%2Fromsfun.com%2Froms%2Fnintendo-64%2Fportal-64.html
```

Desde Python:
```python
path = download_coolrom("genesis", 1283, "Sonic_the_Hedgehog", output_dir="downloads")
path = download_romsfun("https://romsfun.com/roms/nintendo-64/portal-64.html", output_dir="downloads")
```

---

## Resultados de la verificación (08/11/2026)

| Test | Resultado |
|------|-----------|
| CoolROM Genesis — listado | ✅ 112 ROMs |
| CoolROM Genesis — 5 URLs aleatorias (CDN HEAD) | ✅ todas HTTP 200 |
| CoolROM PlayStation — listado | ✅ 119 ROMs |
| CoolROM PlayStation — 5 URLs aleatorias (CDN HEAD) | ✅ todas HTTP 200 |
| RomsFun Sega Genesis — listado | ✅ 20 ROMs |
| RomsFun Sega Genesis — 5 URLs CDN | ✅ todas HTTP 200 (sto.romsfast.com) |
| RomsFun Nintendo 64 — listado | ✅ 20 ROMs |
| RomsFun Nintendo 64 — 5 URLs CDN | ✅ todas HTTP 200 |
| Búsqueda global "sonic" | ✅ 71 resultados (61 CoolROM + 10 RomsFun) |
| Descarga parcial CoolROM (128 KB) | ✅ Sonic_the_Hedgehog.zip |
| Descarga parcial RomsFun (128 KB) | ✅ Portal_64.zip |

---

## Notas

- **CoolROM** no requiere autenticación. Los tokens CDN duran ~12 h y se
  renuevan automáticamente cuando caducan.
- **RomsFun** impone rate-limiting (HTTP 429). Las primeras ~6–8 peticiones
  seguidas se resuelven; después conviene añadir un `time.sleep(0.5)` entre
  cada llamada a `/api/url`.
- Las URLs CDN de RomsFun tienen firma temporal (`e=`, `s=` params); caducan
  en ~12 h también. Usa siempre `/api/url` para obtener una URL fresca antes
  de descargar.
