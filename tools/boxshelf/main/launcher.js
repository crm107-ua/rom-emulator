// Starts emulators, Steam games and media apps, and reports when they close.
const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const { shell } = require('electron');
const { isFile, expand } = require('./paths');

let running = null;

// Split an options string like  -b -e "{rom}"  into arguments, filling in {rom}.
function buildArgs(template, rom) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  // (beta.12) {romname}: the game's file name without its extension; {romdir}: its folder (for launchers that want those)
  const rn = rom ? path.basename(rom, path.extname(rom)) : '', rd = rom ? path.dirname(rom) : '';
  while ((m = re.exec(template || ''))) out.push((m[1] !== undefined ? m[1] : m[2]).replace(/\{rom\}/g, () => rom || '').replace(/\{romname\}/g, () => rn).replace(/\{romdir\}/g, () => rd)); // a function: a path like Ca$$h\game.iso must not be read as a replacement pattern
  return out.filter(a => a !== '');
}

// (beta.12, Linux) Boxshelf's own AppImage sets variables that are its own (APPDIR, APPIMAGE, ARGV0, OWD) and can put its
// folders in PATH / LD_LIBRARY_PATH: an emulator started with them could load Boxshelf's libraries, or an AppImage emulator
// think it was Boxshelf. They're taken out (and Chromium's own) before an emulator starts
function cleanEnv(src) {
  const e = { ...src }, dir = e.APPDIR || '';
  if (e.ORIGINAL_XDG_CURRENT_DESKTOP) e.XDG_CURRENT_DESKTOP = e.ORIGINAL_XDG_CURRENT_DESKTOP; // (Electron changes it for itself; the emulator gets the desktop's own)
  for (const k of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD', 'CHROME_DESKTOP', 'ELECTRON_RUN_AS_NODE', 'ORIGINAL_XDG_CURRENT_DESKTOP']) delete e[k];
  if (dir) for (const k of ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'GSETTINGS_SCHEMA_DIR', 'PYTHONPATH', 'PERLLIB', 'QT_PLUGIN_PATH']) {
    if (!e[k]) continue; const v = e[k].split(':').filter(p => p && !p.startsWith(dir)).join(':'); if (v) e[k] = v; else delete e[k]; }
  return e;
}
function start(exe, args, onExit, env) { // env: the emulator's own environment (PS5: the KytyJets preset); else Boxshelf's
  exe = exe && expand(String(exe).trim().replace(/^"(.*)"$/, '$1')); // same rules as the Settings check: %VAR%, {app}, pasted "quotes"
  if (!exe || !isFile(exe)) throw new Error(`Can't find ${exe || 'the program'}. Check its path in Settings.`);
  if (running) throw new Error(busyMessage());
  // detached: on Windows a normal child sits in Node's kill-on-close job object, so a Boxshelf crash or update restart
  // would take the emulator (and its unsaved game) with it. Not unref'd: the 'exit' event must still reach us.
  const opts = Object.assign({ cwd: path.dirname(exe), windowsHide: false, stdio: 'ignore', detached: true }, env ? { env } : process.platform === 'linux' ? { env: cleanEnv(process.env) } : {});
  // a .bat / .cmd can't be spawned directly (Node refuses them with EINVAL since its 2024 security fix): run it through
  // cmd.exe with every argument quoted, so a ROM name with & or spaces stays one argument
  let child;
  if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(exe)) {
    const q = s => '"' + String(s).replace(/"/g, '') + '"';
    child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '"' + [exe, ...args].map(q).join(' ') + '"'], Object.assign(opts, { windowsVerbatimArguments: true }));
  } else child = spawn(exe, args, opts);
  running = child; child.bsName = path.basename(exe, path.extname(exe)); // (beta.10) its program name, never the path: the "already running" message names it
  // (beta.12) through a .bat the process is cmd.exe: Quit asks its child (the emulator) to close politely, as for
  // RocketLauncher, instead of waiting out the force timer and killing the emulator before it saves
  if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(exe)) child.closeKids = true;
  try { onEvent('process started', child.pid); } catch {} // (beta.12, Seamless play: the launch timeline)
  const started = Date.now(); let done = false, spawned = false;
  const finish = info => { if (done) return; done = true; running = null; onExit({ ...info, ms: Date.now() - started }); };
  child.on('spawn', () => { spawned = true; });
  // failedToStart: the program never ran (EACCES, a bad exe, blocked by antivirus), so it wasn't a play
  // (beta.12) only an error before the program ran ends it here: a later one (a kill() that failed, say) doesn't mean the
  // game stopped, and ending it would bring the shelf back over a running game; its real 'exit' still comes
  child.on('error', err => { if (!spawned) finish({ code: -1, error: err.message, failedToStart: true }); });
  child.on('exit', code => finish({ code }));
  return { pid: child.pid, args };
}

