"""Mapeo canónico API (CoolROM/RomsFun) ↔ Boxshelf (ids, carpetas ROM, emuladores)."""

from __future__ import annotations

from typing import Any, Optional

# Solo consolas con solape API ↔ Boxshelf (plan 2A).
CATALOG_SYSTEMS: list[dict[str, Any]] = [
    {
        "boxshelf_id": "megadrive",
        "label": "Sega Genesis / Mega Drive",
        "rom_folder": "Genesis",
        "rom_folder_aliases": ["genesis", "megadrive", "mega drive", "md"],
        "coolrom": "genesis",
        "romsfun": "sega-genesis",
        "emulator_ids": ["blastem", "retroarch"],
    },
    {
        "boxshelf_id": "psx",
        "label": "PlayStation",
        "rom_folder": "PS1",
        "rom_folder_aliases": ["ps1", "psx", "playstation"],
        "coolrom": "psx",
        "romsfun": "playstation",
        "emulator_ids": ["duckstation"],
    },
    {
        "boxshelf_id": "ps2",
        "label": "PlayStation 2",
        "rom_folder": "PS2",
        "rom_folder_aliases": ["ps2", "playstation-2", "playstation 2"],
        "coolrom": "ps2",
        "romsfun": "playstation-2",
        "emulator_ids": ["pcsx2"],
    },
    {
        "boxshelf_id": "psp",
        "label": "PSP",
        "rom_folder": "PSP",
        "rom_folder_aliases": ["psp", "playstation-portable"],
        "coolrom": "psp",
        "romsfun": "playstation-portable",
        "emulator_ids": ["ppsspp"],
    },
    {
        "boxshelf_id": "dreamcast",
        "label": "Sega Dreamcast",
        "rom_folder": "Dreamcast",
        "rom_folder_aliases": ["dreamcast", "dc"],
        "coolrom": "dc",
        "romsfun": "sega-dreamcast",
        "emulator_ids": ["flycast"],
    },
    {
        "boxshelf_id": "saturn",
        "label": "Sega Saturn",
        "rom_folder": "Saturn",
        "rom_folder_aliases": ["saturn", "sega saturn"],
        "coolrom": "saturn",
        "romsfun": "sega-saturn",
        "emulator_ids": ["retroarch"],
    },
    {
        "boxshelf_id": "mastersystem",
        "label": "Sega Master System",
        "rom_folder": "Master System",
        "rom_folder_aliases": ["mastersystem", "master system", "sms"],
        "coolrom": "mastersystem",
        "romsfun": "sega-master-system",
        "emulator_ids": ["retroarch"],
    },
    {
        "boxshelf_id": "gamegear",
        "label": "Sega Game Gear",
        "rom_folder": "Game Gear",
        "rom_folder_aliases": ["gamegear", "game gear", "gg"],
        "coolrom": "gamegear",
        "romsfun": "sega-game-gear",
        "emulator_ids": ["retroarch"],
    },
    {
        "boxshelf_id": "neogeo",
        "label": "Neo Geo",
        "rom_folder": "Neo Geo",
        "rom_folder_aliases": ["neogeo", "neo geo", "neo-geo"],
        "coolrom": "neogeo",
        "romsfun": "neo-geo",
        "emulator_ids": ["retroarch"],
    },
    {
        "boxshelf_id": "arcade",
        "label": "Arcade / MAME",
        "rom_folder": "Arcade",
        "rom_folder_aliases": ["arcade", "mame"],
        "coolrom": "mame",
        "romsfun": "mame",
        "emulator_ids": ["retroarch"],
    },
    {
        "boxshelf_id": "segacd",
        "label": "Sega CD",
        "rom_folder": "Sega CD",
        "rom_folder_aliases": ["segacd", "sega cd", "mega-cd"],
        "coolrom": "segacd",
        "romsfun": "sega-cd",
        "emulator_ids": ["retroarch"],
    },
    {
        "boxshelf_id": "atari2600",
        "label": "Atari 2600",
        "rom_folder": "Atari 2600",
        "rom_folder_aliases": ["atari2600", "atari 2600", "a2600"],
        "coolrom": "atari2600",
        "romsfun": "atari-2600",
        "emulator_ids": ["retroarch"],
    },
    {
        "boxshelf_id": "atarilynx",
        "label": "Atari Lynx",
        "rom_folder": "Atari Lynx",
        "rom_folder_aliases": ["atarilynx", "atari lynx", "lynx"],
        "coolrom": "atarilynx",
        "romsfun": "atari-lynx",
        "emulator_ids": ["retroarch"],
    },
    {
        "boxshelf_id": "nes",
        "label": "NES",
        "rom_folder": "NES",
        "rom_folder_aliases": ["nes", "famicom", "nintendo entertainment system"],
        "coolrom": None,
        "romsfun": "nes",
        "emulator_ids": ["retroarch"],
    },
    {
        "boxshelf_id": "snes",
        "label": "SNES",
        "rom_folder": "SNES",
        "rom_folder_aliases": ["snes", "sfc", "super nintendo", "super famicom"],
        "coolrom": None,
        "romsfun": "super-nintendo",
        "emulator_ids": ["retroarch"],
    },
    {
        "boxshelf_id": "gb",
        "label": "Game Boy",
        "rom_folder": "Game Boy",
        "rom_folder_aliases": ["gb", "gameboy", "game boy"],
        "coolrom": None,
        "romsfun": "game-boy",
        "emulator_ids": ["retroarch"],
    },
    {
        "boxshelf_id": "gbc",
        "label": "Game Boy Color",
        "rom_folder": "Game Boy Color",
        "rom_folder_aliases": ["gbc", "gameboy color", "game boy color"],
        "coolrom": None,
        "romsfun": "game-boy-color",
        "emulator_ids": ["retroarch"],
    },
    {
        "boxshelf_id": "gba",
        "label": "Game Boy Advance",
        "rom_folder": "GBA",
        "rom_folder_aliases": ["gba", "gameboy advance", "game boy advance"],
        "coolrom": None,
        "romsfun": "game-boy-advance",
        "emulator_ids": ["retroarch"],
    },
    {
        "boxshelf_id": "n64",
        "label": "Nintendo 64",
        "rom_folder": "N64",
        "rom_folder_aliases": ["n64", "nintendo 64"],
        "coolrom": None,
        "romsfun": "nintendo-64",
        "emulator_ids": ["retroarch"],
    },
    {
        "boxshelf_id": "nds",
        "label": "Nintendo DS",
        "rom_folder": "NDS",
        "rom_folder_aliases": ["nds", "ds", "nintendo ds"],
        "coolrom": None,
        "romsfun": "nintendo-ds",
        "emulator_ids": ["retroarch"],
    },
]

