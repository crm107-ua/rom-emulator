"""Catálogo de emuladores PC (releases oficiales) para el solape Boxshelf."""

from __future__ import annotations

from typing import Any

# URLs de descarga: apuntan a páginas oficiales de release / latest.
# La instalación real la hace Electron (emuinstall.js) resolviendo el asset
# cuando hace falta; aquí documentamos carpeta, exe y páginas oficiales.
EMULATORS: list[dict[str, Any]] = [
    {
        "id": "duckstation",
        "name": "DuckStation",
        "systems": ["psx"],
        "folder": "DuckStation",
        "exe_names": [
            "duckstation-qt-x64-ReleaseLTCG.exe",
            "duckstation-qt-x64-Release.exe",
            "duckstation.exe",
        ],
        "page_url": "https://github.com/stenzek/duckstation/releases/latest",
        "asset_hint": "windows-x64-release.zip",
        "github": "stenzek/duckstation",
        "notes": "PlayStation 1. BIOS en Boxshelf\\BIOS si hace falta.",
    },
    {
        "id": "pcsx2",
        "name": "PCSX2",
        "systems": ["ps2"],
        "folder": "PCSX2",
        "exe_names": ["pcsx2-qt.exe", "pcsx2.exe"],
        "page_url": "https://github.com/PCSX2/pcsx2/releases/latest",
        "asset_hint": "windows-x64-Qt.7z",
        "github": "PCSX2/pcsx2",
        "notes": "PlayStation 2.",
    },
    {
        "id": "ppsspp",
        "name": "PPSSPP",
        "systems": ["psp"],
        "folder": "PPSSPP",
        "exe_names": ["PPSSPPWindows64.exe", "PPSSPPWindows.exe"],
        "page_url": "https://www.ppsspp.org/download/",
        "asset_hint": "ppsspp_win.zip",
        "download_url": "https://www.ppsspp.org/files/1.17.1/ppsspp_win.zip",
        "notes": "PSP. download_url puede quedar desfasada; la página oficial es la fuente.",
    },
    {
        "id": "flycast",
        "name": "Flycast",
        "systems": ["dreamcast"],
        "folder": "Flycast",
        "exe_names": ["flycast.exe"],
        "page_url": "https://github.com/flyinghead/flycast/releases/latest",
        "asset_hint": "win64.zip",
        "github": "flyinghead/flycast",
        "notes": "Dreamcast.",
    },
    {
        "id": "blastem",
        "name": "BlastEm",
        "systems": ["megadrive"],
        "folder": "BlastEm",
        "exe_names": ["blastem.exe"],
        "page_url": "https://www.retrodev.com/blastem/",
        "notes": "Sega Genesis / Mega Drive standalone.",
    },
    {
        "id": "retroarch",
        "name": "RetroArch",
        "systems": [
            "megadrive",
            "mastersystem",
            "gamegear",
            "saturn",
            "neogeo",
            "arcade",
            "segacd",
            "atari2600",
            "atarilynx",
        ],
        "folder": "RetroArch",
        "exe_names": ["retroarch.exe"],
        "page_url": "https://buildbot.libretro.com/stable/",
        "download_url": "https://buildbot.libretro.com/stable/1.19.1/windows/x86_64/RetroArch.7z",
        "notes": "Cores vía Online Updater. Cubre Saturn, SMS, GG, Neo Geo, MAME, Atari, etc.",
    },
]


def list_emulators(system: str | None = None) -> list[dict[str, Any]]:
    sid = (system or "").strip().lower()
    if not sid:
        return list(EMULATORS)
    return [e for e in EMULATORS if sid in e.get("systems", [])]


def get_emulator(emu_id: str) -> dict[str, Any] | None:
    for e in EMULATORS:
        if e["id"] == emu_id:
            return e
    return None
