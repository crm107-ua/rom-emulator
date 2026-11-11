// main/artstudio.js cands() with pretend sources: the list goes back after firstWait with the fast source, the slow ones
// arrive as art:cand { late, cand }, then listDone; a reopen within 5 min reuses the list; fresh asks again.
// Plain Node (beta.12, ci/artlate-main-test.js): node ci/artlate-main-test.js
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
// GitHub's test job installs only the Android tooling (no Electron): main's modules get a stand-in 'electron' whose
// network always fails (nothing here goes online: every source is a pretend one)
{ const Module = require('module'), real = Module._resolveFilename, ID = path.join(os.tmpdir(), 'bs-electron-stub.js');
  Module._resolveFilename = function (req, ...a) { return req === 'electron' ? ID : real.call(this, req, ...a); };
  const offline = async () => { throw new Error('offline (test)'); };
  require.cache[ID] = { id: ID, filename: ID, loaded: true, exports: { net: { fetch: offline, request: () => { throw new Error('offline (test)'); } }, shell: { openPath: async () => '' }, app: { getPath: () => os.tmpdir(), whenReady: () => new Promise(() => {}) }, BrowserWindow: function () {}, screen: { getAllDisplays: () => [] }, powerMonitor: { on() {} } } }; }
const repo = path.join(__dirname, '..', '..'), M = p => require(path.join(repo, 'main', p));
const covers = M('covers'), steamgrid = M('steamgrid'), screenscraper = M('screenscraper'), A = M('artstudio');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-late-')), roms = path.join(tmp, 'roms'); fs.mkdirSync(roms);
const rom = path.join(roms, 'Game.iso'); fs.writeFileSync(rom, 'x');
const wait = ms => new Promise(r => setTimeout(r, ms));
let asked = 0;
covers.candidates = async () => { asked++; await wait(50); return [{ url: 'https://example.invalid/lb1.jpg', ext: '.jpg', source: 'launchbox', type: 'box', region: 'usa', edition: 'original', kind: 'scan', label: 'LB' }]; };
steamgrid.enabled = () => true; steamgrid.posters = async () => { await wait(2000); return [{ url: 'https://example.invalid/sg1.png', thumbUrl: 'https://example.invalid/sg1t.png', ext: '.png', w: 600, h: 900, rank: 0, styleName: 'Alt' }]; };
screenscraper.configured = () => true; screenscraper.candidates = async () => { await wait(2600); return [{ url: 'https://example.invalid/ss1.jpg', ext: '.jpg', source: 'screenscraper', type: 'box-2D', region: 'usa', edition: 'original', kind: 'scan', label: 'Box front Â· USA' }]; };
covers.downloadEx = async () => 'missing';
const sent = []; const logs = [];
const def = { id: 'gc', name: 'GameCube' }, sc = { id: 'gc', path: roms, romsPath: roms, folders: [roms] };
A.init({ dataDir: tmp, log: (...a) => logs.push(a.join(' ')), send: (ch, d) => sent.push([Date.now(), ch, d]), getCfg: () => ({}), consoles: () => [{ def, sc }],
  scan: async () => [{ file: rom, title: 'Game', kind: 'game', art: {} }], gameFile: (id, f) => ({ file: f }), fileUrl: f => 'bsfile:///' + f, pruneDelay: 1e9, migrateDelay: 1e9 });
(async () => {
  let bad = 0; const ok = (n, c, info) => { if (!c) bad++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(info).slice(0, 400)); };
  const t0 = Date.now(); const r = await A.cands({ systemId: 'gc', file: rom, part: 'front' }); const dt = Date.now() - t0;
  ok('list back in about 1.2 s with the fast source, pending', dt < 2000 && r.pending === true && r.list.some(c => c.source === 'launchbox') && !r.list.some(c => c.source === 'screenscraper'), { dt, r });
  await wait(3000);
  const late = sent.filter(s => s[2] && s[2].late).map(s => s[2].cand && s[2].cand.source), done = sent.filter(s => s[2] && s[2].listDone);
  ok('the slow sources arrive as late cards, then listDone once', late.includes('steamgriddb') && late.includes('screenscraper') && done.length === 1 && sent.indexOf(done[0]) > sent.findIndex(s => s[2] && s[2].late), { late, done: done.length });
  ok('timings logged', logs.some(l => /sources for front/.test(l) && /screenscraper \d+ ms/.test(l)), logs);
  const n0 = asked, t1 = Date.now(); const r2 = await A.cands({ systemId: 'gc', file: rom, part: 'front' });
  ok('reopened within 5 min: the same list at once, with the late versions, not pending', asked === n0 && Date.now() - t1 < 500 && !r2.pending && r2.list.some(c => c.source === 'screenscraper'), { asked, n0, r2 });
  await A.cands({ systemId: 'gc', file: rom, part: 'front', fresh: true });
  ok('fresh asks the sources again', asked === n0 + 1, { asked });
  await wait(3000); fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