_BY_BOXSHELF = {s["boxshelf_id"]: s for s in CATALOG_SYSTEMS}
_BY_COOLROM = {s["coolrom"]: s for s in CATALOG_SYSTEMS if s.get("coolrom")}
_BY_ROMSFUN = {s["romsfun"]: s for s in CATALOG_SYSTEMS if s.get("romsfun")}

# Primer emulador del mapa → nombre visible en resultados de búsqueda
_EMU_LABEL = {
    "pcsx2": "PCSX2",
    "duckstation": "DuckStation",
    "ppsspp": "PPSSPP",
    "flycast": "Flycast",
    "blastem": "BlastEm",
    "retroarch": "RetroArch",
    "mgba": "mGBA",
    "melonds": "melonDS",
}


def catalog_systems() -> list[dict[str, Any]]:
    return list(CATALOG_SYSTEMS)


def by_boxshelf(boxshelf_id: str) -> Optional[dict[str, Any]]:
    return _BY_BOXSHELF.get((boxshelf_id or "").strip())


def resolve_provider_slug(system: str, provider: str) -> Optional[dict[str, Any]]:
    """Resuelve un slug de proveedor (o boxshelf_id) al mapa canónico."""
    s = (system or "").strip().lower()
    p = (provider or "").strip().lower()
    if s in _BY_BOXSHELF:
        return _BY_BOXSHELF[s]
    if p == "romsfun.com" or p == "romsfun":
        return _BY_ROMSFUN.get(s)
    if p in ("coolrom.com", "coolrom", ""):
        hit = _BY_COOLROM.get(s)
        if hit:
            return hit
    return _BY_COOLROM.get(s) or _BY_ROMSFUN.get(s)


