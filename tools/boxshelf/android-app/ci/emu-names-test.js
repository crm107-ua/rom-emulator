// (beta.11) Other standalone emulators are found and started with their own options: DuckStation's builds under any of
// their names, DeSmuME on the DS shelf, mGBA and VisualBoyAdvance-M on the Game Boy shelves. Plain Node (no Electron):
// node android-app/ci/emu-names-test.js  → exits 1 on a failure. Windows names (the Linux table replaces them there).
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..', '..');
// the Windows tables, also on GitHub's Linux runner (systems.js swaps in its Linux names when it loads on Linux)
if (process.platform !== 'win32') Object.defineProperty(process, 'platform', { value: 'win32' });
const { CONSOLES } = require(path.join(root, 'main', 'systems.js'));
const by = id => CONSOLES.find(c => c.id === id);
// the same matching detect.js findIn does: exact names, or "re:" patterns, against a folder's file names
const finds = (sys, file) => by(sys).exeNames.some(n => n.startsWith('re:') ? new RegExp(n.slice(3), 'i').test(file) : n.toLowerCase() === file.toLowerCase());
let bad = 0; const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' ' + info}`); if (!ok) bad++; };

for (const f of ['duckstation-qt-x64-ReleaseLTCG.exe', 'duckstation-qt-x64-Release.exe', 'duckstation-x64-Release.exe', 'duckstation-qt-ARM64-ReleaseLTCG.exe']) check(`PlayStation finds ${f}`, finds('psx', f));
check('PlayStation does not take another program for DuckStation', !finds('psx', 'updater.exe') && !finds('psx', 'pcsx2-qt.exe'));
for (const f of ['DeSmuME_0.9.13_x64.exe', 'desmume.exe', 'DeSmuME-VS2022-x64-Release.exe']) check(`DS finds ${f}`, finds('nds', f));
check('DS still looks for melonDS first', by('nds').exeNames[0] === 'melonDS.exe');
for (const s of ['gb', 'gbc', 'gba']) { check(`${s} finds visualboyadvance-m.exe`, finds(s, 'visualboyadvance-m.exe')); check(`${s} finds VisualBoyAdvance-M-2.1.9.exe`, finds(s, 'VisualBoyAdvance-M-2.1.9.exe')); check(`${s} finds mGBA.exe`, finds(s, 'mGBA.exe')); check(`${s} looks for RetroArch first`, by(s).exeNames[0] === 'retroarch.exe'); }

// the launch options main.js picks (ALT_ARGS, read from main.js so the test follows it)
const src = fs.readFileSync(path.join(root, 'main.js'), 'utf8'), m = /const ALT_ARGS = (\[[^\n]*\]);/.exec(src);
check('main.js has its ALT_ARGS table', !!m);
if (m) { const ALT = eval(m[1]); const argsFor = (sys, exe) => { const def = by(sys), b = path.basename(exe); if (/retroarch/i.test(b)) return 'retroarch'; const a = ALT.find(([re]) => re.test(b)); return a ? a[1] : def.gameArgs; };
  check('DeSmuME gets the game only (melonDS\'s -f breaks it)', argsFor('nds', 'C:\\Emu\\DeSmuME\\DeSmuME_0.9.13_x64.exe') === '"{rom}"');
  check('melonDS keeps -f', argsFor('nds', 'C:\\Emu\\melonDS\\melonDS.exe') === '-f "{rom}"');
  check('VisualBoyAdvance-M on the GBA shelf gets the game only', argsFor('gba', 'C:\\Emu\\VBA\\visualboyadvance-m.exe') === '"{rom}"');
  check('mGBA on the Game Boy shelf gets -f', argsFor('gb', 'C:\\Emu\\mGBA\\mGBA.exe') === '-f "{rom}"');
  check('DuckStation under another name keeps its options', argsFor('psx', 'C:\\Emu\\duckstation-x64-Release.exe') === '-fullscreen -batch -nogui -- "{rom}"');
  check('RetroArch is left to its own core options', argsFor('gba', 'C:\\RetroArch\\retroarch.exe') === 'retroarch'); }

// a real folder walk: the detect code finds them in a portable folder
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-emu-'));
try {
  for (const [d, f] of [['duckstation-windows-x64-release', 'duckstation-qt-x64-Release.exe'], ['DeSmuME', 'DeSmuME_0.9.13_x64.exe'], ['VisualBoyAdvance-M', 'visualboyadvance-m.exe']]) { fs.mkdirSync(path.join(tmp, d)); fs.writeFileSync(path.join(tmp, d, f), 'x'); }
  const paths = require(path.join(root, 'main', 'paths.js')); const orig = paths.appRoot(); paths.setAppRoot(tmp);
  const det = require(path.join(root, 'main', 'detect.js'));
  const got = id => { const r = det.detectSystem(id); return r && r.emulator ? path.basename(r.emulator) : ''; };
  check('detect finds DuckStation-Release in its release folder beside Boxshelf', got('psx') === 'duckstation-qt-x64-Release.exe', got('psx'));
  check('detect finds DeSmuME beside Boxshelf (no melonDS)', got('nds') === 'DeSmuME_0.9.13_x64.exe', got('nds'));
  paths.setAppRoot(orig);
} catch (e) { check('detect walk ran', false, e.message); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(bad ? `emu-names-test: ${bad} FAILED` : 'emu-names-test: all passed'); process.exit(bad ? 1 : 0);
