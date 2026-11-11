# rom-emulator

Lanzador de ROMs para PC (Windows) que une:

1. **API Flask** (`scripts/rom_web`) — catálogo CoolROM / RomsFun  
2. **Boxshelf (fork)** (`tools/boxshelf`) — estantería TV + **Wanikoko Loader**  
3. **Instalación de emuladores** (RetroArch, PCSX2, DuckStation, …) y carátulas originales (LaunchBox / Libretro)

Acceso directo de escritorio: **ROM Emulator** → `lanzar_boxshelf.bat` (icono en `assets/rom-emulator.ico`).

---

## Requisitos

- Windows 10/11  
- Python 3.11+ con entorno `.venv` (ver `pyproject.toml` / `uv`)  
- Node.js + npm (para Electron Boxshelf)  
- Primera vez en Boxshelf: `cd tools/boxshelf && npm install`

---

## Arranque rápido

```bat
lanzar_boxshelf.bat
```

O:

```bat
.venv\Scripts\python.exe lanzar_boxshelf.py
```

Eso:

1. Levanta la API en `http://127.0.0.1:5000`  
2. Espera `/api/health`  
3. Abre Boxshelf (`electron .` en `tools/boxshelf`)

También puedes usar el acceso directo **ROM Emulator** del escritorio.

---

## Arquitectura

```
rom-manager/
├── lanzar_boxshelf.bat / .py   # Orquestador API + UI
├── scripts/rom_web/            # Flask: búsqueda, listado, proxy de descarga
│   ├── web_app.py
│   ├── system_map.py           # CoolROM/RomsFun ↔ ids Boxshelf + emuladores
│   ├── emulators.py
│   └── api_client.py
├── tools/boxshelf/             # Fork GPL de Boxshelf + Wanikoko Loader
│   ├── main/romcatalog.js      # Cliente API + descarga/preparación ROM
│   ├── main/emuinstall.js      # Instalación de emuladores
│   ├── main/covers.js          # Carátulas LaunchBox/Libretro
│   └── renderer/settings.js    # UI Wanikoko (Settings → ROM Catalog)
└── assets/                     # Icono del acceso directo
```

### Flujo Wanikoko (añadir un juego)

1. **Buscar** título (Enter / Search now) → resultados únicos con **consola + emulador**  
2. **Descargar** (job async: la UI no se congela; un toast al inicio y otro al final)  
3. Guardar en `ROMS\<carpeta>\` (rutas absolutas)  
4. Preparar / extraer si hace falta  
5. Cablear / instalar emulador  
6. **Carátula original** vía `covers.downloadCovers` → `ROMS\<sys>\covers\`  
7. Rescan del estante → el juego aparece listo para Play  

Descargas vacías/truncadas se rechazan (evita ISOs de 0 bytes sin carátula).

---

## API local (Flask)

| Método | Ruta | Uso |
|--------|------|-----|
| GET | `/api/health` | Salud + nº sistemas/emuladores |
| GET | `/api/catalog/systems` | Mapa consolas ↔ carpetas ↔ emuladores |
| GET | `/api/search?q=&provider=all` | Búsqueda (dedupe + ranking) |
| GET | `/api/roms?boxshelf_id=&provider=` | Listado por consola |
| GET | `/api/url?...` | Resuelve URL CDN |
| GET | `/download?...` | Proxy de descarga (cookies de sesión) |
| GET | `/api/emulators` | Catálogo de emuladores PC |

Proveedores: `coolrom.com`, `romsfun.com` (o `all` en search).

---

## Consolas y carpetas

Definidas en `scripts/rom_web/system_map.py`. Ejemplos:

| Boxshelf id | Carpeta | Emulador típico |
|-------------|---------|-----------------|
| `nes` / `snes` / `gba` / `gb` / `megadrive` | `ROMS\NES` … `Genesis` | RetroArch (+ cores) |
| `ps2` | `ROMS\PS2` | PCSX2 |
| `psx` | `ROMS\PS1` | DuckStation |
| `psp` | `ROMS\PSP` | PPSSPP |

Los `romDirs` y la ruta del emulador deben ser **absolutos** (RetroArch usa como cwd su propia carpeta).

---

## Uso en Boxshelf

1. Settings → **ROM Catalog** (Wanikoko)  
2. Comprueba **Test API** (API OK)  
3. Busca un juego o elige **Console → List**  
4. **Download** → espera “On shelf · cover…”  
5. Cierra Settings y abre el juego en el estante  

Carátulas: Settings → Box art también puede re-descargar arte (LaunchBox index en `data/boxart-cache`, ignorado por git).

---

## Desarrollo

```bat
:: API sola
.venv\Scripts\python.exe scripts\rom_web\web_app.py

:: UI sola (API ya en marcha)
cd tools\boxshelf
npm start
:: o: npm run windowed
```

Parches importantes del fork:

- `main/romcatalog.js` — descarga async, validación de tamaño, prepare  
- `main.js` — jobs Wanikoko, emulador, covers con reintento  
- `renderer/settings.js` — UI nativa, dedupe, toasts, consola+emulador  
- `main/covers.js` — `lookupNames` prioriza caja retail sobre hacks  
- `main/paths.js` — rutas relativas → absolutas respecto al app root  

---

## Licencia

- Este repo (orquestador + API): documentación y código propio del proyecto.  
- **Boxshelf** (`tools/boxshelf`): **GPL-3.0** — respeta la licencia del upstream al redistribuir.  
- ROMs y BIOS: responsabilidad del usuario; no se incluyen en el repositorio.

---

## GitHub

```bat
git remote add origin git@github.com:crm107-ua/rom-emulator.git
git push -u origin main
```

No se versionan ROMs, emuladores instalados, `node_modules`, `.venv` ni cachés de carátulas (ver `.gitignore`).
