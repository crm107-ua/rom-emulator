// (beta.12) Seamless play: main/gamewatch.js watches a Steam or store game Boxshelf didn't start itself. Pretend readers
// (Steam's RunningAppID, the process list, alive checks, taskkill) and a pretend clock: started / ended, the 90 s give-up,
// a game's own launcher handing over to the game, close() asking then forcing the game's processes and never a launcher
// (Steam, Epic) or Boxshelf, nothing polled while nothing is watched. Also Steam's install folder from its libraries, the
// Home menu's Go to desktop item (on, off, not Windows), the screen mode, and launcher.adopt (a watched game counts as
// running; Quit goes to the watcher). Plain Node: node android-app/ci/gamewatch-test.js  → exits 1 on a failure
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..', '..');
const gw = require(path.join(root, 'main', 'gamewatch.js'));
const seamless = require(path.join(root, 'main', 'seamless.js'));
let bad = 0; const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' ' + info}`); if (!ok) bad++; };
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

// a pretend clock: timers run when advance() passes them (each one's async work is let finish)
function fakeWorld() {
  const W = { t: 1000000, timers: [], seq: 0, appid: 0, list: [], dead: new Set(), kills: [], calls: { reg: 0, list: 0, alive: 0 }, failList: false };
  W.deps = {
    now: () => W.t,
    setTimeout: (f, ms) => { const id = ++W.seq; W.timers.push({ id, at: W.t + Math.max(0, ms || 0), f }); return id; },
    clearTimeout: id => { W.timers = W.timers.filter(x => x.id !== id); },
    readRunningAppId: async () => { W.calls.reg++; return W.appid; },
    listProcesses: async () => { W.calls.list++; return W.failList ? [] : W.list.filter(p => !W.dead.has(p.pid)).map(p => ({ ...p })); },
    alive: pid => { W.calls.alive++; return W.list.some(p => p.pid === pid) && !W.dead.has(pid); },
    kill: (pid, force) => { W.kills.push([pid, !!force]); },
    selfPid: 999, log: () => {}
  };
  W.advance = async ms => { const end = W.t + ms;
    for (;;) { W.timers.sort((a, b) => a.at - b.at || a.id - b.id); const n = W.timers[0]; if (!n || n.at > end) break; W.timers.shift(); W.t = n.at; n.f(); await flush(); }
    W.t = end; await flush(); };
  return W;
}
const STEAM = 'C:\\Program Files (x86)\\Steam', GAME = STEAM + '\\steamapps\\common\\Cobalt Drift';
const LAUNCHER_PROCS = [{ pid: 10, name: 'steam.exe', exe: STEAM + '\\steam.exe' }, { pid: 11, name: 'steamwebhelper.exe', exe: STEAM + '\\bin\\cef\\cef.win7x64\\steamwebhelper.exe' }, { pid: 12, name: 'explorer.exe', exe: 'C:\\Windows\\explorer.exe' }];

(async () => {
  try {
    // ---------- nothing watched: nothing polls ----------
    { const W = fakeWorld(), g = gw.create(W.deps); await W.advance(60000);
      check('nothing is watched: no timer, no registry read, no process listing', !g.polling() && W.timers.length === 0 && W.calls.reg === 0 && W.calls.list === 0 && W.calls.alive === 0, JSON.stringify(W.calls)); }

    // ---------- Steam: waiting, started (the game, not its crash handler), ended ----------
    { const W = fakeWorld(), g = gw.create(W.deps); W.list = LAUNCHER_PROCS.slice();
      const w = g.watch({ kind: 'steam', appid: '400000', dir: GAME, title: 'Cobalt Drift' }); const ev = [];
      w.on('started', (pid, info) => ev.push(['started', pid, info.exe])); w.on('ended', i => ev.push(['ended', i.ms])); w.on('timeout', () => ev.push(['timeout']));
      await W.advance(4100);
      const waiting = w.state === 'waiting' && !ev.length && g.polling();
      W.appid = 400000; W.list.push({ pid: 501, name: 'UnityCrashHandler64.exe', exe: GAME + '\\UnityCrashHandler64.exe' }, { pid: 500, name: 'Cobalt.exe', exe: GAME + '\\Cobalt.exe' });
      await W.advance(2000);
      check('Steam: waits while only Steam runs, then "started" with the game\'s own process (not its crash handler, not Steam)', waiting && ev.length === 1 && ev[0][0] === 'started' && ev[0][1] === 500 && /Cobalt\.exe$/.test(ev[0][2]), JSON.stringify(ev));
      const lists = W.calls.list; await W.advance(5000);
      check('Steam: while it runs only cheap alive checks (no process listing every poll)', W.calls.list === lists && W.calls.alive > 0, JSON.stringify(W.calls));
      W.dead.add(500); W.dead.add(501); W.appid = 0; await W.advance(600);
      check('Steam: the game\'s processes gone and Steam says nothing runs: "ended", with its play time', ev.length === 2 && ev[1][0] === 'ended' && ev[1][1] >= 5000, JSON.stringify(ev));
      const c0 = JSON.stringify(W.calls); await W.advance(30000);
      check('Steam: after the end nothing polls any more', !g.polling() && W.timers.length === 0 && JSON.stringify(W.calls) === c0 && !g.active(), JSON.stringify(W.calls)); }

    // ---------- a game that never shows up: 'timeout' after 90 s (a pretend clock), then nothing ----------
    { const W = fakeWorld(), g = gw.create(W.deps); W.list = LAUNCHER_PROCS.slice(); const ev = [];
      const w = g.watch({ kind: 'epic', dir: 'D:\\Epic Games\\Ember', exe: 'D:\\Epic Games\\Ember\\Ember.exe', title: 'Ember Trail' }); w.on('timeout', () => ev.push('timeout')); w.on('started', () => ev.push('started'));
      await W.advance(88000); const before = ev.slice();
      await W.advance(4000);
      const c0 = JSON.stringify(W.calls); await W.advance(30000);
      check('a game that never shows up: no "timeout" before 90 s, "timeout" right after, then nothing polls', before.length === 0 && ev.join() === 'timeout' && !g.polling() && W.timers.length === 0 && JSON.stringify(W.calls) === c0 && w.state === 'stopped', JSON.stringify({ before, ev, calls: W.calls })); }

    // ---------- the game's own launcher hands over to the game: not an end ----------
    { const W = fakeWorld(), g = gw.create(W.deps); const dir = 'E:\\Ubisoft\\Harbor Run'; W.list = LAUNCHER_PROCS.concat([{ pid: 50, name: 'upc.exe', exe: 'C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\upc.exe' }, { pid: 600, name: 'HarborLauncher.exe', exe: dir + '\\HarborLauncher.exe' }]);
      const w = g.watch({ kind: 'ubisoft', dir, title: 'Harbor Run' }); const ev = []; w.on('started', p => ev.push('started ' + p)); w.on('handover', p => ev.push('handover ' + p)); w.on('ended', () => ev.push('ended'));
      await W.advance(2100); W.dead.add(600); W.list.push({ pid: 601, name: 'HarborRun.exe', exe: dir + '\\bin\\HarborRun.exe' }); await W.advance(1000);
      check('a game\'s own launcher handing over to the game: followed to the game, not taken as the end', ev.join() === 'started 600,handover 601' && w.state === 'running' && w.pid === 601, JSON.stringify(ev));
      // the process list failing once (PowerShell timed out) while the game runs is no end
      W.failList = true; await W.advance(16000); const still = w.state === 'running'; W.failList = false;
      W.dead.add(601); await W.advance(600);
      check('a failed process listing while it runs is no end; the game closing is', still && ev[ev.length - 1] === 'ended', JSON.stringify(ev)); }

    // ---------- close(): the game asked, then forced; Steam, Epic's launcher and Boxshelf never touched ----------
    { const W = fakeWorld(), g = gw.create(W.deps);
      W.list = LAUNCHER_PROCS.concat([{ pid: 20, name: 'EpicGamesLauncher.exe', exe: GAME + '\\EpicGamesLauncher.exe' }, { pid: 999, name: 'Boxshelf.exe', exe: GAME + '\\Boxshelf.exe' }, { pid: 500, name: 'Cobalt.exe', exe: GAME + '\\Cobalt.exe' }, { pid: 502, name: 'CobaltHelper.exe', exe: GAME + '\\tools\\CobaltHelper.exe' }]);
      const w = g.watch({ kind: 'steam', appid: '400000', dir: GAME }); const ev = []; w.on('ended', () => ev.push('ended'));
      await W.advance(2100); const forced = [];
      await g.close(8000, pids => forced.push(...pids)); await flush();
      const gentle = W.kills.slice();
      W.dead.add(502); await W.advance(8100);
      const all = W.kills.map(k => k[0]);
      check('close(): the game\'s processes are asked first (no force), then the one still there forced after the wait',
        gentle.length === 2 && gentle.every(k => !k[1]) && gentle.map(k => k[0]).sort().join() === '500,502' && W.kills.some(k => k[0] === 500 && k[1]) && !W.kills.some(k => k[0] === 502 && k[1]) && forced.join() === '500', JSON.stringify({ kills: W.kills, forced }));
      check('close(): Steam, its web helper, Epic\'s launcher (even inside the game\'s folder), Explorer and Boxshelf itself are never touched',
        ![10, 11, 12, 20, 999].some(p => all.includes(p)), JSON.stringify(W.kills));
      W.dead.add(500); await W.advance(600);
      check('close(): the game gone, the watch ends', ev.join() === 'ended' && !g.polling(), JSON.stringify(ev)); }

    // ---------- close() before the game showed up: nothing killed, the watch ends (cancelled) ----------
    { const W = fakeWorld(), g = gw.create(W.deps); W.list = LAUNCHER_PROCS.slice();
      const w = g.watch({ kind: 'epic', dir: 'D:\\Epic Games\\Ember' }); const ev = []; w.on('ended', i => ev.push(i)); await W.advance(2100);
      await g.close(8000); await flush(); await W.advance(10000);
      check('close() before the game showed up: nothing is killed, the watch ends as cancelled, nothing polls', !W.kills.length && ev.length === 1 && ev[0].cancelled === true && !g.polling() && W.timers.length === 0, JSON.stringify({ ev, kills: W.kills })); }

    // ---------- Steam's word alone (no install folder known) ----------
    { const W = fakeWorld(), g = gw.create(W.deps); W.list = LAUNCHER_PROCS.slice();
      const w = g.watch({ kind: 'steam', appid: '400001' }); const ev = []; w.on('started', p => ev.push('started ' + p)); w.on('ended', () => ev.push('ended'));
      await W.advance(2100); const list0 = W.calls.list; W.appid = 400001; await W.advance(2000); const s = ev.slice();
      W.appid = 0; await W.advance(2000); const one = ev.slice(); await W.advance(2000);
      check('Steam without an install folder: started when Steam says so, ended after Steam says nothing runs twice, no process listings', s.join() === 'started 0' && one.join() === 'started 0' && ev.join() === 'started 0,ended' && W.calls.list === list0 && list0 === 0, JSON.stringify({ ev, calls: W.calls })); }

    // ---------- a second watch replaces the first; stop() ends it quietly ----------
    { const W = fakeWorld(), g = gw.create(W.deps); const a = g.watch({ kind: 'epic', dir: 'D:\\A' }), ev = []; a.on('ended', () => ev.push('a')); a.on('timeout', () => ev.push('a timeout'));
      const b = g.watch({ kind: 'epic', dir: 'D:\\B' }); g.stop(); await W.advance(120000);
      check('one watch at a time: a new one replaces the old (no events from it); stop() ends it quietly', a.state === 'stopped' && b.state === 'stopped' && !ev.length && !g.polling() && W.timers.length === 0, JSON.stringify(ev)); }

    // ---------- the parsers and folder tests ----------
    { const l = gw.parseList('12|steam.exe|C:\\Steam\\steam.exe\r\n500|Cobalt.exe|D:\\Games\\Cobalt\\Cobalt.exe\r\n4||\r\njunk\r\n');
      check('the process list is read (pid, name, program; an unreadable program is empty)', l.length === 3 && l[1].pid === 500 && l[1].exe === 'D:\\Games\\Cobalt\\Cobalt.exe' && l[2].exe === '', JSON.stringify(l));
      check('a program inside a folder (any case, not a folder with a longer name)', gw.under('D:\\Games\\Cobalt', 'd:\\games\\cobalt\\bin\\x.exe') && !gw.under('D:\\Games\\Cobalt', 'D:\\Games\\Cobalt Drift\\x.exe') && !gw.under('', 'D:\\x.exe'));
      check('launchers are known by name', ['steam.exe', 'EpicGamesLauncher.exe', 'upc.exe', 'EADesktop.exe', 'GalaxyClient.exe', 'XboxPcApp.exe'].every(gw.isLauncher) && !gw.isLauncher('Cobalt.exe')); }

    // ---------- Steam: a game's install folder from appmanifest_<appid>.acf in any library ----------
    { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-gw-')), st = path.join(tmp, 'Steam'), lib2 = path.join(tmp, 'SteamLibrary');
      fs.mkdirSync(path.join(st, 'steamapps'), { recursive: true }); fs.mkdirSync(path.join(st, 'userdata'), { recursive: true });
      fs.mkdirSync(path.join(lib2, 'steamapps', 'common', 'Cobalt Drift'), { recursive: true });
      fs.writeFileSync(path.join(st, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n "0"\n {\n  "path" "${st.replace(/\\/g, '\\\\')}"\n }\n "1"\n {\n  "path" "${lib2.replace(/\\/g, '\\\\')}"\n }\n}\n`);
      fs.writeFileSync(path.join(lib2, 'steamapps', 'appmanifest_400000.acf'), '"AppState"\n{\n "appid" "400000"\n "name" "Cobalt Drift"\n "installdir" "Cobalt Drift"\n}\n');
      const d = gw.steamInstallDir([null, st], '400000'), none = gw.steamInstallDir([st], '400009'), badId = gw.steamInstallDir([st], '4x');
      fs.rmSync(tmp, { recursive: true, force: true });
      check('Steam: a game\'s install folder found in another library (libraryfolders.vdf + its appmanifest); none for an unknown game', d === path.join(lib2, 'steamapps', 'common', 'Cobalt Drift') && none === '' && badId === '', JSON.stringify({ d, none })); }

    // ---------- Seamless play's pieces in main/seamless.js ----------
    { const on = seamless.shelfActionsFor({ seamless: true }, 'win32'), off = seamless.shelfActionsFor({ seamless: false }, 'win32'), lin = seamless.shelfActionsFor({}, 'linux'), dflt = seamless.shelfActionsFor({}, 'win32');
      check('Home menu on the shelf: Go to desktop before Power with Seamless play on (the default); not when it\'s off, nor on Linux',
        on.join() === 'shelfhome,museum,settings,desktop,power' && dflt.join() === on.join() && off.join() === 'shelfhome,museum,settings,power' && lin.join() === off.join(), JSON.stringify({ on, off, lin }));
      check('screen mode: chosen, or (never chosen) what Start in fullscreen said',
        seamless.screenModeOf({ screenMode: 'window' }) === 'window' && seamless.screenModeOf({ screenMode: '', startFullscreen: false }) === 'window' && seamless.screenModeOf({ screenMode: '' }) === 'full' && seamless.screenModeOf({ screenMode: 'full', startFullscreen: false }) === 'full');
      const config = require(path.join(root, 'main', 'config.js'));
      const n = config.normalize({ ui: { seamless: 'yes', screenMode: 'tiny', windowBounds: { x: 10, y: 20, width: 'big', height: 5 } } }).ui, n2 = config.normalize({ ui: { seamless: false, screenMode: 'window', windowBounds: { x: -5.4, y: 8, width: 1280.2, height: 720 } } }).ui, n0 = config.normalize({}).ui;
      check('settings: Seamless play on by default, screen mode unset, a bad saved value falls back; a good one is kept',
        n0.seamless === true && n0.screenMode === '' && n0.windowBounds === null && n.seamless === true && n.screenMode === '' && n.windowBounds === null && n2.seamless === false && n2.screenMode === 'window' && n2.windowBounds && n2.windowBounds.x === -5 && n2.windowBounds.width === 1280, JSON.stringify({ n, n2: { s: n2.seamless, m: n2.screenMode, b: n2.windowBounds } })); }

    // ---------- launcher.adopt: a watched game counts as running; Quit goes to the watcher ----------
    { const Module = require('module'), load = Module._load;
      Module._load = function (req, ...a) { if (req === 'electron') return { shell: { openExternal: async () => {} } }; return load.call(this, req, ...a); };
      let launcher; try { launcher = require(path.join(root, 'main', 'launcher.js')); } finally { Module._load = load; }
      const closes = [], exits = [], events = []; launcher.setEventHook((w, pid) => events.push(w + ' ' + pid));
      const run = launcher.adopt('Cobalt Drift', { close: (ms, f) => { closes.push(ms); return true; } }, info => exits.push(info));
      const busy = launcher.isRunning(); let refused = false; try { launcher.adopt('Other', { close() {} }, () => {}); } catch (e) { refused = /Cobalt Drift is already running/.test(e.message); }
      run.setPid(500); const asked = launcher.closeRunning(8000);
      run.finish({ watched: true }); run.finish({}); const after = launcher.isRunning();
      const r2 = launcher.adopt('Glasshouse', { close() {} }, info => exits.push(info)); r2.release(); const released = !launcher.isRunning();
      check('launcher.adopt: a watched game counts as running (a second launch is refused by name), Quit asks its watcher, its end runs onExit once, release() lets go without it',
        busy && refused && asked === true && closes.join() === '8000' && exits.length === 1 && exits[0].code === 0 && exits[0].watched === true && !after && released && events.includes('process started 500'), JSON.stringify({ busy, refused, closes, exits, after, released, events }));
      launcher.setEventHook(null); }
  } catch (e) { check('ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e); }
  console.log(bad ? `${bad} FAILED` : 'all passed');
  process.exit(bad ? 1 : 0);
})();