function launchGame(sysCfg, rom, onExit, extraArgs = [], env = null) {
  return start(sysCfg.emulator, [...extraArgs, ...buildArgs(sysCfg.gameArgs, rom)], onExit, env);
}

function launchEmulator(sysCfg, onExit) {
  return start(sysCfg.emulator, buildArgs(sysCfg.emulatorArgs, ''), onExit);
}

function launchApp(exe, onExit, args) { return start(exe, Array.isArray(args) ? args : [], onExit); }
// (beta.12) a game through RocketLauncher: started like an app, and closed through its emulator (closeRunning)
function launchRocket(exe, args, onExit) { const r = start(exe, args, onExit); if (running) running.closeKids = true; return r; }

function launchSteam(appid) {
  if (!/^\d+$/.test(String(appid))) throw new Error('Unknown Steam game.');
  return shell.openExternal(`steam://rungameid/${appid}`);
}

function isRunning() { return !!running; }
// (beta.10) what's running, by name (a game's title once main.js gives it one, else the program's name; no folders)
function runningName() { return running ? String(running.bsName || '').trim().slice(0, 120) : ''; }
function setRunningName(n) { if (running && n) running.bsName = String(n); }
function busyMessage() { const n = runningName(); return n ? `${n} is already running. Close it first.` : 'Something is already running. Close it first.'; }
function stopRunning() { if (running) { try { running.kill(); } catch {} } }
// a helper spawn (taskkill) that can't be found or started must not become an uncaught 'error' event
function quiet(cmd, args) { try { const c = spawn(cmd, args, { windowsHide: true, stdio: 'ignore' }); c.on('error', () => {}); return c; } catch { return null; } }
// (beta.12, Linux) a process and everything it started, from /proc (parent ids): a Flatpak's emulator sits in a session of
// its own inside the sandbox, so its process group alone doesn't reach it
function linuxTree(root, procDir = '/proc') {
  const fs = require('fs'), kids = new Map();
  let names = []; try { names = fs.readdirSync(procDir).filter(n => /^\d+$/.test(n)); } catch { return []; }
  for (const n of names) { try { const st = fs.readFileSync(path.join(procDir, n, 'stat'), 'utf8'), m = /\)\s+\S+\s+(\d+)/.exec(st.slice(st.lastIndexOf(')'))); /* (after the last ")": a program's name can hold one) */ if (m) { const pp = +m[1]; if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(+n); } } catch {} }
  const out = [], seen = new Set(), q = [+root];
  while (q.length) { const p = q.shift(); if (seen.has(p)) continue; seen.add(p); out.push(p); for (const k of kids.get(p) || []) q.push(k); }
  return out;
}
// the ones to ask to close: the tree minus its helpers (Flatpak's bwrap / dbus proxy, FUSE mounts, an AppImage's own
// runtime still running from the AppImage file)
const HELPERS = /^(bwrap|flatpak|flatpak-spawn|xdg-dbus-proxy|squashfuse\w*|fusermount3?|appimagelauncher\w*)$/;
function linuxTargets(root, procDir = '/proc') {
  const fs = require('fs');
  return linuxTree(root, procDir).filter(p => {
    let comm = '', exe = ''; try { comm = fs.readFileSync(path.join(procDir, String(p), 'comm'), 'utf8').trim(); } catch {} try { exe = fs.readlinkSync(path.join(procDir, String(p), 'exe')); } catch {}
    if (HELPERS.test(comm)) return false;
    if (/\.appimage$/i.test(exe) || /\.appimage(\s|$)/i.test(comm)) return false; // (the AppImage runtime serving its files)
    return true;
  });
}
let forceTimer = null;
// Ask the emulator to close like a click on its X (saves, settings and Dolphin's batch mode all behave),
// and force it if it's still there forceAfterMs later: Cemu, RPCS3 and Xenia can take several seconds to flush saves
// and shader caches, so the default is a generous 8 s. onForce(pid) is called if the force kill was needed.
// Returns false when nothing is running, else true (same as before).
function closeRunning(forceAfterMs = 8000, onForce) {
  if (!running) return false;
  // (beta.12, Seamless play) a watched game (adopt below): its watcher asks the game's own processes, never its launcher
  if (running.bsWatch) { try { Promise.resolve(running.bsWatch.close(forceAfterMs, onForce)).catch(() => {}); } catch {} return true; }
  const pid = running.pid, child = running;
  // (beta.12) RocketLauncher (closeKids): its emulator is asked to close, not RocketLauncher, which then runs its own exit
  // (fade out, taskbar and mouse back) and ends by itself; asked directly, it could end before that and leave them hidden
  if (process.platform === 'win32' && child.closeKids) quiet('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${Number(pid)}' | ForEach-Object { taskkill /PID $_.ProcessId | Out-Null }`]);
  else if (process.platform === 'win32') quiet('taskkill', ['/PID', String(pid)]);
  // (Linux, beta.12) the emulator's own processes are asked (SIGTERM), not the helpers around them: an AppImage's mount
  // helper asked to stop took the emulator's files away before it saved, and a Flatpak's sandbox (bwrap) could end it
  // outright. When none can be told apart, the whole process group is asked, as before
  else { const t = linuxTargets(pid); if (t.length) t.forEach(p => { try { process.kill(p, 'SIGTERM'); } catch {} }); else { try { process.kill(-pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} } } }
  if (!forceTimer) { // pressed again while waiting: ask again, but keep the first deadline
    const ms = Number.isFinite(+forceAfterMs) && +forceAfterMs >= 0 ? +forceAfterMs : 8000;
    forceTimer = setTimeout(() => {
      forceTimer = null;
      if (running !== child || child.exitCode !== null || child.signalCode !== null) return;
      // a "really quit?" dialog (or anything else) is holding it open: end the whole tree
      if (process.platform === 'win32') quiet('taskkill', ['/PID', String(pid), '/T', '/F']); else { linuxTree(pid).forEach(p => { try { process.kill(p, 'SIGKILL'); } catch {} }); try { process.kill(-pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } } /* (Linux: a Flatpak's sandbox has a session of its own, outside the group) */
      if (typeof onForce === 'function') { try { onForce(pid); } catch {} }
    }, ms);
    child.once('exit', () => { clearTimeout(forceTimer); forceTimer = null; });
  }
  return true;
}

// (beta.12, Seamless play) A game Boxshelf didn't start itself but watches (main/gamewatch.js: a Steam or store game). It
// counts as the running game like one Boxshelf started, so the busy check, the Home menu's Quit, the quit cover and the
// return to the shelf all work the same. watcher: { close(forceAfterMs, onForce) }. Returns { setPid(pid), finish(info):
// it ended (onExit runs, as for a started game), release(): let go without onExit (watching gave up) }.
function adopt(name, watcher, onExit) {
  if (running) throw new Error(busyMessage());
  const me = new EventEmitter();
  Object.assign(me, { pid: 0, exitCode: null, signalCode: null, bsName: String(name || '').slice(0, 120), bsWatch: watcher, kill: () => { try { Promise.resolve(watcher.close(0)).catch(() => {}); } catch {} } });
  running = me; const started = Date.now(); let done = false;
  const end = () => { if (done) return false; done = true; if (running === me) running = null; return true; };
  return {
    setPid: pid => { me.pid = +pid || 0; try { onEvent('process started', me.pid); } catch {} },
    finish: info => { if (!end()) return; me.exitCode = 0; me.emit('exit', 0); onExit({ code: 0, ...(info || {}), ms: Date.now() - started }); },
    release: () => { end(); },
    isCurrent: () => running === me
  };
}
// (beta.12) what happens to a launch, for the launch timeline in the log (main/seamless.js): onEvent(what, pid)
let onEvent = () => {};
function setEventHook(fn) { onEvent = typeof fn === 'function' ? fn : () => {}; }

module.exports = { cleanEnv, linuxTree, linuxTargets, buildArgs, launchGame, launchEmulator, launchApp, launchRocket, launchSteam, isRunning, runningName, setRunningName, busyMessage, stopRunning, closeRunning, adopt, setEventHook };
