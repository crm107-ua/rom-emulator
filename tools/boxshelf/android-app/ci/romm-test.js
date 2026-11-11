// (beta.12) RomM: pairing (device flow and 8-digit code), the library (first sync, then only what changed, a deleted
// ROM goes, offline answers from the saved copy), RomM platform -> Boxshelf console, covers cached once, downloads
// (progress, resume after a cancel with Range, a corrupted download caught by the hashes, a multi-file zip unpacked).
// Every request goes through main/romm.js, which puts a timeout on each one; a watchdog stops a stuck run.
// Plain Node: node android-app/ci/romm-test.js  -> exits 1 on a failure
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const romm = require(path.join(__dirname, '..', '..', 'main', 'romm.js'));
const fakeRomm = require(path.join(__dirname, 'fake-romm.js'));
let bad = 0; const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' ' + info}`); if (!ok) bad++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-romm-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const watchdog = setTimeout(() => { console.log('FAIL the test ran over 90 s (a request without a timeout?)'); process.exit(1); }, 90000);
let fake = null;

(async () => {
  try {
    fake = await fakeRomm.start();
    const S = fake.state;
    const dataDir = path.join(dir, 'data'), roms = path.join(dir, 'roms');
    romm.init({ dataDir, log: () => {} });
    romm._setTimeScale(0.01);
    romm._setTimeouts({ api: 1500, page: 1500, cover: 1500, connect: 1500, idle: 1500 });
    check('the server address is cleaned (a trailing /api is dropped)', romm.setServer(fake.url + '/api/').url === fake.url);

    // ---------- pairing
    const noTok = await romm.library();
    check('no sign-in yet: the library says so', noTok.error === 'no-token' && noTok.count === 0, JSON.stringify(noTok));
    const t0 = Date.now();
    const st = await romm.pairStart({ name: 'Boxshelf test' });
    check('pairing starts: a code and a QR address on the server', st.ok && st.userCode === 'WDJB-MJHT' && st.qrUrl === fake.url + '/pair?user_code=WDJB-MJHT' && st.expiresAt > Date.now(), JSON.stringify(st));
    const init = S.requests('/api/auth/device/init')[0];
    check('the device sign-in asks for read scopes', !!init && S.log.length > 0);
    const early = await romm.pairPoll();
    check('a poll before the interval waits (no request)', early.state === 'pending' && early.wait > 0 && S.requests('/api/auth/device/token').length === 0, JSON.stringify(early));
    const pr = await romm.pairWait();
    const polls = S.requests('/api/auth/device/token');
    check('the device flow ends signed in after the approval', pr.state === 'ok' && /^rmm_/.test(pr.token) && polls.length === 3, JSON.stringify({ pr, n: polls.length }));
    check('the polls keep the interval, and slow_down adds 5 s', polls.length === 3 && polls[0].t - t0 >= 45 && polls[1].t - polls[0].t >= 95 && polls[2].t - polls[1].t >= 95,
      JSON.stringify(polls.map(p => p.t - t0)));
    S.deny = true;
    await romm.pairStart();
    const dn = await romm.pairWait();
    check('a refused pairing says so', dn.state === 'denied', JSON.stringify(dn));
    S.deny = false;

    const badCode = await romm.pairWithCode('0000-0000');
    check('a wrong 8-digit code is refused', !badCode.ok && badCode.error === 'bad-code', JSON.stringify(badCode));
    const code = await romm.pairWithCode('1234 5678');
    check('the 8-digit code gives a token (RomM 4.8-4.9)', code.ok && /^rmm_/.test(code.token), JSON.stringify(code));
    const tst = await romm.test();
    check('the connection test: signed in, RomM version', tst.ok && tst.version === '5.4.1' && tst.platforms === 4, JSON.stringify(tst));
    romm.setToken('rmm_wrong');
    const tBad = await romm.test();
    check('a bad token is reported', !tBad.ok && tBad.error === 'auth', JSON.stringify(tBad));
    romm.setToken(pr.token);

    // ---------- platform -> console
    const ms = [['ngc', 'gc'], ['n64', 'n64'], ['genesis-slash-megadrive', 'megadrive'], ['psx', 'psx'], ['ps', 'psx'], ['dc', 'dreamcast'], ['3ds', 'n3ds'],
      ['switch', 'sw'], ['xbox360', 'x360'], ['sms', 'mastersystem'], ['turbografx16--1', 'pcengine'], ['lynx', 'atarilynx'], ['philips-cd-i', null]];
    const wrong = ms.filter(([s, c]) => romm.mapSlug({ slug: s }) !== c);
    check('RomM slugs map to Boxshelf consoles', !wrong.length, JSON.stringify(wrong));
    check('an unknown slug falls back to the folder name (fs_slug)', romm.mapSlug({ slug: 'something-new', fs_slug: 'GameCube' }) === 'gc' && romm.mapSlug({ slug: 'x', fs_slug: 'super famicom' }) === 'snes');

    // ---------- library: first sync
    let prog = 0;
    S.log.length = 0;
    const lib1 = await romm.library({ onProgress: () => prog++ });
    const c1 = lib1.consoles;
    check('first sync: every mapped platform on its shelf', !lib1.offline && (c1.nes || []).length === 12 && (c1.snes || []).length === 10 && (c1.gc || []).length === 6 && lib1.count === 28,
      JSON.stringify({ e: lib1.error, k: Object.keys(c1), n: lib1.count }));
    check('the platform Boxshelf has no shelf for is skipped and counted', lib1.skipped.platforms === 1 && lib1.skipped.games === 2 && lib1.skipped.slugs[0] === 'philips-cd-i', JSON.stringify(lib1.skipped));
    const g1 = (c1.nes || []).find(g => g.rommId === 1) || {};
    check('a game carries what the shelf needs', g1.id === 'romm-1' && g1.title === 'NES Game 1' && g1.file === 'NES Game 1 (USA).nes' && g1.size > 0 && g1.files.length === 1 && !!g1.files[0].sha1 &&
      g1.summary && g1.released === '1990-01-02' && g1.genres[0] === 'Action' && g1.regions[0] === 'USA' && g1.cover === null && g1.coverUrl === `${fake.url}/assets/romm/resources/roms/1/1/cover/big.png?ts=${Date.parse('2026-01-01T00:00:00.000Z')}`, JSON.stringify(g1));
    const g2 = (c1.nes || []).find(g => g.rommId === 2) || {};
    check('a cover path without the /assets prefix gets it', g2.coverUrl && g2.coverUrl.startsWith(`${fake.url}/assets/romm/resources/roms/1/2/cover/big.png?ts=`), g2.coverUrl);
    const multi = (c1.gc || []).find(g => g.multi) || {};
    check('the multi-file game is marked and lists its files', multi.rommId === 28 && multi.files.length === 2, JSON.stringify(multi.files));
    const pages1 = S.requests('/api/roms').filter(l => l.query.with_rom_id_index !== 'true');
    check('the first sync asks for whole platforms (no updated_after), total on the first page only', pages1.length === 3 && pages1.every(l => !l.query.updated_after && l.query.with_total === 'true' && l.query.limit === '1000'), JSON.stringify(pages1.map(l => l.query)));
    check('the sync reports its progress', prog >= 3);
    check('the library is saved for offline', fs.existsSync(path.join(dataDir, 'romm-library.json')));

    // ---------- incremental
    S.touch(2, { name: 'NES Game 2 Deluxe' });
    S.touch(15, { summary: 'A new summary.' });
    S.remove(7);
    S.add({ platform_id: 2, name: 'SNES Game New', fs_name: 'SNES Game New (USA).sfc' });
    S.log.length = 0;
    const lib2 = await romm.library();
    const c2 = lib2.consoles;
    const pages2 = S.requests('/api/roms').filter(l => l.query.with_rom_id_index !== 'true');
    const fetchedItems = pages2.reduce((a, l) => a + (l.items || 0), 0);
    check('the next sync asks only for what changed (updated_after)', pages2.length === 3 && pages2.every(l => !!l.query.updated_after) && fetchedItems === 3, JSON.stringify(pages2.map(l => [l.query.updated_after, l.items])));
    check('changed games are updated', (c2.nes.find(g => g.rommId === 2) || {}).title === 'NES Game 2 Deluxe' && (c2.snes.find(g => g.rommId === 15) || {}).summary === 'A new summary.');
    check('a new game appears', c2.snes.length === 11 && c2.snes.some(g => g.title === 'SNES Game New'));
    check('a ROM deleted on the server disappears (id sweep)', c2.nes.length === 11 && !c2.nes.some(g => g.rommId === 7) && S.requests('/api/roms').some(l => l.query.with_rom_id_index === 'true' && l.query.limit === '1'), String(c2.nes.length));
    S.log.length = 0;
    const lib3 = await romm.library();
    const pages3 = S.requests('/api/roms').filter(l => l.query.with_rom_id_index !== 'true');
    check('nothing changed: nothing fetched', lib3.fetched === 0 && pages3.reduce((a, l) => a + (l.items || 0), 0) === 0 && lib3.count === 28, JSON.stringify({ f: lib3.fetched, c: lib3.count }));

    // ---------- offline and stuck
    S.offline = true;
    let t = Date.now();
    const off = await romm.library();
    check('offline: the saved copy answers', off.offline === true && off.count === 28 && off.consoles.nes.length === 11, JSON.stringify({ o: off.offline, c: off.count, e: off.error }));
    S.offline = false; S.hang = true; t = Date.now();
    const hung = await romm.library();
    check('a server that never answers times out (offline, saved copy)', hung.offline === true && hung.count === 28 && Date.now() - t < 5000, `${Date.now() - t} ms`);
    S.hang = false;
    romm._reset();
    romm.init({ dataDir });
    romm.setServer(fake.url);
    S.offline = true;
    const cold = await romm.cached();
    check('after a restart the saved copy is there without the server', cold.count === 28, String(cold.count));
    S.offline = false;
    romm.setToken(pr.token);

    // ---------- covers
    const all = Object.values((await romm.library()).consoles).flat();
    const withCover = all.filter(g => g.coverUrl).length;
    S.log.length = 0;
    const cv1 = await romm.covers(all, { max: 100 });
    const coverReqs = S.requests('/assets/').length;
    check('covers are downloaded into romm-covers', cv1.downloaded === withCover && withCover > 15 && coverReqs === withCover && Object.values(cv1.paths).every(p => fs.existsSync(p) && /romm-covers[\\/]\d+\.png$/.test(p)), JSON.stringify({ d: cv1.downloaded, withCover, coverReqs, f: cv1.failed }));
    check('covers need no sign-in (no token sent to them)', S.requests('/assets/').every(l => !l.auth));
    S.log.length = 0;
    const cv2 = await romm.covers(all, { max: 100 });
    check('covers are cached: the second call downloads nothing', cv2.downloaded === 0 && S.requests('/assets/').length === 0 && Object.keys(cv2.paths).length === withCover, JSON.stringify({ d: cv2.downloaded, n: S.requests('/assets/').length }));
    const lib4 = await romm.cached();
    check('the library points at the cached cover', /romm-covers[\\/]1\.png$/.test((lib4.consoles.nes.find(g => g.rommId === 1) || {}).cover || ''));
    const capped = await romm.covers(all.map(g => ({ ...g, rommId: g.rommId + 1000, id: 'x' + g.id })), { max: 2 });
    check('covers({max}) caps the downloads', capped.downloaded === 2, String(capped.downloaded));

    // ---------- downloads
    const nes = path.join(roms, 'nes');
    const game1 = c2.nes.find(g => g.rommId === 1);
    const steps = [];
    const d1 = await romm.download(game1, nes, { onProgress: p => steps.push(p) });
    const want1 = crypto.createHash('sha1').update(fs.readFileSync(d1.file)).digest('hex');
    check('a download lands in the console folder and is checked', d1.file === path.join(nes, 'NES Game 1 (USA).nes') && fs.statSync(d1.file).size === game1.size && d1.verified === 'sha1' && want1 === game1.files[0].sha1 && !fs.existsSync(d1.file + '.part'), JSON.stringify(d1));
    const dl = steps.filter(s => s.phase === 'download');
    check('progress is reported (rising, to the full size)', dl.length >= 2 && dl[dl.length - 1].received === game1.size && dl.every((s, i) => !i || s.received >= dl[i - 1].received) && steps.some(s => s.phase === 'verify'), JSON.stringify(dl.slice(-2)));
    const again = await romm.download(game1, nes);
    check('a game already downloaded isn\'t fetched again', again.already === true);

    const big = c2.nes.find(g => g.rommId === 5);
    S.chunkDelay = 8;
    const ac = new AbortController();
    let cut = 0;
    const p1 = romm.download(big, nes, { signal: ac.signal, onProgress: p => { if (p.phase === 'download' && p.received > big.size * 0.3 && !cut) { cut = p.received; ac.abort(); } } });
    let abortErr = null;
    try { await p1; } catch (e) { abortErr = e; }
    const partFile = path.join(nes, big.file + '.part');
    const partSize = fs.existsSync(partFile) ? fs.statSync(partFile).size : 0;
    check('a cancel stops the download and keeps the .part', abortErr && abortErr.code === 'aborted' && abortErr.name === 'AbortError' && partSize > 0 && partSize < big.size && !fs.existsSync(path.join(nes, big.file)), JSON.stringify({ e: abortErr && abortErr.code, partSize }));
    S.chunkDelay = 0; S.log.length = 0;
    const resumed = await romm.download(big, nes);
    const content = S.requests('/api/roms/5/content/');
    check('the next try resumes with Range', content.length === 1 && content[0].range === `bytes=${partSize}-` && resumed.resumed === true, JSON.stringify(content.map(c => c.range)));
    check('the resumed file is whole and right', fs.statSync(resumed.file).size === big.size && crypto.createHash('sha1').update(fs.readFileSync(resumed.file)).digest('hex') === big.files[0].sha1);

    for (const [id, algo] of [[2, 'sha1'], [3, 'crc'], [4, 'md5']]) {
      const g = c2.nes.find(x => x.rommId === id);
      S.corrupt.add(id);
      let e2 = null;
      try { await romm.download(g, nes); } catch (e) { e2 = e; }
      check(`a corrupted download is caught (${algo})`, e2 && e2.code === 'hash-mismatch' && !fs.existsSync(path.join(nes, g.file)) && !fs.existsSync(path.join(nes, g.file + '.part')), JSON.stringify(e2 && e2.message));
      S.corrupt.delete(id);
      const ok = await romm.download(g, nes);
      check(`the clean download passes (${algo})`, ok.verified === algo, JSON.stringify(ok));
    }

    const gc = path.join(roms, 'gc');
    const md = await romm.download(multi, gc, { onProgress: () => {} });
    const folder = path.join(gc, multi.file);
    check('a multi-file game is unpacked into its folder, the .cue is the one to start', md.extracted && md.dir === folder && md.file === path.join(folder, 'GC Game 6 (USA).cue') && md.files.length === 2 &&
      fs.statSync(path.join(folder, 'GC Game 6 (USA).bin')).size === 150000 && !fs.existsSync(path.join(gc, multi.file + '.zip')) && !fs.existsSync(folder + '.unpacking'), JSON.stringify(md));
    check('the unpacked files match RomM\'s hashes', md.verified === 'files' && crypto.createHash('sha1').update(fs.readFileSync(path.join(folder, 'GC Game 6 (USA).bin'))).digest('hex') === multi.files[1].sha1);
    fs.rmSync(folder, { recursive: true, force: true });
    S.corrupt.add(28);
    let e3 = null;
    try { await romm.download(multi, gc); } catch (e) { e3 = e; }
    check('a corrupted file inside the zip is caught', e3 && e3.code === 'hash-mismatch' && !fs.existsSync(folder), JSON.stringify(e3 && e3.message));
    S.corrupt.delete(28);

    // zip safety and the crc fallback
    const evil = path.join(dir, 'evil.zip');
    fs.writeFileSync(evil, fakeRomm.makeZip([{ name: '../escape.txt', data: Buffer.from('x') }]));
    let e4 = null;
    try { await romm._unzip(evil, path.join(dir, 'evilout'), () => null, () => {}); } catch (e) { e4 = e; }
    check('a zip entry outside the folder is refused', e4 && e4.code === 'zip-bad' && !fs.existsSync(path.join(dir, 'escape.txt')));
    const buf = crypto.randomBytes(5000);
    check('the crc32 table gives zlib\'s answer', typeof zlib.crc32 !== 'function' || romm._crc32Table(buf) === zlib.crc32(buf));
    check('the crc32 table matches a known value', romm._crc32Table(Buffer.from('123456789')) === 0xcbf43926);

    // ---------- sign out
    await romm.forget();
    const gone = await romm.library();
    check('forget: token, saved library and covers are gone', gone.error === 'no-token' && gone.count === 0 && !fs.existsSync(path.join(dataDir, 'romm-library.json')) && !fs.existsSync(path.join(dataDir, 'romm-covers')), JSON.stringify({ e: gone.error, c: gone.count }));
  } catch (e) { check('ran to the end', false, e.stack); }
  finally {
    clearTimeout(watchdog);
    if (fake) await fake.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(bad ? `romm-test: ${bad} FAILED` : 'romm-test: all passed'); process.exit(bad ? 1 : 0);
})();
