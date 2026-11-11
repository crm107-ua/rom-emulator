# ROM Manager — API + front de pruebas

Interfaz web + API Flask sobre CoolROM y RomsFun, con mapeo Boxshelf.

## Arranque

```bash
# Solo API / UI web
uv run python scripts/rom_web/web_app.py

# API + fork Boxshelf (PC)
uv run python lanzar_boxshelf.py
```

- Web: http://localhost:5000  
- Boxshelf: Settings → Library → **ROM Catalog** / **Emulators**

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/` | UI de pruebas |
| GET | `/api/health` | Estado + proveedores |
| GET | `/api/endpoints` | Catálogo de endpoints |
| GET | `/api/systems` | Sistemas (`?provider=...`) |
| GET | `/api/catalog/systems` | Solape Boxshelf (ids, carpetas, emuladores) |
| GET | `/api/roms` | Listado (`system` o `boxshelf_id`) |
| GET | `/api/url` | URL CDN de descarga |
| GET | `/api/search` | Búsqueda (`?q=...`) |
| POST | `/api/jobs/download` | Encola descarga a `dest_dir` |
| GET | `/api/jobs/{id}` | Progreso del job |
| GET | `/api/emulators` | Emuladores PC oficiales |
| GET | `/download` | Streaming del ROM |
| GET | `/proxy/image` | Proxy de portadas |

Cada ROM anotado incluye `boxshelf_id` y `rom_folder`.
