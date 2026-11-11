// (beta.12, Seamless play) Watches a game Boxshelf didn't start itself: a Steam game (started with steam://rungameid) or a
// store's game (Epic, Ubisoft Connect, the EA app, Xbox), so it gets what a game Boxshelf started gets: the Home menu, the
// return to the shelf when it ends, and its playtime. Windows only, and nothing here runs unless a game is being watched.
//   - Steam: HKCU\Software\Valve\Steam\RunningAppID says which Steam game is running (read with reg.exe).
//   - Every store: the game's process is one whose program sits inside the game's install folder (one process listing
//     per poll, through PowerShell's Get-CimInstance, never on the main thread).
// Polling: every 2 s while waiting for the game to show up (90 s at most, then 'timeout'); once it runs, a cheap check that
// its processes are still alive (no process listing) every half second, and a fresh listing only when they're all gone (a
// game's own launcher may hand over to the real game) or every 15 s to be sure.
// Closing: the game's own processes are asked to close (taskkill without /F, like a click on the X), forced after a wait.
// Steam, the store launchers and their helpers are never touched.
// One watch at a time (one game at a time, like everything Boxshelf starts). The readers are injectable for the tests.
'use strict';
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const W = path.win32; // (install folders are Windows paths, also when the tests run elsewhere)

// launchers, their helpers and Windows' own: never the game, never closed
const LAUNCHERS = /^(steam|steamwebhelper|steamservice|steamerrorreporter(64)?|gameoverlayui(64)?|steamtours|epicgameslauncher|epicwebhelper|epiconlineservices(host|userhelper|uihelper)?|galaxyclient( helper)?|galaxycommunication|gogcomposer|upc|uplaywebcore|uplayservice|ubisoftconnect|ubisoftgamelauncher(64)?|uplaycrashreporter|eadesktop|eabackgroundservice|ealocalhostsvc|ealauncher|eaconnect_microsoft|origin|originwebhelperservice|originclientservice|xboxpcapp|xboxapp|xboxappservices|gamingservices(net)?|gamebar(ftserver)?|explorer|boxshelf|powershell|cmd|conhost|taskkill)\.exe$/i;
// helpers inside a game's folder: closed with the game, but never taken for the game itself
const HELPERS = /^(unitycrashhandler(32|64)?|crashreportclient|crashpad_handler|.*crash.?report(er)?.*|easyanticheat(_eos)?(_setup)?|start_protected_game|beservice(_x64)?|battleye.*|vc_?redist.*|dxsetup|ue4prereqsetup.*|uninstall.*|unins\d*)\.exe$/i;

const norm = p => W.resolve(String(p || '')).replace(/[\\/]+$/, '').toLowerCase();
// is this program inside that folder (the folder itself excluded)?
function under(dir, exe) { if (!dir || !exe) return false; const d = norm(dir), e = norm(exe); return e.length > d.length + 1 && e.startsWith(d + '\\'); }
const isLauncher = name => LAUNCHERS.test(String(name || ''));