def annotate_rom(rom: dict[str, Any]) -> dict[str, Any]:
    """Añade boxshelf_id / rom_folder / emulator a un dict de ROM de la API."""
    out = dict(rom)
    provider = str(out.get("provider") or "")
    slug = str(out.get("system") or "")
    meta = resolve_provider_slug(slug, provider)
    if not meta and slug:
        # slug directo o alias (p.ej. romsfun "nes", coolrom suelto)
        meta = _BY_BOXSHELF.get(slug) or next(
            (s for s in CATALOG_SYSTEMS if slug in (s.get("rom_folder_aliases") or [])),
            None,
        )
        if not meta and (provider.endswith("romsfun.com") or "romsfun" in provider):
            meta = _BY_ROMSFUN.get(slug)
    if meta:
        out["boxshelf_id"] = meta["boxshelf_id"]
        out["rom_folder"] = meta["rom_folder"]
        out["platform"] = meta["label"]
        out["console_label"] = meta["label"]
        eids = meta.get("emulator_ids") or []
        eid = eids[0] if eids else ""
        out["emulator_id"] = eid or None
        out["emulator"] = _EMU_LABEL.get(eid, eid.title() if eid else "Emulator")
    else:
        out.setdefault("boxshelf_id", slug or None)
        # Nunca dejar rom_folder vacío: evita caer en ROMS\ROMs genérico
        out.setdefault("rom_folder", (slug or "ROMs").replace("-", " ").title() if slug else "ROMs")
        out.setdefault("console_label", out.get("platform") or slug or "Unknown")
        out.setdefault("emulator", "—")
    return out


def _norm_title(s: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def dedupe_and_rank(roms: list[dict[str, Any]], query: str = "") -> list[dict[str, Any]]:
    """Una fila por (consola, título normalizado), priorizando coincidencia exacta y sin hacks/piratas."""
    qn = _norm_title(query)
    best: dict[tuple[str, str], tuple[int, dict[str, Any]]] = {}
    for r in roms or []:
        name = str(r.get("name") or "")
        sid = str(r.get("boxshelf_id") or r.get("system") or "")
        nn = _norm_title(name)
        if not nn:
            continue
        key = (sid, nn)
        score = 0
        if qn and nn == qn:
            score += 100
        elif qn and (qn in nn or nn in qn):
            score += 60
        elif qn and nn.startswith(qn[: max(4, len(qn) // 2)]):
            score += 30
        low = name.lower()
        if any(x in low for x in ("hack", "pirate", "100-in-1", "beta", "proto", "sample", "demo")):
            score -= 40
        if r.get("emulator"):
            score += 5
        if "romsfun" in str(r.get("provider") or "").lower():
            score += 2  # a menudo mejor anotado para Nintendo
        prev = best.get(key)
        if not prev or score > prev[0]:
            best[key] = (score, r)
    ranked = sorted(best.values(), key=lambda x: (-x[0], str(x[1].get("name") or "").lower()))
    return [r for _, r in ranked]


def provider_params_for(boxshelf_id: str, preferred: str = "coolrom.com") -> Optional[dict[str, str]]:
    """Params system+provider para /api/roms a partir de boxshelf_id."""
    meta = by_boxshelf(boxshelf_id)
    if not meta:
        return None
    pref = (preferred or "coolrom.com").strip().lower()
    if pref in ("romsfun.com", "romsfun") and meta.get("romsfun"):
        return {"system": meta["romsfun"], "provider": "romsfun.com"}
    if meta.get("coolrom"):
        return {"system": meta["coolrom"], "provider": "coolrom.com"}
    if meta.get("romsfun"):
        return {"system": meta["romsfun"], "provider": "romsfun.com"}
    return None
