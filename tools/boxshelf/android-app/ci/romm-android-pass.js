// Device test (beta.12): RomM on the pretend Thor (?fakeNative=1), with a pretend RomM server behind the adapter's
// native calls (window.__fakeRomm: httpText with romm, rommDownload, rommCancel). Checks results only:
//  - nothing changes while RomM isn't set up (no cloud games, Sync / Test say so, no errors)
//  - pairing by the device flow (QR code drawn on the device, the token kept in the settings and never handed back to the
//    page, JSON sent as application/json, a Settings copy saved later keeps the token) and by the 8-digit code
//  - a sync merges RomM's games into their consoles' shelves (one already there by file or by title is not added twice; a
//    platform Boxshelf has no shelf for is skipped); the case has the cloud badge (.slot.cloud)
//  - later syncs ask only for what changed (updated_after) plus the id sweep, and a game removed in RomM goes
//  - Play on a cloud game: rommDownload with the right place, name, size and hash, its progress on the boot slide, B →
//    rommCancel (nothing launched); Play again → downloaded, then launched like any game; the cloud goes after the rescan
//  - Settings → RomM pairs through the page's own card (QR + code); Sign out takes the cloud games away
'use strict';
const path = require('path');

// the pretend server (runs in the page, before the adapter): RomM 5-style answers
const FAKE = `(() => {
  const S = 'http://romm.test:8080';
  const st = window.__fakeRommState = { log: [], downloads: [], cancels: 0, hold: false, polls: 0, releaseFn: null, cancelFn: null,
    plats: [{ id: 1, slug: 'snes', fs_slug: 'snes', name: 'Super Nintendo', rom_count: 3 }, { id: 2, slug: 'ngc', fs_slug: 'gc', name: 'GameCube', rom_count: 1 },
      { id: 3, slug: 'ps', fs_slug: 'psx', name: 'PlayStation', rom_count: 1 }, { id: 9, slug: 'vectrex', fs_slug: 'vectrex', name: 'Vectrex', rom_count: 4 }],
    roms: [
      { id: 11, platform_id: 1, name: 'Super Metroid', fs_name: 'Super Metroid (Japan, USA).sfc', fs_size_bytes: 3145728, updated_at: '2026-10-01T10:00:00Z', files: [{ file_name: 'Super Metroid (Japan, USA).sfc', file_size_bytes: 3145728, sha1_hash: 'aa11' }] },
      { id: 12, platform_id: 1, name: 'EarthBound', fs_name: 'EarthBound (USA).sfc', fs_size_bytes: 3145728, updated_at: '2026-10-02T10:00:00Z', files: [{ file_name: 'EarthBound (USA).sfc', file_size_bytes: 3145728, sha1_hash: 'd67a8ef36ef616bc39306aa1b486e1bd3047815a', md5_hash: 'a864b2e5c141d2dec1c4cbed75a42a85' }] },
      { id: 13, platform_id: 1, name: 'Chrono Trigger', fs_name: 'Chrono Trigger (USA) [!].sfc', fs_size_bytes: 4194304, updated_at: '2026-10-03T10:00:00Z', files: [{ file_name: 'Chrono Trigger (USA) [!].sfc', file_size_bytes: 4194304 }] },
      { id: 21, platform_id: 2, name: 'Pikmin 2', fs_name: 'Pikmin 2 (USA).rvz', fs_size_bytes: 900000000, updated_at: '2026-10-04T10:00:00Z', files: [{ file_name: 'Pikmin 2 (USA).rvz', file_size_bytes: 900000000 }] },
      { id: 31, platform_id: 3, name: 'Spyro the Dragon', fs_name: 'Spyro the Dragon (USA)', fs_size_bytes: 600000000, has_multiple_files: true, updated_at: '2026-10-05T10:00:00Z',
        files: [{ file_name: 'Spyro the Dragon (USA).cue', file_size_bytes: 100 }, { file_name: 'Spyro the Dragon (USA).bin', file_size_bytes: 599999900 }] }] };
  const token = () => { try { const c = JSON.parse(localStorage.getItem('fake:config.json') || '{}'); return ((c.keys || {}).rommToken) || ''; } catch (e) { return ''; } };
  const ans = (status, o) => ({ status, text: o === undefined ? '' : JSON.stringify(o) });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  window.__fakeRomm = {
    async http(o) { await sleep(15);
      const u = new URL(o.url), p = u.pathname, q = u.searchParams, authed = o.auth !== false && !!token();
      st.log.push({ path: p, q: u.search, method: o.body != null ? 'POST' : 'GET', ct: o.contentType || '', auth: authed, headers: Object.keys(o.headers || {}) });
      if (!o.url.startsWith(S + '/')) throw new Error('Offline or blocked: no such server');
      if (p === '/api/heartbeat') return ans(200, { SYSTEM: { VERSION: '5.4.1' } });
      if (p === '/api/auth/device/init') { st.polls = 0; return ans(200, { device_code: 'dev-1', user_code: 'WXYZ-1234', verification_uri_complete: S + '/pair?user_code=WXYZ1234', interval: 1, expires_in: 300 }); }
      if (p === '/api/auth/device/token') { st.polls++; return st.polls < 2 ? ans(400, { error: 'authorization_pending' }) : ans(200, { access_token: 'tok-device-123', expires_at: null }); }
      if (p === '/api/client-tokens/exchange') { const b = JSON.parse(o.body || '{}'); return b.code === '12345678' ? ans(200, { access_token: 'tok-code-456' }) : ans(400, { detail: 'bad code' }); }
      if (!authed) return ans(401, { detail: 'Not authenticated' });
      if (p === '/api/platforms') return ans(200, st.plats);
      if (p === '/api/roms') {
        const pid = +q.get('platform_ids'), lim = +q.get('limit') || 50, off = +q.get('offset') || 0, after = q.get('updated_after');
        let L = st.roms.filter(r => r.platform_id === pid); const ids = L.map(r => r.id);
        if (after) L = L.filter(r => Date.parse(r.updated_at) > Date.parse(after));
        const out = { items: L.slice(off, off + lim), total: L.length };
        if (q.get('with_rom_id_index') === 'true') out.rom_id_index = ids;
        return ans(200, out); }
      return ans(404, { detail: 'Not found' }); },
    async download(o, emit) { st.downloads.push(JSON.parse(JSON.stringify(o)));
      let stop = false; st.cancelFn = () => { stop = true; };
      const total = o.size || 1000;
      for (let i = 1; i <= 4; i++) { if (stop) break; emit({ id: o.id, phase: 'download', received: Math.round(total * i / 10), total }); await sleep(120); }
      if (st.hold && !stop) await new Promise(r => { st.releaseFn = r; const t = setInterval(() => { if (stop) { clearInterval(t); r(); } }, 50); });
      st.cancelFn = null; st.releaseFn = null;
      if (stop) throw new Error('cancelled');
      emit({ id: o.id, phase: 'verify', received: 0, total }); await sleep(60);
      const id = decodeURIComponent((/\\/tree\\/([^/]+)/.exec(o.tree) || [])[1] || '');
      return { ok: true, uri: o.tree + '/document/' + encodeURIComponent(id + '/' + o.name), docId: id + '/' + o.name, name: o.name, dir: '', verified: o.sha1 ? 'sha1' : 'size', already: false }; },
    cancel() { st.cancels++; if (st.cancelFn) { st.cancelFn(); return true; } return false; }
  };
})();`;

