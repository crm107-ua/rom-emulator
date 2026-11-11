// (beta.12) Seamless play (Windows): starting and closing any game feels like a console. This module holds what main.js
// needs for it, so main.js only has small hooks:
//   - Steam and store games (Epic, Ubisoft Connect, the EA app, Xbox) are watched (main/gamewatch.js) and get what a game
//     Boxshelf starts itself gets: the loading cover until the game's window shows, the Home menu, playtime, the quit
//     cover and the return to the shelf (launchWatched).
//   - Screen mode (Settings → Display → Screen & TV): Full screen (today's behaviour) or Window (the taskbar is never
//     hidden; the window's place and size are remembered). F11 switches and the choice is kept.
//   - Home menu → Go to desktop (Boxshelf minimised; Guide or the taskbar brings it back).
//   - A launch timeline in the log for each launch (cover up, process, window, cover down, game ended, shelf back).
// Settings → Display → Seamless play (cfg.ui.seamless, on by default) off: none of this, exactly the earlier behaviour.
'use strict';
const gamewatch = require('./gamewatch');

let ctx = { cfg: () => ({ ui: {} }), log: () => {}, saveUi: () => {}, platform: process.platform };
function init(c) { Object.assign(ctx, c || {}); }
const ui = () => { try { return ((ctx.cfg && ctx.cfg()) || {}).ui || {}; } catch { return {}; } };
// on: Windows, and the switch not turned off
const onFor = (u, platform) => platform === 'win32' && !!u && u.seamless !== false;
const on = () => onFor(ui(), ctx.platform || process.platform);

// ---------- screen mode ----------
// the chosen mode; never chosen yet: what "Start in fullscreen" said
const screenModeOf = u => (u && (u.screenMode === 'window' || u.screenMode === 'full')) ? u.screenMode : (u && u.startFullscreen === false ? 'window' : 'full');
const screenMode = () => screenModeOf(ui());
const windowMode = () => on() && screenMode() === 'window';
// the window opens fullscreen? (Seamless play off: Start in fullscreen, as before)
function startFullscreen(def) { return on() ? screenMode() !== 'window' : def; }
// the window's remembered place and size (Window mode), when it's still on a connected screen
function savedBounds() {
  if (!windowMode()) return null;
  const b = ui().windowBounds; if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return null;
  try { const { screen } = require('electron'); const ok = screen.getAllDisplays().some(d => { const a = d.workArea; return b.x + 80 > a.x && b.y + 40 > a.y && b.x + 80 < a.x + a.width && b.y + 40 < a.y + a.height; }); if (!ok) return null; } catch { return null; }
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(640, Math.round(b.width)), height: Math.max(400, Math.round(b.height)) };
}
let boundsT = null, fromDesktop = false;
function trackWindow(win) {
  const keep = () => { clearTimeout(boundsT); boundsT = setTimeout(() => {
    try { if (!windowMode() || !win || win.isDestroyed() || win.isFullScreen() || win.isMaximized() || win.isMinimized() || !win.isVisible()) return;
      const b = win.getBounds(), o = ui().windowBounds || {}; if (b.x === o.x && b.y === o.y && b.width === o.width && b.height === o.height) return;
      ctx.saveUi({ windowBounds: { x: b.x, y: b.y, width: b.width, height: b.height } }); } catch {} }, 900); };
  try { win.on('resize', keep); win.on('moved', keep); win.on('restore', () => { fromDesktop = false; }); } catch {}
}
// F11 (or the shelf's own fullscreen switch) changed it: remembered as the screen mode
function fullscreenToggled(isFull) { if (!on()) return; const m = isFull ? 'full' : 'window'; if (ui().screenMode !== m) { ctx.saveUi({ screenMode: m }); ctx.log('Screen mode:', m === 'full' ? 'full screen' : 'window', '(F11)'); } }
// Settings → Screen mode: kept, and the window switches now (not while a game runs: it comes back as chosen)
function setScreenMode(win, mode, busy) {
  if (mode !== 'full' && mode !== 'window') throw new Error('Unknown screen mode.');
  if (process.platform !== 'win32') return screenMode(); // (Windows only: the row isn't shown elsewhere)
  ctx.saveUi({ screenMode: mode }); ctx.log('Screen mode:', mode === 'full' ? 'full screen' : 'window');
  if (!on() || busy || !win || win.isDestroyed()) return mode;
  try {
    if (mode === 'full') { if (!win.isFullScreen()) win.setFullScreen(true); }
    else if (win.isFullScreen()) { const b = savedBounds(); if (b) win.once('leave-full-screen', () => setTimeout(() => { try { if (!win.isDestroyed() && !win.isFullScreen()) win.setBounds(b); } catch {} }, 60)); win.setFullScreen(false); }
  } catch (e) { ctx.log('Screen mode switch failed:', e.message); }
  return mode;
}
// Seamless play turned off in Settings: back to today's screen (Start in fullscreen)
function applied(prevUi, nextUi, win) {
  if (process.platform !== 'win32' || !prevUi || !nextUi || prevUi.seamless === nextUi.seamless) return;
  if (nextUi.seamless === false && nextUi.startFullscreen !== false && win && !win.isDestroyed() && !win.isFullScreen()) { try { win.setFullScreen(true); } catch {} }
}

