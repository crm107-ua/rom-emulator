// (beta.12, Windows) RocketLauncher, the launcher HyperSpin uses: found on this PC, its systems and their ROM folders read
// from its own settings, the command line built for one game, and the first error of a run read back from its log.
// Plan and research: docs/ROCKETLAUNCHER-PLAN.md. Nothing here starts a process: main.js does, through launcher.js.
'use strict';
const fs = require('fs'), path = require('path');

// HyperSpin's usual system names for Boxshelf's consoles (then matched against RocketLauncher's own folder names, which
// win: a setup can name a system its own way). Several names: the first is the usual one.
const NAMES = {
  nes: ['Nintendo Entertainment System'], snes: ['Super Nintendo Entertainment System'], n64: ['Nintendo 64'],
  gb: ['Nintendo Game Boy'], gbc: ['Nintendo Game Boy Color'], gba: ['Nintendo Game Boy Advance'], nds: ['Nintendo DS'],
  n3ds: ['Nintendo 3DS'], gc: ['Nintendo GameCube'], wii: ['Nintendo Wii'], wiiu: ['Nintendo Wii U'], sw: ['Nintendo Switch'],
  psx: ['Sony PlayStation'], ps2: ['Sony PlayStation 2'], ps3: ['Sony PlayStation 3'], psp: ['Sony PSP'],
  megadrive: ['Sega Genesis', 'Sega Mega Drive'], mastersystem: ['Sega Master System', 'Sega Mark III'], gamegear: ['Sega Game Gear'],
  segacd: ['Sega CD', 'Sega Mega-CD'], sega32x: ['Sega 32X'], saturn: ['Sega Saturn'], dreamcast: ['Sega Dreamcast'],
  pcengine: ['NEC TurboGrafx-16', 'NEC PC Engine'], neogeo: ['SNK Neo Geo AES', 'SNK Neo Geo'], arcade: ['MAME'],
  atari2600: ['Atari 2600'], atarilynx: ['Atari Lynx'], wonderswan: ['Bandai WonderSwan', 'Bandai WonderSwan Color'],
  x360: ['Microsoft Xbox 360'],
};
const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const exists = async f => { try { await fs.promises.access(f); return true; } catch { return false; } };

// an .ini as { section: { key: value } } (keys as written; values trimmed). RocketLauncher's files can be UTF-16
async function readIni(file) {
  let b; try { b = await fs.promises.readFile(file); } catch { return null; }
  const t = (b[0] === 0xff && b[1] === 0xfe) ? b.toString('utf16le') : b.toString('utf8').replace(/^﻿/, '');
  const out = {}; let sec = '';
  for (const raw of t.split(/\r?\n/)) { const l = raw.trim(); if (!l || l[0] === ';' || l[0] === '#') continue;
    const m = /^\[(.+)\]$/.exec(l); if (m) { sec = m[1].trim(); out[sec] = out[sec] || {}; continue; }
    const i = l.indexOf('='); if (i > 0) { (out[sec] = out[sec] || {})[l.slice(0, i).trim()] = l.slice(i + 1).trim(); } }
  return out;
}
const sectionOf = (ini, name) => { if (!ini) return null; const k = Object.keys(ini).find(s => s.toLowerCase() === name.toLowerCase()); return k ? ini[k] : null; };
const valOf = (sec, name) => { if (!sec) return ''; const k = Object.keys(sec).find(s => s.toLowerCase() === name.toLowerCase()); return k ? sec[k] : ''; };

// RocketLauncher.exe on this PC: the usual HyperSpin places on each drive, and HyperSpin's own setting for it
async function find() {
  const drives = []; for (let c = 67; c <= 90; c++) { const d = String.fromCharCode(c) + ':\\'; if (await exists(d)) drives.push(d); }
  const tries = [];
  for (const d of drives) {
    tries.push(path.join(d, 'HyperSpin', 'RocketLauncher', 'RocketLauncher.exe'), path.join(d, 'RocketLauncher', 'RocketLauncher.exe'),
      path.join(d, 'Games', 'HyperSpin', 'RocketLauncher', 'RocketLauncher.exe'), path.join(d, 'Emulation', 'RocketLauncher', 'RocketLauncher.exe'));
    // HyperSpin's Settings\Settings.ini → [Main] Hyperlaunch_Path (RocketLauncher's folder, often relative to HyperSpin's)
    const hs = path.join(d, 'HyperSpin'), ini = await readIni(path.join(hs, 'Settings', 'Settings.ini'));
    const p = valOf(sectionOf(ini, 'Main'), 'Hyperlaunch_Path'); if (p) tries.unshift(path.join(path.resolve(hs, p), 'RocketLauncher.exe'));
  }
  for (const f of tries) if (await exists(f)) return f;
  return '';
}