module.exports = async function rommAndroidPass({ browser, base, check, newPage, OUT }) {
  const { ctx, page, errors } = await newPage(browser, FAKE);
  const url = base + '?fakeNative=1';
  try {
    // a set-up pretend Thor: GameCube, PlayStation and SNES folders, then the shelf
    await page.goto(url); await page.waitForTimeout(4000);
    await page.evaluate(async () => {
      const api = window.boxshelf, info = await api.getConfig(), det = await api.detect(), c = info.config;
      const dirs = [await api.pick({ kind: 'folder' }), await api.pick({ kind: 'folder' }), await api.pick({ kind: 'folder' })];
      c.systems.gc.romDirs = [dirs[0]]; c.systems.gc.emulator = det.systems.gc.emulator;
      c.systems.psx.romDirs = [dirs[1]]; c.systems.psx.emulator = det.systems.psx.emulator;
      c.systems.snes.romDirs = [dirs[2]]; c.systems.snes.emulator = det.systems.snes.emulator;
      c.setupDone = true; await api.saveConfig(c); await api.scan(); });
    await page.reload(); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && window.Setup && window.Settings, null, { timeout: 90000, polling: 250 });
    await page.waitForTimeout(1500);

    // 1. RomM not set up: nothing changes
    const off = await page.evaluate(async () => { const api = window.boxshelf, lib = await api.scan();
      return { romm: lib.reduce((a, s) => a + (s.games || []).filter(g => g.romm).length, 0), st: await api.rommStatus(), sync: await api.rommSync(), test: await api.rommTest(),
        cancel: await api.rommCancel(), cloud: document.querySelectorAll('.slot.cloud').length, calls: __fakeRommState.log.length }; });
    check('RomM on Android: not set up, nothing changes (no RomM games, Status not paired, Sync / Test say why, nothing asked of a server)',
      off.romm === 0 && off.cloud === 0 && off.st && off.st.paired === false && off.sync && off.sync.ok === false && off.test && off.test.ok === false && off.cancel === false && off.calls === 0, JSON.stringify(off));

    // 2. the address, then pairing by the device flow
    const pair = await page.evaluate(async () => { const api = window.boxshelf, w = ms => new Promise(r => setTimeout(r, ms));
      const c = (await api.getConfig()).config; c.romm = { server: 'http://romm.test:8080/', skipTls: false, cloud: true }; await api.saveConfig(c);
      const older = JSON.parse(JSON.stringify((await api.getConfig()).config)); // (a screen's copy from before the pairing)
      const start = await api.rommPairStart(), polls = [];
      for (let i = 0; i < 20; i++) { const q = await api.rommPairPoll(); polls.push(q); if (q.state !== 'pending') break; await w(Math.max(200, Math.min(q.wait || 1000, 1500))); }
      const tok1 = ((await api.getConfig()).config.keys || {}).rommToken;
      await api.saveConfig(older); const tok2 = ((await api.getConfig()).config.keys || {}).rommToken;
      const posts = __fakeRommState.log.filter(x => x.method === 'POST');
      return { start: Object.assign({}, start, { qr: (start.qr || '').slice(0, 40), qrLen: (start.qr || '').length }), last: polls[polls.length - 1], polls: polls.length, leaked: JSON.stringify(polls).includes('tok-'),
        tok1, tok2, posts: posts.map(x => x.path + ' ' + x.ct + ' auth:' + x.auth), st: await api.rommStatus() }; });
    check('RomM on Android: pairs by the device flow (QR drawn on the device, code and address shown), the token kept in the settings and never handed to the page, JSON sent as JSON',
      pair.start.ok && pair.start.userCode === 'WXYZ-1234' && /^<svg/.test(pair.start.qr) && pair.start.qrLen > 500 && /romm\.test:8080\/pair/.test(pair.start.qrUrl) &&
      pair.last && pair.last.state === 'ok' && pair.polls >= 2 && !pair.leaked && pair.tok1 === 'tok-device-123' && pair.posts.length >= 3 && pair.posts.every(p => /application\/json auth:false$/.test(p)) && pair.st.paired && pair.st.server === 'http://romm.test:8080',
      JSON.stringify(pair).slice(0, 700));
    check('RomM on Android: a settings copy saved after pairing keeps the sign-in', pair.tok2 === 'tok-device-123', String(pair.tok2));

    // 3. the sync the pairing started: RomM's games on their consoles' shelves
    const sync = await page.evaluate(async () => { const api = window.boxshelf, w = ms => new Promise(r => setTimeout(r, ms));
      let s = await api.rommStatus(); for (let i = 0; i < 60 && !(s.count > 0 && !s.syncing); i++) { await w(250); s = await api.rommStatus(); }
      const lib = await api.scan(), sh = id => (lib.find(x => x.id === id) || { games: [] }).games;
      const pick = g => ({ t: g.title, f: g.file, cloud: !!(g.romm && g.romm.cloud), multi: !!(g.romm && g.romm.multi), tree: !!g.romTree, uri: !!g.uri });
      return { st: s, snes: sh('snes').map(pick), gc: sh('gc').map(pick), psx: sh('psx').map(pick), sorted: sh('snes').map(g => g.title).join('|') === sh('snes').map(g => g.title).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })).join('|'),
        authed: __fakeRommState.log.filter(x => x.path === '/api/roms' || x.path === '/api/platforms').every(x => x.auth) }; });
    const eb = sync.snes.find(g => g.t === 'EarthBound');
    check('RomM on Android: a sync puts RomM\'s games on their shelves at their place in the console\'s games folder, with the cloud mark (one already there by file or by title is not added again; a platform with no shelf is skipped)',
      sync.st.count === 5 && sync.st.skipped && sync.st.skipped.platforms === 1 && eb && eb.cloud && eb.tree && !eb.uri && eb.f === '/storage/emulated/0/ROMs/snes/EarthBound (USA).sfc' &&
      sync.snes.filter(g => /Super Metroid/.test(g.t)).length === 1 && sync.snes.filter(g => /Chrono Trigger/.test(g.t)).length === 1 && sync.snes.filter(g => g.cloud).length === 1 &&
      sync.gc.some(g => g.t === 'Pikmin 2' && g.cloud) && sync.psx.some(g => g.t === 'Spyro the Dragon' && g.cloud && g.multi) && sync.sorted && sync.authed, JSON.stringify(sync).slice(0, 900));

    // 4. later syncs: only what changed, plus the id sweep; a game removed in RomM goes
    const inc = await page.evaluate(async () => { const api = window.boxshelf; __fakeRommState.log.length = 0;
      const a = await api.rommSync(), roms = __fakeRommState.log.filter(x => x.path === '/api/roms');
      __fakeRommState.roms = __fakeRommState.roms.filter(r => r.id !== 21); __fakeRommState.plats[1].rom_count = 0; // (Pikmin 2 deleted in RomM)
      const b = await api.rommSync(), lib = await api.scan(), gc = (lib.find(x => x.id === 'gc') || { games: [] }).games;
      return { a, b, since: roms.filter(x => /updated_after=/.test(x.q)).length, sweep: roms.filter(x => /with_rom_id_index=true/.test(x.q)).length, pikmin2: gc.some(g => g.title === 'Pikmin 2') }; });
    check('RomM on Android: a later sync asks only for what changed (updated_after) plus the id sweep, and a game removed in RomM leaves the shelf',
      inc.a.ok && inc.a.count === 5 && inc.since >= 3 && inc.sweep >= 3 && inc.b.ok && inc.b.count === 4 && !inc.pikmin2, JSON.stringify(inc));

    // 5. the shelf: the SNES shelf's EarthBound has the cloud on its case
    const ui = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      for (let i = 0; i < 40 && Shelf.getMode() !== 'browse'; i++) await w(250);
      for (let i = 0; i < 12 && Shelf.artFocus(false).sys !== 'snes'; i++) { key('ArrowDown'); await w(700); }
      for (let i = 0; i < 8 && Shelf._qs().g !== 'EarthBound'; i++) { Shelf.bottomCmd('next'); await w(700); }
      await w(800);
      return { sys: Shelf.artFocus(false).sys, g: Shelf._qs().g, cloud: document.querySelectorAll('.slot.cloud').length, mode: Shelf.getMode() }; });
    await page.screenshot({ path: path.join(OUT, 'romm-1-cloud-on-shelf.png') });
    check('RomM on Android: a RomM game not on the device has the cloud on its case', ui.sys === 'snes' && ui.g === 'EarthBound' && ui.cloud >= 1, JSON.stringify(ui));

    // 6. Play: downloaded first (its progress on the boot slide); B stops it and nothing is launched
    const stop = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      const S = __fakeRommState, l0 = __fakeLaunches.length; S.hold = true; S.downloads.length = 0;
      Shelf.bottomCmd('play');
      for (let i = 0; i < 60 && !(S.downloads.length && S.releaseFn); i++) await w(250);
      const line = () => ((document.getElementById('lEmu') || {}).textContent || '') + ' / ' + ((document.getElementById('bsEmu') || {}).textContent || '');
      let said = line(); for (let i = 0; i < 20 && !/Getting it from RomM… \d+%/.test(said); i++) { await w(150); said = line(); }
      const mode = Shelf.getMode(); key('Escape'); await w(1200);
      const note = (document.getElementById('launch') || document.body).innerText.replace(/\s+/g, ' ');
      const out = { started: S.downloads.length, said, mode, cancels: S.cancels, launched: __fakeLaunches.length - l0, note: note.slice(0, 200), dl: S.downloads[0] };
      key('Escape'); for (let i = 0; i < 20 && Shelf.getMode() !== 'browse'; i++) await w(250); out.back = Shelf.getMode(); S.hold = false; return out; });
    check('RomM on Android: Play on a cloud game downloads it first (rommDownload into the SNES folder, its name, size and hash), its progress on the boot slide',
      stop.started === 1 && stop.dl && stop.dl.url === 'http://romm.test:8080/api/roms/12/content/EarthBound%20(USA).sfc' && /ROMs%2Fsnes/.test(stop.dl.tree) && stop.dl.name === 'EarthBound (USA).sfc' &&
      stop.dl.size === 3145728 && stop.dl.sha1 === 'd67a8ef36ef616bc39306aa1b486e1bd3047815a' && !stop.dl.multi && /Getting it from RomM… \d+% of 3 MB/.test(stop.said) && stop.mode === 'launch', JSON.stringify(stop).slice(0, 700));
    check('RomM on Android: B during the download stops it (rommCancel), says so, and nothing is launched', stop.cancels === 1 && stop.launched === 0 && /Download stopped/.test(stop.note) && stop.back === 'browse', JSON.stringify(stop).slice(0, 500));

    // 7. Play again: downloaded, then started like any game; once back, the shelf has it as a game on the device
    const play = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), S = __fakeRommState, l0 = __fakeLaunches.length;
      for (let i = 0; i < 8 && Shelf._qs().g !== 'EarthBound'; i++) { Shelf.bottomCmd('next'); await w(700); }
      Shelf.bottomCmd('play');
      for (let i = 0; i < 60 && __fakeLaunches.length === l0; i++) await w(250);
      const req = __fakeLaunches[l0] || null;
      for (let i = 0; i < 40 && Shelf.getMode() !== 'browse'; i++) await w(250); // (the pretend game ends after 1.5 s)
      await w(2500);
      const lib = await window.boxshelf.scan(), g =((lib.find(x => x.id === 'snes') || { games: [] }).games).find(x => x.title === 'EarthBound');
      return { downloads: S.downloads.length, req: req ? JSON.stringify(req) : '', game: g ? { file: g.file, uri: !!g.uri, cloud: !!(g.romm && g.romm.cloud) } : null, mode: Shelf.getMode(),
        hist: Object.keys(await window.boxshelf.history()).filter(k => /EarthBound/.test(k)) }; });
    check('RomM on Android: Play again downloads it and starts it like any game (the emulator gets the downloaded file); back on the shelf it is a game on the device (no cloud)',
      play.downloads === 2 && /EarthBound \(USA\)\.sfc/.test(play.req) && play.game && play.game.uri && !play.game.cloud && play.game.file === '/storage/emulated/0/ROMs/snes/EarthBound (USA).sfc' &&
      play.hist.includes('snes:/storage/emulated/0/ROMs/snes/EarthBound (USA).sfc'), JSON.stringify(play).slice(0, 700));

    // 8. Settings → Accounts & services → RomM: Sign out (the cloud games go), then pair again through the page's card
    const set = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), o = {};
      await window.boxshelf.rommForget(); const lib = await window.boxshelf.scan();
      o.afterOut = lib.reduce((a, s) => a + (s.games || []).filter(g => g.romm && g.romm.cloud).length, 0); o.tokOut = ((await window.boxshelf.getConfig()).config.keys || {}).rommToken || '';
      const rows = () => [...document.querySelectorAll('#bss .bss-row')].map(r => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 100));
      const row = n => [...document.querySelectorAll('#bss .bss-row')].find(r => ((r.querySelector('.nm') || {}).textContent || '') === n);
      Setup.open({ page: 'acct' }); for (let i = 0; i < 40 && !document.querySelector('#bss.on .bss-row'); i++) await w(150); await w(800);
      o.acct = rows().filter(n => /^RomM/.test(n));
      if (row('RomM')) { row('RomM').click(); await w(900); }
      const p = row('Pair Boxshelf with RomM'); o.pairRow = !!p; if (p) { p.click(); await w(400); }
      for (let i = 0; i < 30 && !document.querySelector('#bss .qr svg'); i++) await w(150);
      const box = () => ((document.querySelector('#bss .bss-pairbox') || document.querySelector('#bss') || {}).textContent || '');
      o.card = !!document.querySelector('#bss .qr svg path') && /WXYZ-1234/.test(box());
      for (let i = 0; i < 40 && !/Paired/.test(box()); i++) await w(200);
      o.paired = /Paired/.test(box()); o.tok = ((await window.boxshelf.getConfig()).config.keys || {}).rommToken || '';
      o.code = await window.boxshelf.rommPairCode('1234-5678'); o.bad = await window.boxshelf.rommPairCode('99999999');
      o.tokCode = ((await window.boxshelf.getConfig()).config.keys || {}).rommToken || '';
      await Settings.close(); await w(600);
      // paired twice in a row: the library comes back (a sync for the older sign-in never leaves it empty)
      let s = await window.boxshelf.rommStatus(); for (let i = 0; i < 60 && !(s.count > 0 && !s.syncing); i++) { await w(250); s = await window.boxshelf.rommStatus(); }
      o.count = s.count; return o; });
    await page.screenshot({ path: path.join(OUT, 'romm-2-after.png') });
    check('RomM on Android: Sign out takes the cloud games away and forgets the sign-in', set.afterOut === 0 && set.tokOut === '', JSON.stringify(set).slice(0, 300));
    check('RomM on Android: Settings → RomM pairs through its card (the QR code and code shown, then Paired); the 8-digit code pairs too, a wrong one is refused',
      set.acct.length === 1 && set.pairRow && set.card && set.paired && set.tok === 'tok-device-123' && set.code && set.code.ok && set.bad && !set.bad.ok && set.tokCode === 'tok-code-456', JSON.stringify(set).slice(0, 600));
    check('RomM on Android: paired again (twice in a row), the library is synced again', set.count === 4, JSON.stringify({ count: set.count }));
    check('RomM on Android pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) { check('RomM on Android pass ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); }
  await ctx.close();
};
