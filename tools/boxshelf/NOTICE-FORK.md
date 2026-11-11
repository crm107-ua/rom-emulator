# Boxshelf fork — ROM Catalog (rom-manager)

This tree is a fork of [boxshelf-source](https://github.com/sassiestrhihno/boxshelf-source)
(GPL-3.0). Upstream copyright remains with its authors; see `LICENSE`.

## Changes in this fork

- Local **ROM Catalog** client (`main/romcatalog.js`) talking to the Flask API in
  `scripts/rom_web` (CoolROM + RomsFun).
- **Emulator installer** for PC (`main/emuinstall.js`) using official release downloads.
- Settings UI panels for Catalog and Emulators.
- IPC bridges in `preload.js` / `main.js` (`romcatalog:*`, `emuinstall:*`).

Boxshelf still does not ship ROMs, BIOS files or keys. The catalog downloads only
what the local API resolves from the configured providers into `ROMS\{system}`.