// its systems: one folder each under Settings\, with the ROM folders and default emulator from that folder's
// Emulators.ini. A system without a Default_Emulator isn't set up in RocketLauncherUI yet (ready: false)
let sysCache = { exe: '', at: 0, list: [] };
async function systems(exe, fresh) {
  if (!exe) return [];
  if (!fresh && sysCache.exe === exe && Date.now() - sysCache.at < 60000) return sysCache.list;
  const dir = path.dirname(exe), sdir = path.join(dir, 'Settings'), list = [];
  let ents = []; try { ents = await fs.promises.readdir(sdir, { withFileTypes: true }); } catch {}
  for (const e of ents) { if (!e.isDirectory() || /^global$/i.test(e.name)) continue;
    const ini = await readIni(path.join(sdir, e.name, 'Emulators.ini')), roms = sectionOf(ini, 'ROMS');
    const romPaths = String(valOf(roms, 'Rom_Path') || '').split('|').map(s => s.trim()).filter(Boolean).map(p => path.resolve(dir, p.replace(/[\\/]/g, path.sep))); /* (beta.12) RocketLauncher's own \ separators read on any system (the tests run on Linux too) */
    const emu = valOf(roms, 'Default_Emulator');
    list.push({ name: e.name, romPaths, defaultEmu: emu, ready: !!emu }); }
  list.sort((a, b) => a.name.localeCompare(b.name));
  sysCache = { exe, at: Date.now(), list }; return list;
}

// the system name for a console: RocketLauncher's own folder that matches one of the usual names, else the usual name
function nameFor(consoleId, list) {
  const want = (NAMES[consoleId] || []).map(key), hit = (list || []).find(s => want.includes(key(s.name)));
  return hit ? hit.name : (NAMES[consoleId] || [''])[0];
}
const usualName = consoleId => (NAMES[consoleId] || [''])[0];

// -s system, -r the game: its name without the extension when it sits in one of the system's ROM folders (what
// RocketLauncher's 7z extraction and MultiGame need), else its full path (RocketLauncher takes that too); -p the front
// end's plugin when one is set. Never -f: RocketLauncher would hide, move or restore that window (Boxshelf's)
function argsFor({ system, file, list, plugin }) {
  const sys = (list || []).find(s => key(s.name) === key(system));
  const dir = path.resolve(path.dirname(String(file))).toLowerCase();
  const inRoms = !!(sys && sys.romPaths.some(p => path.resolve(p).toLowerCase() === dir));
  const r = inRoms ? path.basename(file, path.extname(file)) : path.resolve(String(file));
  const a = ['-s', String(system), '-r', r];
  if (plugin) a.push('-p', String(plugin));
  return { args: a, inRoms, ready: sys ? sys.ready : null, known: !!sys };
}

// the first error RocketLauncher wrote during a run (it always exits "normally", so its log is the only way to know)
async function lastError(exe, sinceMs) {
  const f = path.join(path.dirname(exe || ''), 'RocketLauncher.log');
  let st; try { st = await fs.promises.stat(f); } catch { return ''; }
  if (sinceMs && st.mtimeMs < sinceMs - 2000) return '';
  let t = ''; try { const fh = await fs.promises.open(f, 'r'); const n = Math.min(st.size, 128 * 1024), b = Buffer.alloc(n); try { await fh.read(b, 0, n, st.size - n); } finally { await fh.close().catch(() => {}); } t = b.toString('utf8'); } catch { return ''; }
  const i = t.lastIndexOf('Main - Raw CLI received'); if (i >= 0) t = t.slice(i);
  const line = t.split(/\r?\n/).find(l => /\|\s*ERROR\s*\|/i.test(l));
  return line ? line.split('|').slice(3).join('|').trim().slice(0, 200) : '';
}

// is this console started through RocketLauncher? (Windows, found, and the mode or the console's own choice)
function useFor(consoleId, cfg) {
  if (process.platform !== 'win32') return false;
  const r = (cfg && cfg.rocket) || {}, sc = (cfg && cfg.systems && cfg.systems[consoleId]) || {};
  if (!r.exe || r.mode === 'off' || !r.mode) return false;
  if (sc.viaRocket === false) return false;
  return r.mode === 'all' ? true : sc.viaRocket === true;
}

module.exports = { find, systems, nameFor, usualName, argsFor, lastError, useFor, readIni, NAMES };