// ---------- the real readers (Windows) ----------
const run = (cmd, args, ms) => new Promise(res => { try { execFile(cmd, args, { windowsHide: true, timeout: ms, maxBuffer: 16 << 20 }, (err, out) => res(err && !out ? '' : String(out || ''))); } catch { res(''); } });
// Steam's running game: a number, 0 when none, null when it can't be read
// (beta.12, Linux) the same answers from /proc: Steam starts each game with SteamAppId (or SteamGameId) in its environment,
// so a game process names its own app id; Proton games run as wine with the game's Windows path (Z:\home\...) on the
// command line, which is turned back into the Linux path. Steam's own helpers (reaper, pressure-vessel, the runtime) are
// never taken for the game
const LINUX_SKIP = /^(steam|steamwebhelper|reaper|steam-launch-wr.*|pressure-vessel.*|pv-bwrap|pv-adverb|fossilize_repla.*|bwrap|srt-.*|steam-runtime.*|gameoverlayui|wineserver|services\.exe|winedevice\.exe|explorer\.exe|plugplay\.exe|rpcss\.exe|tabtip\.exe|conhost\.exe|boxshelf.*)$/i;
// o.env: read each process's environment too (for its app id); only for the ones not skipped (cheaper: one file less each)
function linuxProcs(o = {}, procDir = '/proc') {
  if (typeof o === 'string') { procDir = o; o = { env: true }; }
  const out = []; let names = []; try { names = fs.readdirSync(procDir).filter(n => /^\d+$/.test(n)); } catch { return out; }
  for (const n of names) {
    const dir = path.join(procDir, n); let comm = '', argv = [], exe = '', env = '';
    try { comm = fs.readFileSync(path.join(dir, 'comm'), 'utf8').trim(); } catch { continue; }
    if (LINUX_SKIP.test(comm)) { out.push({ pid: +n, name: comm, exe: '', appid: 0, skip: true }); continue; }
    try { argv = fs.readFileSync(path.join(dir, 'cmdline'), 'utf8').split('\0').filter(Boolean); } catch {}
    try { exe = fs.readlinkSync(path.join(dir, 'exe')); } catch {}
    if (o.env) { try { env = fs.readFileSync(path.join(dir, 'environ'), 'utf8'); } catch {} }
    const winPath = argv.find(a => /^[a-z]:\\.+\.exe$/i.test(a)), unixPath = winPath && /^z:\\/i.test(winPath) ? '/' + winPath.slice(3).replace(/\\/g, '/') : '';
    const m = /(?:^|\0)Steam(?:App|Game)Id=(\d+)/.exec(env);
    out.push({ pid: +n, name: comm, exe: unixPath || exe, appid: m ? +m[1] : 0, skip: false });
  }
  return out;
}
async function readRunningAppId(want) {
  // (Linux: the one asked for when any game process has it; Boxshelf's own id, when Steam started Boxshelf, never counts)
  if (process.platform === 'linux') { const own = new Set([+process.env.SteamAppId || 0, +process.env.SteamGameId || 0].filter(Boolean));
    const ids = linuxProcs({ env: true }).filter(x => x.appid && !x.skip && x.pid !== process.pid && !own.has(x.appid)).map(x => x.appid);
    return want && ids.includes(+want) ? +want : ids[0] || 0; }
  if (process.platform !== 'win32') return null;
  const out = await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'RunningAppID'], 5000);
  const m = /RunningAppID\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out); return m ? parseInt(m[1], 16) : null;
}
// every process with its program: [{ pid, exe, name }] (a process whose program can't be read has exe '')
const LIST_PS = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Property ProcessId,Name,ExecutablePath | ForEach-Object { [string]$_.ProcessId + '|' + $_.Name + '|' + $_.ExecutablePath }";
function parseList(out) {
  const list = [];
  for (const line of String(out || '').split(/\r?\n/)) { const m = /^(\d+)\|([^|]*)\|(.*)$/.exec(line.trim()); if (m && +m[1] > 0) list.push({ pid: +m[1], name: m[2].trim(), exe: m[3].trim() }); }
  return list;
}
async function listProcesses() {
  if (process.platform === 'linux') return linuxProcs({ env: false }).filter(p => !p.skip).map(({ pid, name, exe }) => ({ pid, name, exe }));
  if (process.platform !== 'win32') return [];
  return parseList(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', LIST_PS], 15000));
}
// still running? (a process Boxshelf may not open, an elevated game, still counts as running)
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); } }
// ask to close (like a click on the X), or force it and whatever it started
function kill(pid, force) {
  if (process.platform === 'linux') { try { process.kill(pid, force ? 'SIGKILL' : 'SIGTERM'); } catch {} return; } // (beta.12)
  if (process.platform !== 'win32') return;
  try { const c = execFile('taskkill', ['/PID', String(pid), ...(force ? ['/T', '/F'] : [])], { windowsHide: true }, () => {}); c.on('error', () => {}); } catch {}
}

// ---------- Steam: a game's install folder ----------
function readVdf(f) { try { return require('./vdf').parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } }
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
// <library>\steamapps\common\<installdir> from appmanifest_<appid>.acf, in any of Steam's libraries ('' when not found).
// roots: Steam's own folder and / or the folder set in Settings (which may be a library on another drive)
function steamInstallDir(roots, appid) {
  if (!/^\d+$/.test(String(appid))) return '';
  let steam = null; try { steam = require('./steam'); } catch { return ''; }
  const libs = [];
  for (const r of (Array.isArray(roots) ? roots : [roots]).filter(Boolean)) {
    const root = steam.steamRoot(r); if (!root) continue;
    for (const l of (steam.libraryFolders ? steam.libraryFolders(root) : [root])) if (!libs.some(x => norm(x) === norm(l))) libs.push(l);
  }
  for (const lib of libs) {
    const m = readVdf(path.join(lib, 'steamapps', 'appmanifest_' + appid + '.acf'));
    const st = m && (m.AppState || m.appstate), dir = st && (st.installdir || st.InstallDir);
    if (dir) { const full = path.join(lib, 'steamapps', 'common', String(dir)); if (isDir(full)) return full; }
  }
  return '';
}

