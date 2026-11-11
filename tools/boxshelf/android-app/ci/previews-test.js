// Device test pass "previews" (beta.7), run by web-device-test.js: the demo page as Windows on a 1920x1080 TV.
//   Node side (main/previews.js): a game's video is found in ES-DE / EmuDeck / RetroBat / LaunchBox / your own folders,
//   by file name then title; Steam's DASH manifest becomes the first ~20 s of its 480p video; YouTube links are read.
//   Page: previews are off until chosen; in Details (beta.9, Windows) the preview plays at the top of Overview, and is
//   gone the moment Details closes; a console trailer clip still being made gets a waiting box, never YouTube's player;
//   nothing starts while the shelf is busy; "Details and shelf" plays softly behind the cases and stops when you move;
//   Settings has the Video previews rows; the first run offers previews with box art. Screenshots: previews-*.png.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..', '..');

module.exports = async function previewsPass({ browser, base, check, OUT }) {
  // ---------- node side ----------
  { const P = require(path.join(ROOT, 'main', 'previews'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-pv-')), put = p => { const f = path.join(home, ...p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'v'); return f; };
    const oldUP = process.env.USERPROFILE, oldH = process.env.HOME; process.env.USERPROFILE = home; process.env.HOME = home;
    P.init({ dataDir: path.join(home, 'data'), appRoot: path.join(home, 'Boxshelf') });
    const snes = { id: 'snes', romFolderNames: ['snes', 'sfc'] }, md = { id: 'megadrive', romFolderNames: ['megadrive', 'genesis'] }, gc = { id: 'gc', romFolderNames: ['gamecube', 'gc'] };
    const rb = path.join(home, 'RetroBat', 'roms', 'snes'); put('RetroBat/roms/snes/Super Metroid (USA).sfc'); const f1 = put('RetroBat/roms/snes/videos/Super Metroid (USA)-video.mp4');
    const es = put('ES-DE/downloaded_media/genesis/videos/Sonic the Hedgehog (USA, Europe).mp4'); // (ES-DE calls Mega Drive "genesis")
    const ed = path.join(home, 'Emulation', 'roms', 'gc'); const f3 = put('Emulation/tools/downloaded_media/gc/videos/Pikmin (USA).mp4'); fs.mkdirSync(ed, { recursive: true });
    const lb = put('LaunchBox/Videos/Nintendo GameCube/Wind Waker-01.mp4');
    const own = path.join(home, 'My videos'); const f5 = put('My videos/snes/Chrono Trigger.webm');
    const r1 = P.findFile(snes, { romDirs: [rb] }, { file: path.join(rb, 'Super Metroid (USA).sfc'), title: 'Super Metroid' });
    const r2 = P.findFile(md, { romDirs: [path.join(home, 'roms', 'md')] }, { file: path.join(home, 'roms', 'md', 'Sonic the Hedgehog (USA, Europe).md'), title: 'Sonic the Hedgehog' });
    const r3 = P.findFile(gc, { romDirs: [ed] }, { file: path.join(ed, 'Pikmin (USA).rvz'), title: 'Pikmin' });
    const r4 = P.findFile(gc, { romDirs: [ed] }, { file: path.join(ed, 'zelda-ww.rvz'), title: 'Wind Waker' }, { launchbox: { gc: 'Nintendo GameCube' } });
    const r5 = P.findFile(snes, { romDirs: [rb] }, { file: path.join(rb, 'Chrono Trigger (USA).sfc'), title: 'Chrono Trigger' }, { dirs: [own] });
    const r6 = P.findFile(snes, { romDirs: [rb] }, { file: path.join(rb, 'Nothing Here.sfc'), title: 'Nothing Here' }, { dirs: [own] });
    process.env.USERPROFILE = oldUP; process.env.HOME = oldH;
    check('Previews: a game\'s video is found in RetroBat, ES-DE, EmuDeck, LaunchBox and your own folders (by file name, then title); a game without one has none',
      r1 === f1 && r2 === es && r3 === f3 && r4 === lb && r5 === f5 && r6 === null, JSON.stringify([r1, r2, r3, r4, r5, r6].map(x => x && path.relative(home, x))));
    const mpd = '<MPD><Period><AdaptationSet contentType="video"><Representation id="0" height="528"><SegmentTemplate timescale="1000000" duration="3000000" initialization="dash_h264/init-stream$RepresentationID$.m4s" media="dash_h264/chunk-stream$RepresentationID$-$Number%05d$.m4s" startNumber="1"></SegmentTemplate></Representation><Representation id="1" height="480"><SegmentTemplate timescale="1000000" duration="3000000" initialization="dash_h264/init-stream$RepresentationID$.m4s" media="dash_h264/chunk-stream$RepresentationID$-$Number%05d$.m4s" startNumber="1"></SegmentTemplate></Representation></AdaptationSet><AdaptationSet contentType="audio"></AdaptationSet></Period></MPD>';
    const plan = P.dashPlan(mpd, 'https://video.akamai.steamstatic.com/store_trailers/1/2/abc/3/dash_h264.mpd?t=9');
    check('Previews: Steam\'s trailer manifest becomes its 480p video\'s first pieces (about 20 seconds)',
      plan && /init-stream1\.m4s\?t=9$/.test(plan.init) && plan.media.length === 7 && /chunk-stream1-00001\.m4s/.test(plan.media[0]) && /chunk-stream1-00007\.m4s/.test(plan.media[6]), JSON.stringify(plan && { init: plan.init.slice(-30), n: plan.media.length }));
    // (beta.12) the clip is the picture only: its sound is the manifest's audio track, ~25 seconds of it (a little longer)
    const mpdA = mpd.replace('<AdaptationSet contentType="audio"></AdaptationSet>', '<AdaptationSet contentType="audio"><Representation id="3" mimeType="audio/mp4"><SegmentTemplate timescale="1000000" duration="3000000" initialization="dash_h264/init-stream$RepresentationID$.m4s" media="dash_h264/chunk-stream$RepresentationID$-$Number%05d$.m4s" startNumber="1"></SegmentTemplate></Representation></AdaptationSet>');
    const planA = P.dashPlan(mpdA, 'https://video.akamai.steamstatic.com/store_trailers/1/2/abc/3/dash_h264.mpd?t=9', 'audio', 25), clipDirS = path.join(home, 'data', 'previews', 'steam');
    check('Previews (beta.12): a Steam trailer\'s sound is its audio track\'s first ~25 seconds; a Steam clip file is known by its app id (nothing else is)',
      planA && /init-stream3\.m4s\?t=9$/.test(planA.init) && planA.media.length === 9 && /chunk-stream3-00009\.m4s/.test(planA.media[8]) && P.dashPlan(mpd, 'https://x/y.mpd', 'audio', 25) === null
        && P.steamIdOf(path.join(clipDirS, '620.mp4')) === '620' && P.steamIdOf(path.join(home, 'data', 'previews', 'youtube', '620.mp4')) === null && P.steamIdOf(path.join(clipDirS, '..', 'steam', 'x620.mp4')) === null,
      JSON.stringify(planA && { init: planA.init.slice(-30), n: planA.media.length }));
    check('Previews: YouTube links (watch, youtu.be, embed) give the video; other sites none',
      P.youtubeId('https://www.youtube.com/watch?v=abcdefghijk') === 'abcdefghijk' && P.youtubeId('https://youtu.be/abcdefghijk') === 'abcdefghijk' && P.youtubeId('https://www.youtube-nocookie.com/embed/abcdefghijk') === 'abcdefghijk' && P.youtubeId('https://example.com/watch?v=abcdefghijk') === null);
    fs.rmSync(home, { recursive: true, force: true }); }

  // ---------- (beta.8) console trailers: main/ytclips.js with a made-up trailer stream and a pretend helper ----------
  { const Y = require(path.join(ROOT, 'main', 'ytclips')), P = require(path.join(ROOT, 'main', 'previews'));
    const box = (type, ...parts) => { const body = Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.alloc(p))); const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
    // a fragmented MP4 like YouTube's 480p stream: ftyp, moov, sidx (12 fragments of 3 s), then moof + mdat pairs
    const frags = Array.from({ length: 12 }, (_, i) => Buffer.concat([box('moof', 24), box('mdat', 4000 + i * 10)]));
    const sx = Buffer.alloc(24 + 12 * frags.length); sx.writeUInt32BE(1, 4); sx.writeUInt32BE(1000, 8); sx.writeUInt16BE(frags.length, 22);
    frags.forEach((f, i) => { sx.writeUInt32BE(f.length, 24 + i * 12); sx.writeUInt32BE(3000, 28 + i * 12); sx.writeUInt32BE(0x90000000, 32 + i * 12); });
    const head = Buffer.concat([box('ftyp', Buffer.from('dash0000iso6mp41')), box('moov', box('mvhd', 100))]), sidxBox = box('sidx', sx), stream = Buffer.concat([head, sidxBox, ...frags]);
    const pl = Y.plan(stream), want = frags.slice(0, 7).reduce((a, f) => a + f.length, 0);
    check('Console trailers: the stream\'s fragment index gives the first ~20 seconds (whole fragments, header kept, index dropped)',
      !!pl && pl.headEnd === head.length && pl.from === head.length + sidxBox.length && pl.to - pl.from === want && pl.seconds === 21, JSON.stringify(pl));
    // the whole flow: helper asked for the stream, two ranged reads, one file; asked again = the same file, no new reads
    const dd = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-yt-')); Y.init({ dataDir: dd }); P.init({ dataDir: dd }); Y._force(true);
    fs.mkdirSync(path.join(dd, 'tools'), { recursive: true }); fs.writeFileSync(path.join(dd, 'tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'), Buffer.alloc(1.2e6)); /* (beta.11: the Linux helper has no .exe) */
    const asked = [], reads = [];
    Y._setRun(async args => { asked.push(args.join(' ')); const u = args[args.length - 1]; if (/v=gone/.test(u)) throw new Error('ERROR: [youtube] gone: Video unavailable'); return JSON.stringify({ url: 'https://rr1---sn-test.googlevideo.com/videoplayback?id=1', http_headers: { 'User-Agent': 'test' } }); });
    Y._fetch(async url => { const m = /range=(\d+)-(\d+)/.exec(url); reads.push(m && m[0]); return m ? stream.subarray(+m[1], +m[2] + 1) : Buffer.alloc(0); });
    const st0 = Y.status(); const f1 = await Y.clip('abcdefghijk'); const n1 = reads.length; const f2 = await Y.clip('abcdefghijk'); const bad = await Y.clip('gone0000000'); const bad2 = await Y.clip('gone0000000');
    const out = f1 && fs.readFileSync(f1), st1 = Y.status();
    check('Console trailers: a clip is the header plus those fragments, made once and kept (a removed video is not asked again)',
      st0.helper && !!f1 && f1 === f2 && reads.length === n1 && n1 === 2 && out.length === head.length + want && out.subarray(0, head.length).equals(head) && /-f 136\[protocol=https\]\/135\[protocol=https\]\/134/.test(asked[0]) && /\.hd\.mp4$/.test(f1) && /watch\?v=abcdefghijk$/.test(asked[0]) && bad === null && bad2 === null && asked.filter(a => /gone/.test(a)).length === 1 && st1.n === 1 && Y.cached('abcdefghijk') === f1,
      JSON.stringify({ helper: st0.helper, f1: !!f1, same: f1 === f2, reads, size: out && out.length, want: head.length + want, bad, asked: asked.length, kept: st1.n }));
    // (beta.9) a 480p clip kept from before plays at once, its 720p one is made in the background, then the old one is gone
    const oldF = path.join(dd, 'previews', 'youtube', 'oldclip0001.mp4'); fs.writeFileSync(oldF, 'old');
    const c0 = Y.cached('oldclip0001'), up = await Y.clip('oldclip0001'), c1 = Y.cached('oldclip0001');
    check('Console trailers: a 480p clip from before plays at once, is remade from the 720p stream in the background, and the old one is removed',
      c0 === oldF && !!up && /oldclip0001\.hd\.mp4$/.test(up) && c1 === up && !fs.existsSync(oldF), JSON.stringify({ c0: c0 && path.basename(c0), up: up && path.basename(up), c1: c1 && path.basename(c1), oldLeft: fs.existsSync(oldF) }));
    // offline is not "gone": nothing is marked, clips pause for a while instead of asking again on every rest
    Y._reset(); const asked2 = [];
    Y._setRun(async args => { asked2.push(args[args.length - 1].slice(-11)); throw new Error('ERROR: [youtube] off0000000a: Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>'); });
    const o1 = await Y.clip('off0000000a'), o2 = await Y.clip('off0000000b');
    const offOk = o1 === null && o2 === null && asked2.length === 1 && !fs.existsSync(path.join(dd, 'previews', 'youtube', 'off0000000a.none'));
    // the queue (beta.11): two are made at once, so a slow one never holds the rest up; the newest ask goes first, at most
    // 5 wait (the oldest waiting one is dropped)
    Y._reset(); const order = []; let release; const gate = new Promise(r => { release = r; });
    Y._setRun(async args => { const id = args[args.length - 1].slice(-11); order.push(id); if (id === 'qqqqqqqqqq1') await gate; throw new Error('ERROR: [youtube] ' + id + ': Video unavailable'); });
    const qs = [1, 2, 3, 4, 5, 6, 7, 8].map(n => Y.clip('qqqqqqqqqq' + n)); await new Promise(r => setTimeout(r, 50)); const whileSlow = order.length; release(); await Promise.all(qs);
    check('Console trailers: offline marks nothing and pauses clips (no retry on every rest); two at once, the newest ask first, at most 5 wait',
      offOk && whileSlow === 7 && order.join() === 'qqqqqqqqqq1,qqqqqqqqqq2,qqqqqqqqqq8,qqqqqqqqqq7,qqqqqqqqqq6,qqqqqqqqqq5,qqqqqqqqqq4', JSON.stringify({ offOk, asked: asked2.length, whileSlow, order }));
    Y._reset(); Y._force(false); fs.rmSync(dd, { recursive: true, force: true }); }

  // ---------- the page ----------
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  ctx.setDefaultTimeout(90000);
  await ctx.addInitScript({ content: 'window.__TRAILERS = true; window.__previewUrl = "/__test/preview.webm";' });
  // a real clip from the test's own folder (the page no longer has to record one: deterministic on every machine)
  await ctx.route('**/__test/preview.webm', r => r.fulfill({ path: path.join(__dirname, 'fixtures', 'preview.webm'), contentType: 'video/webm' }));
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  const pause = ms => page.waitForTimeout(ms);
  const ready = async q => { await page.goto(base + q); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf._lib, null, { timeout: 90000, polling: 250 }); await pause(1500); };
  const toGame = async () => { for (let i = 0; i < 6; i++) { if (await page.evaluate(() => { const g = Shelf._lib.cur(); return !!g && g.kind === 'rom'; })) return; await page.keyboard.press('ArrowRight'); await pause(500); } };
  const media = () => page.evaluate(() => { const b = document.getElementById('dMedia'), v = document.getElementById('dVideo'), bv = document.getElementById('pvBack'), app = document.getElementById('app');
    return { cls: b.className, src: !!v.getAttribute('src'), t: v.currentTime, bg: app.classList.contains('pv-det'), bgSrc: !!bv.getAttribute('src'), bgT: bv.currentTime, tab: document.querySelector('#details .d-body').dataset.show,
      yt: !!window.__ytOn, rect: window.__ytRect || null, stops: window.__ytStops || 0, mode: Shelf.getMode(), paused: v.paused, sec: (document.querySelector('#dvNav .dv-t.cur') || { dataset: {} }).dataset.s || '' }; });
  try {
    // off by default
    await ready('?platform=windows&shelf=1'); await toGame(); await page.keyboard.press('i'); await pause(3500);
    const off = await media(); await page.keyboard.press('Escape'); await pause(500);
    check('Previews: off until you choose them (Details stays as it was)', !/\bon\b/.test(off.cls) && !off.src && !off.yt, JSON.stringify(off));

    // Details: a file preview, then a console trailer clip still being made
    await ready('?platform=windows&shelf=1&previews=details'); await toGame();
    // (beta.12, Windows: Details is one page in sections; the trailer's box is on the first screen beside Your play. A video
    // file plays framed there, never behind the case; scrolled out of sight (RB to Your copy) it pauses, and back on the
    // first screen (LB) it plays on; YouTube's own player is never loaded there by itself)
    let file = null, yt = null; const seen = [];
    for (let i = 0; i < 8 && !file; i++) {
      await page.keyboard.press('i'); await pause(1500);
      for (let w = 0; w < 25; w++) { const m = await media(); if (/\bready\b/.test(m.cls) || m.yt) break; await pause(400); } // (the page records its pretend clip the first time: slow on a build machine)
      let m = await media(); seen.push([m.tab, m.bg, m.src, m.cls, (await page.evaluate(() => { const g = Shelf._lib.cur(); return g && g.title; }))].join('/'));
      if (!file && m.tab === 'overview' && /\bready\b/.test(m.cls) && m.src && !m.bg && !/\byt\b/.test(m.cls)) { file = m; await page.screenshot({ path: path.join(OUT, 'previews-details.png') }); await pause(600); file.t2 = (await media()).t;
        file.above = await page.evaluate(() => { const b = document.getElementById('dMedia'), a = [...document.querySelectorAll('#details .dv-sec:not([data-s="overview"])')].find(e => !e.hidden && e.getBoundingClientRect().height > 0); // (the first section after Overview)
          return !!a && b.closest('.dv-sec[data-s="overview"]') !== null && b.getBoundingClientRect().bottom <= a.getBoundingClientRect().top + 1 && b.getBoundingClientRect().bottom <= innerHeight; });
        for (let k = 0; k < 8 && (await media()).sec !== 'copy'; k++) { await page.keyboard.press('e'); await pause(700); }
        await pause(900); const mm = await media(); file.behind = mm.sec === 'copy' && !mm.bg && !mm.bgSrc && /\bon\b/.test(mm.cls) && mm.paused;
        for (let k = 0; k < 8 && (await media()).sec !== 'overview'; k++) { await page.keyboard.press('q'); await pause(700); }
        await pause(1200); const m3 = await media(); file.backInBox = m3.tab === 'overview' && /\bready\b/.test(m3.cls) && m3.src && !m3.bg && !m3.paused; }
      await page.keyboard.press('Escape'); await pause(700);
      const after = await media(); if (file && !file.closed) file.closed = !after.src && !after.bgSrc && !after.bg;
      await page.keyboard.press('ArrowRight'); await pause(700);
    }
    check('Previews in Details (Windows): a video plays framed in its box on the first screen, never behind the case; it pauses while Your copy is in view (RB) and plays on back at the top (LB); it stops the moment Details closes',
      !!file && file.t2 !== file.t && file.above && file.behind && file.backInBox && file.closed, JSON.stringify(file ? { t: file.t, t2: file.t2, above: file.above, behind: file.behind, back: file.backInBox, closed: file.closed } : seen));
    // a console game whose trailer clip is still being made (main answers "youtube, pending"): Overview's box opens at once
    // with the game's art and waits for the clip; YouTube's own player is never loaded by itself (it lagged and took the
    // controller away), and the clip plays when it's ready
    await ready('?platform=windows&shelf=1&previews=details&clips=1&helper=1'); await toGame();
    await page.keyboard.press('i'); let wait0 = null; for (let w = 0; w < 20 && !wait0; w++) { await pause(100); const m0 = await media(); if (/\bon\b/.test(m0.cls)) wait0 = m0; }
    // (Your copy and straight back while it's still being made: the waiting box is there again)
    await page.keyboard.press('e'); await pause(250); await page.keyboard.press('q'); await pause(250); const rt = await media();
    let ready1 = null; for (let w = 0; w < 30 && !ready1; w++) { await pause(300); const m1 = await media(); if (/\bready\b/.test(m1.cls)) ready1 = m1; }
    yt = { waiting: wait0 && wait0.cls, ytWhileWaiting: wait0 ? wait0.yt : null, roundTrip: rt.tab === 'overview' && /\bon\b/.test(rt.cls), played: ready1 && ready1.cls, src: ready1 && ready1.src, ytAfter: (await media()).yt };
    await page.keyboard.press('Escape'); await pause(600);
    check('Previews in Details (Windows): while a console trailer clip is made, Overview\'s box opens at once and waits for it without loading YouTube\'s player (it lagged and took the controller), then plays the clip',
      !!yt.waiting && !/\byt\b/.test(yt.waiting) && yt.ytWhileWaiting === false && yt.roundTrip && !!yt.played && yt.src && yt.ytAfter === false, JSON.stringify(yt));
    // Details' layout: Play, Read booklet, Inspect, Favourite and More in one row, the rest in More (opened and closed with the
    // keyboard and B / Esc); one page in sections, Your play's summary beside the trailer
    await page.keyboard.press('i'); await pause(1200);
    const lay = await page.evaluate(() => { const bar = [...document.querySelectorAll('#details .d-actions > button')].filter(b => !b.hidden).map(b => b.id), menu = [...document.querySelectorAll('#dMenu button')].filter(b => !b.hidden).map(b => b.id);
      return { bar, menu, secs: [...document.querySelectorAll('#dvNav .dv-t')].filter(b => !b.hidden).map(b => b.dataset.s), tabsShown: getComputedStyle(document.getElementById('dTabs')).display !== 'none', stats: document.querySelectorAll('#dStats .d-stat').length }; });
    await page.click('#dMoreBtn'); await pause(400); const open = await page.evaluate(() => !document.getElementById('dMenu').hidden && document.querySelector('#dMenu .pad-focus') !== null);
    await page.keyboard.press('Escape'); await pause(400); const shut = await page.evaluate(() => document.getElementById('dMenu').hidden && Shelf.getMode() === 'details');
    await page.keyboard.press('Escape'); await pause(500);
    check('Details (Windows): Play, Read booklet, Inspect, Favourite and More in one row; the rest in More (Esc closes More first, then Details); sections in place of tabs, and Your play beside the trailer',
      JSON.stringify(lay.bar) === JSON.stringify(['dPlay', 'dManual', 'dInspect', 'dFav', 'dMoreBtn']) && ['dEmu', 'dGameEmu', 'dBoxArt', 'dRename', 'dChooseManual', 'dHide', 'dCols'].every(id => lay.menu.includes(id)) &&
      ['overview', 'play', 'copy', 'info'].every(s => lay.secs.includes(s)) && !lay.tabsShown && lay.stats === 3 && open && shut, JSON.stringify({ ...lay, open, shut }));
    // (beta.9) Details buttons in Settings' style (Windows): Play lit, Settings' highlight gliding under the one you're on, and
    // the row never wider than the page (beta.12: on a TV-sized window every button says its name)
    await page.mouse.move(5, 5); // (the More click above left the pointer on More: hovering it rightly opens its name)
    await page.keyboard.press('i'); await pause(1200);
    const sl = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), out = {};
      const pad = { id: 'Test pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] }); window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad }));
      // (beta.11) held 250 ms: a software-drawn runner reads the pad once a frame, and a 150 ms press could fall between two reads
      const press = async b => { if (window.__padHold) { await __padHold(pad, b, 250); await w(450); return; } pad.buttons[b] = { pressed: true, touched: true, value: 1 }; pad.timestamp++; await w(250); pad.buttons[b] = { pressed: false, touched: false, value: 0 }; pad.timestamp++; await w(450); };
      const bar = document.querySelector('#details .d-actions'), $ = id => document.getElementById(id);
      out.fits = bar.scrollWidth <= bar.clientWidth + 1; out.labelled = ['dManual', 'dInspect', 'dFav', 'dMoreBtn'].every(id => { const s = $(id).querySelector('span'); return $(id).offsetWidth > 64 && !!s && getComputedStyle(s).opacity === '1'; });
      out.lit = getComputedStyle($('dPlay')).backgroundImage.includes('gradient');
      // (where things end up is what's judged, not the animation: a software-drawn runner was still mid-glide after 3 s)
      const still = document.createElement('style'); still.textContent = '#details .d-actions, #details .d-actions *, #details .d-actions::before { transition: none !important; animation: none !important }'; document.head.appendChild(still);
      // Play → Manual → Inspect: right until Inspect has the focus (a slow runner can miss a press: at most six, then judged)
      const onId = () => (document.querySelector('#details .pad-focus') || {}).id;
      for (let i = 0; i < 10 && onId() !== 'dInspect'; i++) await press(15); // (beta.11: up to ten presses)
      // (the highlight's glide and the name opening are transitions: a software-drawn runner finishes them late, so they are
      // judged once settled, up to 3 s)
      const f = document.querySelector('#details .pad-focus'), hl = bar.querySelector('.d-hl'), sp = f && f.querySelector('span'); out.on = f && f.id;
      const judge = () => { if (!f || !hl) return; const a = f.getBoundingClientRect(), b = hl.getBoundingClientRect(); out.glide = hl.classList.contains('on') && Math.abs(a.left - b.left) < 2 && Math.abs(a.width - b.width) < 2;
        out.named = !!sp && getComputedStyle(sp).opacity === '1' && f.offsetWidth > 64; };
      for (let i = 0; i < 15; i++) { await w(200); judge(); if (out.glide && out.named) break; }
      if (!(out.glide && out.named) && f && hl) { const a = f.getBoundingClientRect(), b = hl.getBoundingClientRect(); out.dbg = { f: [Math.round(a.left), Math.round(a.width)], hl: [Math.round(b.left), Math.round(b.width)], hlOn: hl.classList.contains('on'), op: sp && getComputedStyle(sp).opacity, iw: innerWidth, pad: document.body.classList.contains('pad-input') }; }
      out.fits2 = bar.scrollWidth <= bar.clientWidth + 1; still.remove();
      try { delete navigator.getGamepads; } catch (e) {} // (the test's own "no controllers" on the prototype comes back)
      return out; });
    await page.keyboard.press('Escape'); await pause(500);
    check('Details (Windows): Play lit, Read booklet / Inspect / Favourite / More labelled; on the controller Settings\' highlight glides under the one you\'re on, and the row fits the page',
      sl.fits && sl.labelled && sl.lit && sl.on === 'dInspect' && sl.glide && sl.named && sl.fits2, JSON.stringify(sl));
    // a narrow window (under 761 px: Details is the phone-style sheet): moving along the buttons with the controller never
    // shifts them (the highlight layer is never a flex item of the row)
    await page.setViewportSize({ width: 700, height: 900 }); await pause(700); await page.keyboard.press('i'); await pause(1200);
    const nw = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), out = {};
      const pad = { id: 'Test pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] }); window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad }));
      // (beta.11) held 250 ms: a software-drawn runner reads the pad once a frame, and a 150 ms press could fall between two reads
      const press = async b => { if (window.__padHold) { await __padHold(pad, b, 250); await w(450); return; } pad.buttons[b] = { pressed: true, touched: true, value: 1 }; pad.timestamp++; await w(250); pad.buttons[b] = { pressed: false, touched: false, value: 0 }; pad.timestamp++; await w(450); };
      const bar = document.querySelector('#details .d-actions'), xs = () => [...bar.querySelectorAll(':scope>button')].filter(b => !b.hidden).map(b => b.offsetLeft + ',' + b.offsetTop).join(' ');
      const onId = () => (document.querySelector('#details .pad-focus') || {}).id; // (a slow runner can miss a press: right until the controller is off Play, at most six)
      out.x0 = xs(); await press(15); for (let i = 0; i < 6 && (!onId() || onId() === 'dPlay'); i++) await press(15); await press(15); await w(300); out.x1 = xs(); out.on = onId();
      const hl = bar.querySelector(':scope>.d-hl'); out.hlFlex = !!hl && getComputedStyle(hl).position !== 'absolute' && getComputedStyle(hl).display !== 'none';
      try { delete navigator.getGamepads; } catch (e) {} return out; });
    await page.keyboard.press('Escape'); await pause(500); await page.setViewportSize({ width: 1920, height: 1080 }); await pause(700);
    check('Details (Windows, narrow window): moving along the buttons with the controller never shifts them',
      nw.x0 === nw.x1 && !!nw.on && nw.on !== 'dPlay' && !nw.hlFlex, JSON.stringify(nw));
    // (beta.9) the screenshot strip in Overview: with the controller the picture you're on is centred by a smooth scroll and
    // never cut off at the strip's edge
    await ready('?platform=windows&shelf=1&previews=details&shots=1'); await toGame(); // (the demo games with eight screenshots each; previews on, as the checks after this expect)
    const ss = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), out = {};
      const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); key('i'); await w(1500);
      const pad = { id: 'Test pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] }); window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad }));
      const press = async b => { if (window.__padHold) { await __padHold(pad, b, 150); await w(500); return; } pad.buttons[b] = { pressed: true, touched: true, value: 1 }; pad.timestamp++; await w(150); pad.buttons[b] = { pressed: false, touched: false, value: 0 }; pad.timestamp++; await w(500); };
      const foc = () => document.querySelector('#details .pad-focus');
      out.path = []; out.shots = document.querySelectorAll('#dShots .d-shot').length; out.shotsHidden = document.getElementById('dShots').hidden;
      for (let i = 0; i < 10 && !(foc() && foc().classList.contains('d-shot')); i++) { await press(13); const f = foc(); out.path.push(f ? (f.id || f.className || f.tagName) : '-'); }
      out.inStrip = !!(foc() && foc().classList.contains('d-shot'));
      const strip = document.getElementById('dShots'), lefts = [];
      // (beta.11) each step waits until the highlight has moved, pressing again if the slow runner missed the press, and the
      // strip is sampled while it moves; a glide = a step that passed through a place between where it was and where it ended
      const idx = () => [...strip.children].indexOf(foc()); let glides = 0;
      for (let i = 0; i < 4; i++) { const i0 = idx(), s0 = Math.round(strip.scrollLeft), seen = new Set([s0]);
        for (let tries = 0; tries < 3 && idx() === i0; tries++) { pad.buttons[15] = { pressed: true, touched: true, value: 1 }; pad.timestamp++; await w(150); pad.buttons[15] = { pressed: false, touched: false, value: 0 }; pad.timestamp++;
          for (let t = 0; t < 12; t++) { await w(30); const v = Math.round(strip.scrollLeft); seen.add(v); lefts.push(v); } }
        await w(500); const s1 = Math.round(strip.scrollLeft); if ([...seen].some(v => v !== s0 && v !== s1)) glides++; }
      out.moved = idx(); out.glides = glides;
      const f = foc(), r = f.getBoundingClientRect(), q = strip.getBoundingClientRect();
      out.steps = new Set(lefts).size; out.scrolled = strip.scrollLeft > 0; out.centre = Math.round(Math.abs((r.left + r.right) / 2 - (q.left + q.right) / 2));
      out.inside = r.left >= q.left - 1 && r.right <= q.right + 1; out.index = [...strip.children].indexOf(f);
      try { delete navigator.getGamepads; } catch (e) {} key('Escape'); await w(600); return out; });
    check('Details (Windows): with the controller the screenshot strip glides to centre the picture you\'re on, which is never cut off',
      ss.inStrip && ss.scrolled && ss.glides >= 1 && ss.index >= 3 && ss.centre <= 40 && ss.inside, JSON.stringify(ss));

    // (beta.12) Details redesigned around the case (Windows): Play has the focus when it opens; LB / RB (and Q / E) jump a
    // section and the bar shows where you are; the trailer's box is on the first screen; Your play from a seeded history;
    // Status is saved per game; Favourite toggles; every older action is still there
    const rd = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), out = {}, $ = id => document.getElementById(id);
      const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      for (let i = 0; i < 8 && Shelf.getMode() !== 'browse'; i++) { key('Escape'); await w(400); }
      const g = Shelf._lib.cur(), now = Date.now() / 1000; out.game = g && g.title;
      // three sessions: an hour and half an hour this week, two hours twenty days ago; first played thirty days ago
      Shelf._mus.hist({ [g.id]: { count: 3, ms: 12600000, last: (now - 3600) * 1000, first: (now - 30 * 86400) * 1000, long: 7200000, s: [[Math.round(now - 20 * 86400), 7200], [Math.round(now - 2 * 86400), 1800], [Math.round(now - 3600), 3600]] } });
      key('i'); for (let i = 0; i < 20 && Shelf.getMode() !== 'details'; i++) await w(150); await w(1200);
      const cur = () => (document.querySelector('#dvNav .dv-t.cur') || { dataset: {} }).dataset.s || '', foc = () => document.querySelector('#details .pad-focus');
      out.playFocused = !!foc() && foc().id === 'dPlay' && document.activeElement === $('dPlay') && cur() === 'overview';
      // the trailer's box: on the first screen, beside Your play, right of the case
      { const v = $('dvVid').getBoundingClientRect(), p = $('dStats').getBoundingClientRect(), c = document.querySelector('.slot.sel .f-front').getBoundingClientRect();
        out.box = !$('dvDuo').hidden && v.width > 200 && v.bottom <= innerHeight && v.top >= 0 && Math.abs(p.top - v.top) < v.height && p.left > v.right && v.left > c.right; out.trailerBtn = !$('dTrailer').hidden; }
      /* (beta.12 test.8: the other cases fade by their faces, so they stay 3D; waited for: on a slow machine the fade is still under way at first) */
      const othersOut = () => [...document.querySelectorAll('.slot:not(.sel)')].every(s => s.classList.contains('far') || getComputedStyle(s).opacity === '0' || [...s.querySelectorAll(':scope > .box > .face')].every(f => getComputedStyle(f).opacity === '0'));
      for (let i = 0; i < 30 && !othersOut(); i++) await w(200); out.others = othersOut();
      // Your play
      const tile = k => { const t = document.querySelector(`#dvTiles .dv-tile[data-k="${k}"] b`); return t ? t.textContent : ''; };
      out.stats = { time: tile('Play time'), launches: tile('Launches'), avg: tile('Average'), longest: tile('Longest'), first: tile('First played'), share: document.querySelector('#dvTiles .dv-tile:last-child b').textContent, week: $('dvWk').textContent, bars: $('dvBars').children.length,
        tallest: [...$('dvBars').children].map(b => parseFloat(b.style.height)).indexOf(100) };
      out.statsOk = out.stats.time === '3 h 30 min' && out.stats.launches === '3' && out.stats.avg === '1 h 10 min' && out.stats.longest === '2 h' && /\d{4}/.test(out.stats.first) && out.stats.share === '100%' && out.stats.week === '1 h 30 min' && out.stats.bars === 8 && out.stats.tallest === 5;
      // LB / RB: a pretend controller's bumpers, then Q / E on the keyboard
      const pad = { id: 'Test pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] }); window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad }));
      const press = async b => { if (window.__padHold) { await __padHold(pad, b, 250); await w(650); return; } pad.buttons[b] = { pressed: true, touched: true, value: 1 }; pad.timestamp++; await w(250); pad.buttons[b] = { pressed: false, touched: false, value: 0 }; pad.timestamp++; await w(650); };
      const order = [...document.querySelectorAll('#dvNav .dv-t')].filter(t => !t.hidden).map(t => t.dataset.s); out.order = order;
      const s0 = cur(); for (let i = 0; i < 3 && cur() === s0; i++) await press(5);
      const s1 = cur(), f1 = foc(), d = $('details'); out.rb = { from: s0, to: s1, focusIn: !!f1 && !!f1.closest(`.dv-sec[data-s="${s1}"]`) || !!f1 && order.indexOf((f1.closest('.dv-sec') || { dataset: {} }).dataset.s) > order.indexOf(s1), scrolled: d.scrollTop > 0 };
      for (let i = 0; i < 3 && cur() !== s0; i++) await press(4);
      out.lb = cur() === s0 && foc() && foc().id === 'dPlay';
      try { delete navigator.getGamepads; } catch (e) {}
      key('e'); await w(900); const k1 = cur(); key('e'); await w(900); const k2 = cur(); key('q'); await w(900); out.keys = [k1, k2, cur()];
      out.keysOk = order.indexOf(k1) === 1 && order.indexOf(k2) === 2 && order.indexOf(out.keys[2]) === 1;
      out.hint = [...document.querySelectorAll('#hints .lab')].map(x => x.textContent).includes('Sections');
      // Status: Playing saved for this game, pressed again it's cleared
      const opt = v => document.querySelector(`#dvStatus .dv-opt[data-v="${v}"]`), saved = async () => ((((await window.boxshelf.getConfig()).config.games || {})[g.id]) || {}).status || '';
      const n0 = window.__statusSaved || 0; opt('playing').click(); await w(400);
      out.status = { on: opt('playing').classList.contains('on') && opt('playing').getAttribute('aria-checked') === 'true', saved: await saved(), calls: (window.__statusSaved || 0) - n0 };
      opt('finished').click(); await w(400); out.status.changed = await saved(); opt('finished').click(); await w(400); out.status.cleared = await saved();
      // Favourite: on, then off again (the shelf's own favourite list)
      const favs = async () => (((await window.boxshelf.getConfig()).config.ui || {}).favorites || []).includes(g.id);
      const f0 = await favs(); $('dFav').click(); await w(700); const f1b = await favs(), p1 = $('dFav').getAttribute('aria-pressed'); $('dFav').click(); await w(700);
      out.fav = { before: f0, on: f1b, pressed: p1, after: await favs(), pressedAfter: $('dFav').getAttribute('aria-pressed') };
      // every older action is still reachable: in the page, in More, or as Your copy's rows (which press the same buttons)
      const ids = ['dPlay', 'dManual', 'dInspect', 'dMoreBtn', 'dEmu', 'dGameEmu', 'dBoxArt', 'dRename', 'dChooseManual', 'dHide', 'dCols', 'dClose', 'dTrailer', 'dCmd', 'dGrid', 'dDesc', 'dAch'];
      out.missing = ids.filter(id => !$(id) || !$('details').contains($(id)));
      $('dMoreBtn').click(); await w(400); out.menu = [...document.querySelectorAll('#dMenu button')].filter(b => !b.hidden && b.offsetParent).map(b => b.id); key('Escape'); await w(400);
      out.rows = ['dvArt', 'dvMan', 'dvEmu'].filter(id => $(id) && !$(id).hidden);
      const emu0 = ((((await window.boxshelf.getConfig()).config.games || {})[g.id]) || {}).emulator || ''; $('dvEmu').click(); await w(700); const emu1 = ((((await window.boxshelf.getConfig()).config.games || {})[g.id]) || {}).emulator || '';
      out.emuRow = emu0 !== emu1; if (emu0 !== emu1) { $('dvEmu').click(); await w(700); }
      out.mode = Shelf.getMode(); key('Escape'); await w(700); return out; });
    check('Details redesign (Windows): Play has the focus when Details opens; the other cases fade away; the trailer\'s box is on the first screen beside Your play, right of the case',
      rd.playFocused && rd.box && rd.others, JSON.stringify({ playFocused: rd.playFocused, box: rd.box, others: rd.others }));
    check('Details redesign (Windows): LB / RB (and Q / E) jump a section, the bar shows where you are, the controller lands in it; LB back to the top is Play; the hint bar says Sections',
      rd.rb.from === 'overview' && rd.rb.to === rd.order[1] && rd.rb.focusIn && rd.rb.scrolled && rd.lb && rd.keysOk && rd.hint, JSON.stringify({ order: rd.order, rb: rd.rb, lb: rd.lb, keys: rd.keys, hint: rd.hint }));
    check('Details redesign (Windows): Your play from the history (time, launches, average, longest, first played, share of the console, hours by week)',
      rd.statsOk, JSON.stringify(rd.stats));
    check('Details redesign (Windows): Status is saved per game (Playing, then Finished; pressed again it clears)',
      rd.status.on && rd.status.saved === 'playing' && rd.status.calls === 1 && rd.status.changed === 'finished' && rd.status.cleared === '', JSON.stringify(rd.status));
    check('Details redesign (Windows): Favourite in Details adds the game to the shelf\'s favourites and takes it off again',
      rd.fav.on !== rd.fav.before && rd.fav.pressed === String(!rd.fav.before) && rd.fav.after === rd.fav.before && rd.fav.pressedAfter === String(rd.fav.before), JSON.stringify(rd.fav));
    check('Details redesign (Windows): every older action is still there (More: emulator, its own emulator, box art, rename, manual, hide, collections; Your copy\'s rows press the same buttons)',
      !rd.missing.length && ['dEmu', 'dGameEmu', 'dBoxArt', 'dRename', 'dChooseManual', 'dHide', 'dCols'].every(id => rd.menu.includes(id)) && rd.rows.length === 3 && rd.emuRow && rd.mode === 'details',
      JSON.stringify({ missing: rd.missing, menu: rd.menu, rows: rd.rows, emuRow: rd.emuRow, mode: rd.mode }));

    // nothing starts while the shelf is busy
    await page.evaluate(() => { window.__busy = window.BS_BUSY; window.BS_BUSY = () => true; });
    await page.keyboard.press('i'); await pause(3500); const busy = await media(); // (the clip is recorded by now: the wait below is the rest delay only)
    await page.evaluate(() => { window.BS_BUSY = window.__busy; }); await pause(4000); const free = await media();
    await page.keyboard.press('Escape'); await pause(500);
    check('Previews: nothing starts while the shelf is busy; it starts once it\'s still', !/\bon\b/.test(busy.cls) && !busy.bg && (/\bon\b/.test(free.cls) || free.bg), JSON.stringify({ busy: [busy.cls, busy.bg], free: [free.cls, free.bg] }));

    // Details and shelf: behind the cases, gone when you move
    await ready('?platform=windows&shelf=1&previews=shelf'); await toGame();
    let back = false; for (let i = 0; i < 6 && !back; i++) { await pause(4200); back = await page.evaluate(() => document.getElementById('app').classList.contains('pv-on')); if (!back) { await page.keyboard.press('ArrowRight'); } }
    if (back) await page.screenshot({ path: path.join(OUT, 'previews-shelf.png') });
    await page.keyboard.press('ArrowRight'); await pause(150);
    const moved = await page.evaluate(() => document.getElementById('app').classList.contains('pv-on'));
    check('Previews behind the shelf: soft video behind the cases after a rest, gone as soon as you move', back && !moved, JSON.stringify({ back, moved }));

    // (beta.8) console trailers: a console game with only a YouTube trailer plays its clip behind the shelf once it's made,
    // and straight away the next time; in Details it plays behind the case
    await ready('?platform=windows&shelf=1&previews=shelf&clips=1&helper=1'); await toGame();
    const cg = await page.evaluate(() => Shelf._lib.cur().title);
    let cb = false; for (let w = 0; w < 30 && !cb; w++) { await pause(400); cb = await page.evaluate(() => document.getElementById('app').classList.contains('pv-on')); }
    const made = await page.evaluate(() => window.__clipsMade || 0);
    await page.keyboard.press('ArrowRight'); await pause(900); await page.keyboard.press('ArrowLeft'); await pause(900);
    let again = false, t0 = Date.now(); for (let w = 0; w < 20 && !again; w++) { await pause(300); again = await page.evaluate(() => document.getElementById('app').classList.contains('pv-on')); }
    const againMs = Date.now() - t0, made2 = await page.evaluate(() => window.__clipsMade || 0);
    // (beta.9, Windows: in Details the clip plays in Overview's box, not behind the case)
    await page.keyboard.press('i'); let dc = false; for (let w = 0; w < 25 && !dc; w++) { await pause(400); dc = await page.evaluate(() => { const b = document.getElementById('dMedia'); return b.classList.contains('ready') && !!document.getElementById('dVideo').getAttribute('src') && !window.__ytOn; }); }
    await page.screenshot({ path: path.join(OUT, 'previews-console-clip.png') });
    // (beta.12) sound in the box: A / Enter (here a real click on the box) turns it on: the clip stays muted and its sound file
    // plays in step; - / + (and LT / RT) set the volume; the speaker turns it off; a video with its own sound just unmutes
    const boxSt = () => page.evaluate(() => { const v = document.getElementById('dVideo'), a = document.getElementById('dAudio'), s = document.querySelector('#details .dv-snd');
      return { label: (document.getElementById('dvTrL') || {}).textContent, on: !!(s && s.classList.contains('on')), vMuted: v.muted, aSrc: !!(a && /^(blob|bsfile):/.test(a.getAttribute('src') || '')), aPaused: a ? a.paused : null, aVol: a ? Math.round(a.volume * 100) : null, vVol: Math.round(v.volume * 100), mode: Shelf.getMode() }; });
    const snd = { before: await boxSt() };
    await page.click('#dTrailer'); await pause(900); snd.on = await boxSt();
    await page.focus('#dTrailer'); await page.keyboard.press('-'); await pause(300); snd.down = await boxSt(); await page.keyboard.press('='); await pause(300); snd.up = await boxSt();
    await page.click('#details .dv-spk'); await pause(400); snd.off = await boxSt();
    await page.evaluate(() => { window.__ownSound = true; }); await page.click('#dTrailer'); await pause(700); snd.own = await boxSt(); await page.click('#dTrailer'); await pause(300); await page.evaluate(() => { window.__ownSound = false; });
    check('Details (beta.12, Windows): A on the trailer box turns its sound on right there (its sound file playing, the clip muted), says Mute; - / + set the volume; the speaker turns it off',
      snd.before.label === 'Turn sound on' && !snd.before.on && snd.on.on && snd.on.label === 'Mute' && snd.on.aSrc && snd.on.vMuted && snd.on.aPaused === false && snd.on.mode === 'details'
      && snd.down.aVol === snd.on.aVol - 10 && snd.up.aVol === snd.on.aVol && !snd.off.on && snd.off.aPaused === true && snd.off.label === 'Turn sound on', JSON.stringify(snd));
    check('Details (beta.12): a trailer with its own sound (a Steam one) is simply unmuted in the box', snd.own.on && snd.own.vMuted === false && snd.own.vVol === snd.on.aVol, JSON.stringify(snd.own));
    await page.keyboard.press('Escape'); await pause(600);
    check('Console trailers: a console game\'s clip plays behind the shelf once it\'s made, is reused the next time (not made again), and plays in Overview\'s box in Details',
      cb && made === 1 && again && made2 === 1 && dc, JSON.stringify({ game: cg, shelf: cb, made, again, againMs, made2, details: dc }));

    // (beta.8) no helper yet: a card on the shelf says so once, and its button gets it
    await ready('?platform=windows&shelf=1&previews=shelf&clips=1');
    let card = ''; for (let w = 0; w < 50 && !card; w++) { await pause(400); card = await page.evaluate(() => { const c = document.querySelector('.note-card.on'); return c ? c.innerText : ''; }); }
    if (card) { await page.screenshot({ path: path.join(OUT, 'previews-helper-card.png') }); await page.keyboard.press('Enter'); }
    let hs = null; for (let w = 0; w < 20 && !(hs && hs.helper); w++) { await pause(300); hs = await page.evaluate(() => window.boxshelf.clipStatus()); }
    check('Console trailers: with no helper yet, a card on the shelf says so once and its button gets it',
      /Console games can play their trailers too/.test(card) && /Get the helper/.test(card) && !!hs && hs.helper, JSON.stringify({ card: card.split('\n').slice(0, 3), helper: hs && hs.helper }));

    // Settings → Video previews: a section of its own in the side list (no longer inside Box art & manuals)
    await ready('?platform=windows&shelf=1&previews=shelf&clips=1');
    await page.evaluate(() => Setup.open({ page: 'art' })); await pause(1500);
    const artRows = await page.evaluate(() => ((document.querySelector('.bss-scroll') || {}).innerText || '').split('\n').filter(l => /^Video previews$/.test(l.trim())).length);
    const side = await page.evaluate(() => [...document.querySelectorAll('.bss-side .bss-nav')].map(e => e.textContent.trim()));
    await page.locator('.bss-side .bss-nav', { hasText: 'Video previews' }).first().click(); // (as a person would: the side list)
    const list =() => page.evaluate(() => ((document.querySelector('.bss-scroll') || {}).innerText || ''));
    let st = ''; for (let w = 0; w < 60 && !(/Console trailers/.test(st) && /Found|23 games/.test(st)); w++) { await pause(300); st = await list(); } // (slow build machines)
    const getBtn = page.getByText(/^Get the trailer helper/).first(); let got = '';
    if (await getBtn.count()) { await getBtn.click(); for (let w = 0; w < 60 && !/Console trailer clips/.test(got); w++) { await pause(300); got = await list(); } }
    check('Settings: Video previews is its own section under Library (after Box art & manuals): where they play, Console trailers with its helper, sound, start after, YouTube, the videos found',
      artRows === 0 && side.includes('Video previews') && side.indexOf('Video previews') > side.indexOf('Box art & manuals') && side.indexOf('Video previews') < side.indexOf('Magazines & guides') &&
      /Play previews/.test(st) && /Console trailers/.test(st) && /Get the trailer helper/.test(st) && /Play previews with sound/.test(st) && /Start a preview after/.test(st) && !/YouTube.s player/.test(st) /* (beta.9: the Thor only) */ && /23 games|Found/i.test(st) && /Console trailer clips/.test(got),
      JSON.stringify({ artRows, side: side.filter(s => /Box art|Video|Magazines/.test(s)), rows: st.split('\n').filter(l => /video|preview|trailer|helper/i.test(l)).slice(0, 9), helperAfter: /Console trailer clips/.test(got) }));

    // first run: box art yes → previews offered, on, with what was found
    await page.goto(base + '?platform=windows&retro=1'); await page.waitForSelector('#setup.on', { timeout: 90000 }); await pause(800);
    await page.getByRole('button', { name: 'Find my emulators and games' }).click(); await pause(1800);
    await page.getByRole('button', { name: 'Next' }).click(); await pause(800);
    await page.getByRole('button', { name: 'Next' }).click(); await pause(800);
    await page.getByRole('button', { name: 'Yes, download box art' }).click(); await pause(2000);
    const fr = await page.evaluate(() => ({ on: !!(document.getElementById('wz2-pv') || {}).checked, clips: !!(document.getElementById('wz2-pvclip') || {}).checked, found: ((document.querySelector('.wz2-pvfound') || {}).textContent || '') }));
    await page.screenshot({ path: path.join(OUT, 'previews-first-run.png') });
    check('First run: saying yes to box art offers video previews, on (shelf and Details), console trailers ticked, with the videos already found', fr.on && fr.clips && /Found videos for 23/.test(fr.found), JSON.stringify(fr));
    check('Previews pass: no page errors', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) { check('Previews pass ran to the end', false, e.message.split('\n')[0]); try { await page.screenshot({ path: path.join(OUT, 'previews-fail.png') }); } catch {} }
  await ctx.close();

  // ---------- (beta.9) the Thor (pretend device): off until chosen; then a video beside the game plays in Details ----------
  { const tctx = await browser.newContext({ viewport: { width: 853, height: 480 }, deviceScaleFactor: 2.25, hasTouch: true, isMobile: true });
    tctx.setDefaultTimeout(90000);
    await tctx.addInitScript({ content: 'window.__previewUrl = "/__test/preview.webm";' });
    await tctx.route('**/__test/preview.webm', r => r.fulfill({ path: path.join(__dirname, 'fixtures', 'preview.webm'), contentType: 'video/webm' }));
    const tp = await tctx.newPage(), terr = []; tp.on('pageerror', e => terr.push(e.message));
    try {
      await tp.goto(base + '?fakeNative=1'); await tp.waitForTimeout(4000);
      const first = await tp.evaluate(async () => { const api = window.boxshelf, info = await api.getConfig(), det = await api.detect(), c = info.config, was = (c.ui || {}).previews || 'off';
        c.systems.gc.romDirs = [await api.pick({ kind: 'folder' })]; c.systems.gc.emulator = det.systems.gc.emulator; c.setupDone = true; c.ui.previews = 'details'; c.ui.previewDelay = 1; await api.saveConfig(c); await api.scan(); return was; });
      await tp.goto(base + '?fakeNative=1'); await tp.waitForFunction(() => window.Shelf && Shelf._lib && Shelf._lib.cur(), null, { timeout: 90000, polling: 250 }); await tp.waitForTimeout(3000);
      for (let i = 0; i < 6 && !/Pikmin/.test(await tp.evaluate(() => (Shelf._lib.cur() || {}).title || '')); i++) { await tp.keyboard.press('ArrowRight'); await tp.waitForTimeout(900); }
      const onShelf = await tp.evaluate(() => document.getElementById('app').classList.contains('pv-on'));
      await tp.keyboard.press('i'); let det = false; for (let w = 0; w < 30 && !det; w++) { await tp.waitForTimeout(400); det = await tp.evaluate(() => document.getElementById('app').classList.contains('pv-det')); }
      const copied = await tp.evaluate(() => (window.__copied || []).join(' ')); await tp.screenshot({ path: path.join(OUT, 'previews-thor-details.png') });
      // (beta.12) the Thor keeps its own Details: the header with its cover, the tabs (Overview, Media, Your copy), the panes,
      // the trailer in the Media tab, none of the Windows page's sections, Favourite or backdrop
      const thorDet = await tp.evaluate(() => { const $ = id => document.getElementById(id), d = $('details');
        return { mode: Shelf.getMode(), dv2: d.classList.contains('dv2') || document.getElementById('app').classList.contains('dv2'), newBits: ['dvNav', 'dFav', 'dvBack', 'dvTiles', 'dvStatus', 'dvCap'].filter(id => $(id)),
          tabs: [...$('dTabs').querySelectorAll('button')].map(b => b.dataset.tab).join(), tabsShown: getComputedStyle($('dTabs')).display !== 'none', cover: !!d.querySelector('.d-hero #dCover') && $('dCover').getBoundingClientRect().width > 0,
          mediaPane: !!d.querySelector('.d-pane[data-pane="media"] #dMedia') && !!d.querySelector('.d-pane[data-pane="media"] #dTrailer'), bar: [...d.querySelectorAll('.d-actions > button')].map(b => b.id).join(), panes: d.querySelectorAll('.d-body > .d-pane').length,
          sections: d.querySelectorAll('.dv-sec').length }; });
      check('Thor: Details is unchanged (its header and cover, tabs Overview / Media / Your copy, the trailer in Media; none of the Windows page\'s sections, Favourite or backdrop)',
        thorDet.mode === 'details' && !thorDet.dv2 && !thorDet.newBits.length && thorDet.tabs === 'overview,media,copy' && thorDet.tabsShown && thorDet.cover && thorDet.mediaPane && thorDet.panes === 3 && !thorDet.sections && !/dFav/.test(thorDet.bar), JSON.stringify(thorDet));
      await tp.keyboard.press('Escape'); await tp.waitForTimeout(800); const after = await tp.evaluate(() => !document.getElementById('pvBack').getAttribute('src') || !document.getElementById('app').classList.contains('pv-det'));
      await tp.evaluate(() => Setup.open({ page: 'shelf' })); await tp.waitForTimeout(1800);
      const row = await tp.evaluate(() => ((document.querySelector('.bss-scroll') || {}).innerText || '').includes('Video previews'));
      check('Thor: previews start off; switched on, a video beside the game plays behind the case in Details (copied into the app once), never behind the moving shelf; Settings → Shelf & museum has them',
        first === 'off' && !onShelf && det && /Pikmin%20\(USA\)\.mp4|Pikmin \(USA\)\.mp4/.test(decodeURIComponent(copied)) && after && row, JSON.stringify({ first, onShelf, det, copied: copied.slice(-60), after, row }));
      // (beta.9) Ports & custom APKs: an app switched on in Settings moves to a Custom shelf of its own, off the Apps shelf
      await tp.evaluate(() => window.Settings && Settings.close && Settings.close()); await tp.waitForTimeout(1200);
      await tp.evaluate(() => Setup.open({ page: 'android-ports' })); let prow = null;
      for (let w = 0; w < 25 && !prow; w++) { await tp.waitForTimeout(300); prow = await tp.evaluate(() => { const n = [...document.querySelectorAll('.bss-scroll .bss-row .nm')].map(e => e.textContent).find(x => x && !/Looking for your apps|No apps found/.test(x)); return n || null; }); }
      if (prow) await tp.evaluate(name => { const r = [...document.querySelectorAll('.bss-scroll .bss-row')].find(e => (e.querySelector('.nm') ? e.querySelector('.nm').textContent : e.textContent.trim().split('\n')[0]) === name); r && r.click(); }, prow);
      await tp.waitForTimeout(1500); await tp.evaluate(() => window.Settings && Settings.close && Settings.close());
      let sh = null; for (let w = 0; w < 30; w++) { await tp.waitForTimeout(500); sh = await tp.evaluate(() => Shelf._lib.shelves().map(s => ({ id: s.id, ids: s.ids }))); if (sh.some(s => s.id === 'custom')) break; }
      const cust = (sh || []).find(s => s.id === 'custom'), appsSh = (sh || []).find(s => s.id === 'media');
      const lib = await tp.evaluate(async () => (await window.boxshelf.cachedLibrary()).filter(s => s.id === 'custom' || s.id === 'media').map(s => ({ id: s.id, titles: s.games.map(g => g.title) })));
      const portTitles = ((lib.find(s => s.id === 'custom') || {}).titles) || [], appTitles = ((lib.find(s => s.id === 'media') || {}).titles) || [];
      check('Thor: Ports & custom APKs: an app switched on gets a Custom shelf of its own and leaves the Apps shelf',
        !!prow && portTitles.includes(prow) && !appTitles.includes(prow) && !!cust, JSON.stringify({ prow, portTitles, appTitles: appTitles.slice(0, 5), shelves: (sh || []).map(s => s.id) }));
      check('Thor previews: no page errors', !terr.length, terr.slice(0, 3).join(' | '));
    } catch (e) { check('Thor previews ran to the end', false, e.message.split('\n')[0]); }
    await tctx.close(); }
};
