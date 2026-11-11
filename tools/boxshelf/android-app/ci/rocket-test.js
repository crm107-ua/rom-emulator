// RocketLauncher (beta.12, main/rocket.js), plain Node on a made-up RocketLauncher folder: its systems and ROM folders
// (relative, several with |, a UTF-16 ini, a system with no emulator yet), each console's name (RocketLauncher's own
// folder name wins), the command line (by name inside a ROM folder, by full path outside, -p only when set, never -f),
// the first error of a run from its log, which consoles start through it, and {romname} / {romdir} in launch options.
// On Windows also a stand-in RocketLauncher that records what it was started with, closed through its "emulator".
// node android-app/ci/rocket-test.js  → exits 1 on a failure.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const Module = require('module'); const load0 = Module._load;
Module._load = function (r, ...a) { if (r === 'electron') return { shell: {} }; return load0.call(this, r, ...a); };
const root = path.resolve(__dirname, '..', '..');
const rocket = require(path.join(root, 'main', 'rocket.js')), launcher = require(path.join(root, 'main', 'launcher.js'));
let bad = 0; const ok = (name, cond, info) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(info))); if (!cond) bad++; };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-rocket-')), rl = path.join(tmp, 'HyperSpin', 'RocketLauncher'), exe = path.join(rl, 'RocketLauncher.exe');
  const roms = path.join(tmp, 'HyperSpin', 'Roms', 'Nintendo GameCube'), other = path.join(tmp, 'Elsewhere');
  fs.mkdirSync(roms, { recursive: true }); fs.mkdirSync(other, { recursive: true }); fs.mkdirSync(path.join(rl, 'Settings', 'Global'), { recursive: true });
  fs.writeFileSync(exe, 'stand-in');
  const sys = (name, text, enc) => { const d = path.join(rl, 'Settings', name); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'Emulators.ini'), enc === 'utf16' ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]) : text); };
  sys('Nintendo GameCube', `[ROMS]\r\nRom_Path=..\\Roms\\Nintendo GameCube|${other}\r\nDefault_Emulator=Dolphin\r\n`);
  sys('Nintendo Entertainment System', '[ROMS]\r\nRom_Path=..\\Roms\\NES\r\nDefault_Emulator=\r\n');
  sys('Sega Mega Drive', '[ROMS]\r\nRom_Path=..\\Roms\\Mega Drive\r\nDefault_Emulator=RetroArch\r\n', 'utf16');

  const list = await rocket.systems(exe, true), gc = list.find(s => s.name === 'Nintendo GameCube');
  ok('systems: one per Settings folder (Global left out), sorted', list.map(s => s.name).join('|') === 'Nintendo Entertainment System|Nintendo GameCube|Sega Mega Drive', list.map(s => s.name));
  ok('systems: ROM folders relative to RocketLauncher and several with |', gc && gc.romPaths.length === 2 && path.resolve(gc.romPaths[0]) === path.resolve(roms) && path.resolve(gc.romPaths[1]) === path.resolve(other), gc && gc.romPaths);
  ok('systems: no Default_Emulator means not set up; a UTF-16 file is read', list.find(s => s.name === 'Nintendo Entertainment System').ready === false && list.find(s => s.name === 'Sega Mega Drive').ready === true, list);

  ok('names: the usual HyperSpin name', rocket.nameFor('gc', list) === 'Nintendo GameCube' && rocket.nameFor('ps2', list) === 'Sony PlayStation 2');
  ok("names: RocketLauncher's own folder wins (Sega Mega Drive, not Sega Genesis)", rocket.nameFor('megadrive', list) === 'Sega Mega Drive', rocket.nameFor('megadrive', list));
  ok('names: every console with a HyperSpin name has one', ['nes', 'snes', 'n64', 'gb', 'gbc', 'gba', 'nds', 'n3ds', 'gc', 'wii', 'wiiu', 'sw', 'psx', 'ps2', 'ps3', 'psp', 'megadrive', 'mastersystem', 'gamegear', 'segacd', 'sega32x', 'saturn', 'dreamcast', 'pcengine', 'neogeo', 'arcade', 'atari2600', 'atarilynx', 'wonderswan', 'x360'].every(id => !!rocket.usualName(id)));

  const inside = path.join(roms, "Metroid Prime (USA) [!] & Co's.iso"), outside = path.join(tmp, 'Loose', 'Pikmin (USA).rvz');
  const a1 = rocket.argsFor({ system: 'Nintendo GameCube', file: inside, list, plugin: 'HyperSpin' });
  ok('command line: a game in a ROM folder goes by its name, -p when set', JSON.stringify(a1.args) === JSON.stringify(['-s', 'Nintendo GameCube', '-r', "Metroid Prime (USA) [!] & Co's", '-p', 'HyperSpin']) && a1.inRoms && a1.ready, a1);
  const a2 = rocket.argsFor({ system: 'Nintendo GameCube', file: outside, list, plugin: '' });
  ok('command line: elsewhere by its full path, no -p when none, never -f', a2.args[3] === path.resolve(outside) && !a2.inRoms && !a2.args.includes('-p') && !a2.args.includes('-f'), a2);
  const a3 = rocket.argsFor({ system: 'Nintendo Entertainment System', file: path.join(tmp, 'x.nes'), list });
  ok('command line: a system with no emulator is flagged', a3.known && a3.ready === false, a3);

  const logf = path.join(rl, 'RocketLauncher.log'), t0 = Date.now();
  fs.writeFileSync(logf, ['10:00:00 | RL | INFO | Main - Raw CLI received: -s old', '10:00:01 | RL | ERROR | old error', '10:01:00 | RL | INFO | Main - Raw CLI received: -s "Nintendo GameCube"', '10:01:01 | RL | ERROR | Rom not found: Metroid Prime', '10:01:02 | RL | INFO | exiting'].join('\r\n'));
  ok("log: this run's first error (not an earlier run's)", (await rocket.lastError(exe, t0)) === 'Rom not found: Metroid Prime', await rocket.lastError(exe, t0));
  fs.writeFileSync(logf, '10:02:00 | RL | INFO | Main - Raw CLI received: -s x\r\n10:02:01 | RL | INFO | Module ended, exiting RocketLauncher normally\r\n');
  ok('log: a clean run has no error', (await rocket.lastError(exe, t0)) === '');

  const cfgOf = (mode, gc) => ({ rocket: { exe, mode }, systems: { gc: gc || {}, nes: {} } }), win = process.platform === 'win32';
  ok('which consoles: off, every console, only the chosen (a console can opt out of "every")', !rocket.useFor('gc', cfgOf('off')) &&
    rocket.useFor('gc', cfgOf('all')) === win && !rocket.useFor('gc', cfgOf('all', { viaRocket: false })) &&
    !rocket.useFor('gc', cfgOf('some')) && rocket.useFor('gc', cfgOf('some', { viaRocket: true })) === win && !rocket.useFor('gc', { rocket: { exe: '', mode: 'all' }, systems: {} }));

  const ba = launcher.buildArgs('-x "{romname}" --dir "{romdir}" "{rom}"', inside);
  ok('launch options: {romname} and {romdir}', ba[1] === "Metroid Prime (USA) [!] & Co's" && ba[3] === roms && ba[4] === inside, ba);

  if (win) { // a stand-in RocketLauncher (a .cmd: launcher.js runs those through cmd.exe) that writes down its command line
    const cmd = path.join(tmp, 'rl-stand-in.cmd'), out = path.join(tmp, 'args.txt');
    fs.writeFileSync(cmd, `@echo off\r\n> "${out}" echo %*\r\n`);
    const got = await new Promise(res => { try { launcher.launchRocket(cmd, a1.args, info => res(info)); } catch (e) { res({ error: e.message }); } setTimeout(() => res({ timeout: true }), 15000); });
    const said = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim() : '';
    ok('stand-in RocketLauncher: started with -s, -r and -p, ended, and Boxshelf heard', got && got.code === 0 && /-s"? "Nintendo GameCube"/.test(said) && /-r"? "Metroid Prime \(USA\) \[!\] & Co's"/.test(said) && /-p"? "HyperSpin"/.test(said), { got, said });
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(bad ? `rocket-test: ${bad} FAILED` : 'rocket-test: all passed'); process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL rocket-test crashed: ' + e.stack); process.exit(1); });