// ---------- the watcher ----------
function create(deps = {}) {
  const d = Object.assign({ readRunningAppId, listProcesses, alive, kill, now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: t => clearTimeout(t), log: () => {}, selfPid: process.pid }, deps);
  const T = Object.assign({ waitPollMs: 2000, alivePollMs: 500, verifyMs: 15000, giveUpMs: 90000, appidOnlyMs: 15000, steamGraceMs: 10000 }, deps.times || {});
  let cur = null;

  // the game's processes in a listing: inside its folder, not a launcher, not Boxshelf
  const gameProcs = (list, w) => (list || []).filter(p => p && p.pid > 0 && p.pid !== d.selfPid && !isLauncher(p.name || W.basename(p.exe || '')) && under(w.dir, p.exe));
  // the one to follow for its window: the program the store names, else the first that isn't a helper
  function pick(found, w) {
    const want = w.exe ? W.basename(w.exe).toLowerCase() : '';
    return (want && found.find(p => W.basename(p.exe).toLowerCase() === want)) || found.find(p => !HELPERS.test(W.basename(p.exe))) || found[0];
  }

  function schedule(w, ms) { if (w.timer) d.clearTimeout(w.timer); w.timer = d.setTimeout(() => { w.timer = null; tick(w); }, ms); }
  function finish(w, state, ev, info) {
    if (w.state === 'ended' || w.state === 'stopped') return;
    w.state = state; if (w.timer) { d.clearTimeout(w.timer); w.timer = null; } if (w.forceT) { d.clearTimeout(w.forceT); w.forceT = null; }
    if (cur === w) cur = null;
    if (ev) { try { w.emit(ev, info || {}); } catch (e) { d.log('game watch:', ev, 'handler failed:', e && e.message); } }
  }
  function started(w, found) {
    w.state = 'running'; w.startedAt = d.now(); w.verifiedAt = w.startedAt;
    w.pids = new Set(found.map(p => p.pid)); const p = found.length ? pick(found, w) : null; w.pid = p ? p.pid : 0;
    d.log('game watch: started', w.pid ? `(process ${w.pid}, ${W.basename(p.exe)})` : '(Steam says it runs; no process found in its folder)', 'after', w.startedAt - w.t0, 'ms');
    try { w.emit('started', w.pid, { exe: p ? p.exe : '', name: p ? p.name : '' }); } catch (e) { d.log('game watch: started handler failed:', e && e.message); }
  }

  async function tick(w) {
    if (w !== cur || w.busy) return;
    w.busy = true;
    try { await step(w); } catch (e) { d.log('game watch: poll failed:', e && e.message); }
    finally { w.busy = false; }
    if (w === cur && w.state !== 'ended' && w.state !== 'stopped' && !w.timer) schedule(w, w.state === 'running' && w.pids.size ? T.alivePollMs : T.waitPollMs);
  }
  async function step(w) {
    const now = d.now();
    if (w.state === 'waiting') {
      if (now - w.t0 >= T.giveUpMs) { d.log('game watch: no game process after', Math.round((now - w.t0) / 1000), 's: no longer watching'); return finish(w, 'stopped', 'timeout'); }
      const id = w.kind === 'steam' ? await d.readRunningAppId(w.appid) : null;
      if (w !== cur) return;
      if (w.dir) { const found = gameProcs(await d.listProcesses(), w); if (w !== cur) return; if (found.length) return started(w, found); }
      // Steam says the game runs but nothing runs from its folder (a game that runs from elsewhere): followed by Steam's word alone
      if (w.kind === 'steam' && id === +w.appid) { if (!w.appidAt) w.appidAt = now; if (!w.dir || now - w.appidAt >= T.appidOnlyMs) return started(w, []); }
      return;
    }
    if (w.state !== 'running') return;
    if (!w.pids.size) { // followed by Steam's word alone: it ends when Steam says no game runs (twice in a row)
      const id = await d.readRunningAppId(w.appid); if (w !== cur) return;
      w.misses = id === +w.appid || id == null ? 0 : (w.misses || 0) + 1;
      if (w.misses >= 2) finish(w, 'ended', 'ended', { ms: now - w.startedAt });
      return;
    }
    const living = [...w.pids].filter(p => d.alive(p));
    if (living.length && now - w.verifiedAt < T.verifyMs) { if (living.length !== w.pids.size) w.pids = new Set(living); return; }
    // all gone (or time to make sure it's still the game): a fresh look in its folder
    w.verifiedAt = now;
    const list = await d.listProcesses(); if (w !== cur) return;
    // (no listing at all: PowerShell failed or timed out; that's no proof the game ended. Three in a row with its processes gone is)
    if (!list.length) { if (living.length) return; w.listFails = (w.listFails || 0) + 1; if (w.listFails < 3) return; }
    else w.listFails = 0;
    const found = gameProcs(list, w);
    // (a process whose program can't be read, e.g. one running as administrator, that's still alive stays the game)
    if (!found.length && living.length) { const still = living.filter(pid => list.some(p => p.pid === pid && !p.exe)); if (still.length) { w.pids = new Set(still); return; } }
    if (found.length) { w.pids = new Set(found.map(p => p.pid)); if (!w.pids.has(w.pid)) { const p = pick(found, w); d.log('game watch: the game goes on in', W.basename(p.exe), '(process', p.pid + ')'); w.pid = p.pid; try { w.emit('handover', w.pid, { exe: p.exe }); } catch {} } w.goneAt = 0; return; }
    // Steam still says it runs: a game restarting itself; a few more seconds
    // (beta.12) still Steam's after the grace: an outside launcher's hand-off (Rockstar, EA, Ubisoft sign-in or update can
    // take longer): back to waiting for the real game (the give-up clock from now) instead of ending over it
    if (w.kind === 'steam' && w.appid) { const id = await d.readRunningAppId(w.appid); if (w !== cur) return; if (id === +w.appid) { if (!w.goneAt) w.goneAt = now; if (now - w.goneAt < T.steamGraceMs) return;
      if (!w.closing) { d.log('game watch: its processes are gone but Steam says it still runs: waiting for the game again'); w.state = 'waiting'; w.t0 = now; w.pids = new Set(); w.pid = 0; w.goneAt = 0; w.appidAt = 0; return; } } }
    finish(w, 'ended', 'ended', { ms: now - w.startedAt });
  }

  // spec: { kind: 'steam' | 'epic' | 'ubisoft' | 'ea' | 'xbox' | …, appid?, dir?, exe?, title? } → the watch (events:
  // 'started' (pid, { exe, name }), 'handover' (pid), 'ended' ({ ms, cancelled? }), 'timeout')
  function watch(spec) {
    stop();
    const s = spec || {};
    const w = Object.assign(new EventEmitter(), { kind: String(s.kind || ''), appid: s.appid ? String(s.appid) : '', dir: s.dir ? String(s.dir) : '', exe: s.exe ? String(s.exe) : '', title: String(s.title || ''),
      state: 'waiting', t0: d.now(), pids: new Set(), pid: 0, timer: null, busy: false });
    cur = w;
    d.log('game watch: waiting for', w.title || w.kind, w.dir ? '(its folder known)' : '(no install folder known)');
    schedule(w, T.waitPollMs);
    return w;
  }
  // stop watching (no events)
  function stop() { const w = cur; if (!w) return; finish(w, 'stopped'); }
  // Close the game: its processes asked to close, forced forceAfterMs later if still there (onForce(pids) then). Launchers
  // are never touched. Still waiting for it to show up: nothing is running yet, the watch just ends ('ended', cancelled).
  async function close(forceAfterMs = 8000, onForce) {
    const w = cur; if (!w) return false;
    const targets = async () => {
      const set = new Set([...w.pids]);
      if (w.dir) { try { for (const p of gameProcs(await d.listProcesses(), w)) set.add(p.pid); } catch {} }
      return [...set].filter(p => p > 0 && p !== d.selfPid);
    };
    if (w.closing) { for (const p of await targets()) d.kill(p, false); return true; } // pressed again: asked again, the first deadline kept
    w.closing = true;
    const list = await targets();
    if (w !== cur) return true;
    if (!list.length && w.state === 'waiting') { d.log('game watch: closed before the game showed up'); finish(w, 'ended', 'ended', { ms: 0, cancelled: true }); return true; }
    d.log('game watch: asking the game to close (' + list.length + ' process' + (list.length === 1 ? '' : 'es') + ')');
    if (list.length && w.state === 'waiting') { w.state = 'running'; w.startedAt = d.now(); w.verifiedAt = w.startedAt; w.pids = new Set(list); w.pid = list[0]; } // (it showed up just now: followed until it has closed)
    for (const p of list) d.kill(p, false);
    const ms = Number.isFinite(+forceAfterMs) && +forceAfterMs >= 0 ? +forceAfterMs : 8000;
    w.forceT = d.setTimeout(async () => {
      w.forceT = null; if (w !== cur) return;
      const left = (await targets()).filter(p => d.alive(p)); if (w !== cur || !left.length) return;
      d.log('game watch: forcing the game closed (' + left.length + ' left)');
      for (const p of left) d.kill(p, true);
      if (typeof onForce === 'function') { try { onForce(left); } catch {} }
    }, ms);
    if (!w.timer && !w.busy) schedule(w, T.alivePollMs);
    return true;
  }
  // look again now (the game's window just went: notice the end without waiting for the next poll)
  function poke() { const w = cur; if (w && !w.busy) schedule(w, 0); }

  return { watch, stop, close, poke, active: () => cur, polling: () => !!(cur && (cur.timer || cur.busy)) };
}

module.exports = Object.assign(create(), { create, steamInstallDir, under, isLauncher, parseList, linuxProcs, readers: { readRunningAppId, listProcesses }, LAUNCHERS, HELPERS });