// ---------- Home menu: Go to desktop ----------
// the shelf's Home menu items (Seamless play adds Go to desktop before Power)
function shelfActionsFor(u, platform, base) { const b = (base || ['shelfhome', 'museum', 'settings', 'power']).slice(); if (!onFor(u, platform) || b.includes('desktop')) return b; const i = b.indexOf('power'); b.splice(i < 0 ? b.length : i, 0, 'desktop'); return b; }
const shelfActions = base => shelfActionsFor(ui(), ctx.platform || process.platform, base);
function goToDesktop(win) {
  if (!on() || !win || win.isDestroyed()) return false;
  fromDesktop = true; ctx.log('Home menu: Go to desktop (Boxshelf minimised, the taskbar back)');
  try { win.minimize(); } catch {}
  return true;
}
// Guide pressed while Boxshelf sits minimised after Go to desktop: true = bring it back (the caller does)
function backFromDesktop(win) { if (!fromDesktop) return false; fromDesktop = false; try { return !!win && !win.isDestroyed() && win.isMinimized(); } catch { return false; } }

// ---------- the launch timeline ----------
let tl = null;
function tlEnd(why) {
  const t = tl; tl = null; if (!t || !t.marks.length) return;
  let title = t.title; if (!title) { try { title = ctx.runningName ? ctx.runningName() : ''; } catch {} }
  ctx.log('Launch timeline' + (title || t.name ? ' (' + (title || t.name) + ')' : '') + ': ' + t.marks.map(([w, ms]) => w + ' +' + ms + ' ms').join(' · ') + (why ? ' (' + why + ')' : ''));
}
function tlBegin(title) { if (!on()) { tl = null; return; } if (tl) tlEnd('a new launch began'); tl = { title: String(title || '').slice(0, 120), t0: Date.now(), marks: [] }; }
// cover up · process started · window up · cover down · quit: cover up · game ended · shelf back (the line is logged then)
function mark(what) {
  if (!on()) { tl = null; return; }
  if (!tl) { if (what !== 'process started' && what !== 'cover up') return; tlBegin(''); }
  if (!tl.name) { try { tl.name = ctx.runningName ? ctx.runningName() : ''; } catch {} }
  tl.marks.push([what, Date.now() - tl.t0]);
  if (what === 'shelf back' || what === 'gave up') tlEnd();
}

// ---------- Steam and store games, watched ----------
// g: { kind ('steam' | 'epic' | 'ubisoft' | 'ea' | 'xbox'), id (the shelf's id, for playtime), appid?, dir?, exe?, title,
// systemName, start: async () => (opens the store's link) }. ctx (from main.js): busyCheck, setLaunching, taskbarHide,
// taskbarShow, beginRun, onExit, homeBegin, homeMeta, watchPad, coverAgain, coverWhileStarting, coverDeadline,
// historyTrack, gaveUp, launcher
const COVER_MAX = 25; // s: the longest the loading cover waits for the game (a launcher's own question shows after it)
const COVER_AFTER_PROCESS = 12; // s: once the game's process is up, the latest its window has to show
async function launchWatched(g) {
  const c = ctx, lnx = (c.platform || process.platform) === 'linux'; // (beta.12, Linux: Steam games; no window to watch there, so a short cover)
  c.busyCheck();
  c.setLaunching(true); try { await c.taskbarHide(); } finally { c.setLaunching(false); }
  tlBegin(g.title);
  const w = gamewatch.watch({ kind: g.kind, appid: g.appid, dir: g.dir, exe: g.exe, title: g.title });
  let run;
  try { run = c.launcher.adopt(g.title, gamewatch, c.onExit); } catch (e) { gamewatch.stop(); throw e; }
  c.beginRun();
  try { await g.start(); } catch (e) { gamewatch.stop(); run.release(); c.taskbarShow('the game did not start'); tl = null; throw e; }
  c.log('PC launch (watched):', g.kind, g.title, g.dir ? '' : '(its install folder is unknown: Steam\'s word only)');
  c.homeBegin({ systemId: 'pc', exe: g.exe || '', systemName: g.systemName || 'PC', title: g.title, hotkeys: {} });
  c.watchPad({ home: true }); // (Guide and the quit combo work while it starts)
  w.on('started', (pid, info) => {
    if (!run.isCurrent()) return;
    run.setPid(pid); mark('process started');
    if (info && info.exe) c.homeMeta({ exe: info.exe });
    if (pid) { c.watchPad({ appPid: pid, home: true }); c.coverAgain(); } // (its window: the cover lifts when it's up fullscreen; gone: the black cover at once. A new helper starts with the cover down: told again)
    c.historyTrack(g.id);
    c.coverDeadline(lnx ? 2 : COVER_AFTER_PROCESS);
  });
  w.on('handover', pid => { if (run.isCurrent() && pid) { run.setPid(pid); c.watchPad({ appPid: pid, home: true }); c.coverAgain(); } });
  w.on('ended', info => { if (run.isCurrent()) run.finish({ watched: true, cancelled: !!(info && info.cancelled) }); });
  w.on('timeout', () => { if (!run.isCurrent()) return; run.release(); mark('gave up'); c.gaveUp(g); });
  const cover = c.coverWhileStarting(lnx ? 8 : COVER_MAX);
  return { watching: true, cover };
}
// the game's window went (padwatch): look for its end now, not at the next poll
function windowGone() { if (on()) gamewatch.poke(); }
// Back on the starting screen before the game showed up (B / Esc): stop waiting for it. false once it's running.
function cancel(launcher) {
  const w = gamewatch.active(); if (!w || w.state !== 'waiting') return { cancelled: false };
  launcher.closeRunning(8000); return { cancelled: true }; // (nothing running yet: the watch just ends; a game that showed up this moment is asked to close)
}

module.exports = { init, on, onFor, screenMode, screenModeOf, windowMode, startFullscreen, savedBounds, trackWindow, fullscreenToggled, setScreenMode, applied,
  shelfActions, shelfActionsFor, goToDesktop, backFromDesktop, tlBegin, mark, launchWatched, windowGone, cancel, COVER_MAX };
