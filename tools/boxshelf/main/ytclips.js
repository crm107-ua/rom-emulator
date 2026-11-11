// (beta.8) Console trailers: a short clip of a game's YouTube trailer, saved as a file so it plays like a Steam clip (behind
// the shelf and behind the case in Details), the way Playnite's trailer add-on does it.
//   - The helper is yt-dlp (free, Unlicense), fetched once into data\tools when you switch Console trailers on, and
//     checked against the SHA-256 list yt-dlp publishes with every release. It only finds the video's 720p (else 480p) stream.
//   - The clip: YouTube serves that stream as fragmented MP4 with an index (sidx) of its fragments. Boxshelf reads the
//     index, fetches only the bytes of the first ~20 seconds, and joins the header and those fragments into one small
//     silent MP4, exactly the shape of the Steam clips (no video converter needed).
//   - Kept in data\previews\youtube\<video id>.hd.mp4 (beta.9; <id>.mp4 = an older 480p one); the Steam and YouTube clips share one 400 MB limit (previews.trim).
//     A video with no usable stream is asked again after three days. One clip is made at a time.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');

let log = () => {}, dataDir = '';
function init(o) { log = o.log || log; dataDir = o.dataDir || ''; }
let force = false; // (the device test runs the clip flow on Linux with a pretend helper)
// (beta.11) Linux too (the Steam Deck): yt-dlp's own standalone Linux build (x64, or the ARM one), kept as data/tools/yt-dlp
const WIN = process.platform === 'win32', LINUX = process.platform === 'linux' && (process.arch === 'x64' || process.arch === 'arm64');
const ASSET = WIN ? 'yt-dlp.exe' : process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
const supported = () => force || WIN || LINUX;
const helperPath = () => path.join(dataDir, 'tools', WIN ? 'yt-dlp.exe' : 'yt-dlp');
const clipDir = () => path.join(dataDir, 'previews', 'youtube');
const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const okId = id => /^[\w-]{6,20}$/.test(String(id || ''));
const SECONDS = 20, MAX_BYTES = 12 << 20;
const HELPER_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';

// ---------- downloads ----------
// one HTTPS request, redirects followed; to a Buffer (cap bytes) or, with dest, to a file (onPct 0-100)
function fetch(url, o = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(url); if (u.protocol !== 'https:') return reject(new Error('not https'));
    const req = https.get(u, { headers: { 'User-Agent': 'Boxshelf', ...(o.headers || {}) } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 6) { res.resume(); return resolve(fetch(new URL(res.headers.location, url).toString(), o, hops + 1)); }
      if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const total = +res.headers['content-length'] || 0; let got = 0, last = -1;
      if (o.dest) { // (pipeline: an error on either side closes both and the part file goes)
        res.on('data', c => { got += c.length; const p = total ? Math.floor(got / total * 100) : 0; if (o.onPct && p !== last) { last = p; o.onPct(p); } });
        require('stream').pipeline(res, fs.createWriteStream(o.dest), e => { if (e) { try { fs.unlinkSync(o.dest); } catch {} reject(e); } else resolve(got); }); return;
      }
      const parts = []; res.on('data', c => { got += c.length; if (got > (o.cap || MAX_BYTES)) { req.destroy(new Error('too big')); return; } parts.push(c); });
      res.on('end', () => resolve(Buffer.concat(parts))); res.on('error', reject);
    });
    req.on('error', reject); req.setTimeout(o.timeout || 30000, () => req.destroy(new Error('timed out')));
  });
}

// ---------- the helper ----------
let helperFlight = null;
function helperState() { const f = helperPath(); try { const s = fs.statSync(f); return { have: s.size > 1e6, at: s.mtimeMs }; } catch { return { have: false, at: 0 }; } }
// fetches yt-dlp.exe once; true when it's there and its checksum matched
function getHelper(onPct) {
  if (!supported()) return Promise.resolve(false);
  if (helperState().have) return Promise.resolve(true);
  if (helperFlight) return helperFlight;
  helperFlight = (async () => {
    const f = helperPath(), part = f + '.part'; fs.mkdirSync(path.dirname(f), { recursive: true });
    const sums = (await fetch(HELPER_URL + 'SHA2-256SUMS', { cap: 1 << 20 })).toString('utf8');
    const re = new RegExp('^([a-f0-9]{64})\\s+\\*?' + ASSET.replace(/[.]/g, '\\.') + '\\s*$', 'mi');
    const want = ((re.exec(sums) || [])[1] || '').toLowerCase(); if (!want) throw new Error('no checksum for ' + ASSET);
    await fetch(HELPER_URL + ASSET, { dest: part, onPct, timeout: 60000 });
    const got = await new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(part).on('data', c => h.update(c)).on('end', () => res(h.digest('hex'))).on('error', rej); }); // (streamed: main never blocks on 25 MB)
    if (got !== want) { try { fs.unlinkSync(part); } catch {} throw new Error('checksum did not match'); }
    if (!WIN) fs.chmodSync(part, 0o755); // (Linux: a program has to be marked runnable)
    fs.renameSync(part, f); log('Console trailers: helper ready', Math.round(fs.statSync(f).size / 1e6) + ' MB'); return true;
  })().catch(e => { log('Console trailers: helper download failed:', e.message); return false; }).finally(() => { helperFlight = null; });
  return helperFlight;
}
// runs the helper (tests swap this for a pretend one)
// Every run ignores yt-dlp config files the user may have (their cookies, proxy or sorting must not change this). No JS
// runtime is offered on purpose: with one, YouTube hands out streams that refuse ranged downloads (HTTP 403; tested
// 2026-11-06). A run that times out
// is ended with its whole process tree (yt-dlp.exe starts a child of its own), so nothing is left running.
// (Linux: started in a process group of its own, which is ended as a whole, as taskkill /T does on Windows)
let run = (args, timeout) => new Promise((resolve, reject) => {
  const p = execFile(helperPath(), ['--ignore-config', ...args], { windowsHide: true, maxBuffer: 32 << 20, detached: !WIN }, (e, out, err) => { clearTimeout(t); e ? reject(new Error(timedOut ? 'timed out' : String(err || e.message).trim().split('\n').pop().slice(0, 200))) : resolve(String(out)); });
  let timedOut = false; const t = setTimeout(() => { timedOut = true;
    if (WIN) { try { execFile('taskkill', ['/T', '/F', '/PID', String(p.pid)], { windowsHide: true }, () => {}); } catch {} }
    else { try { process.kill(-p.pid, 'SIGKILL'); } catch {} }
    try { p.kill('SIGKILL'); } catch {} }, timeout);
});
// the trailer's 720p (else 480p or smaller) H.264 video stream: { url, headers }. (beta.9: 720p first; YouTube's 480p is
// so compressed that it looked soft stretched behind the shelf, about a quarter of a Steam clip's data per second)
// (beta.12) audio: the trailer's AAC sound stream (140, else 139, else any m4a), fetched the same way for the same stretch
const VIDEO_FMT = ['136', '135', '134', '133', 'bv*[ext=mp4][vcodec^=avc1][height<=720]'], AUDIO_FMT = ['140', '139', 'ba[ext=m4a][acodec^=mp4a]'];
async function streamOf(id, audio) {
  const fmt = (audio ? AUDIO_FMT : VIDEO_FMT).map(f => f + '[protocol=https]').join('/');
  const j = JSON.parse(await run(['--no-warnings', '--no-playlist', '--quiet', '-f', fmt, '-j', '--', 'https://www.youtube.com/watch?v=' + id], 45000));
  if (!j || !j.url || !/^https:\/\/[a-z0-9.-]+\.(googlevideo|youtube)\.com\//i.test(j.url)) throw new Error('no usable stream');
  const h = {}; for (const [k, v] of Object.entries(j.http_headers || {})) if (/^(user-agent|accept|accept-language|origin|referer)$/i.test(k)) h[k] = String(v);
  return { url: j.url, headers: h };
}

// ---------- the clip ----------
// the top-level MP4 boxes in a buffer: [{ type, start, size, head }] (stops at a box that runs past the end)
function boxes(buf) {
  const out = []; let at = 0;
  while (at + 8 <= buf.length) {
    let size = buf.readUInt32BE(at), head = 8; const type = buf.toString('latin1', at + 4, at + 8);
    if (size === 1) { if (at + 16 > buf.length) break; size = Number(buf.readBigUInt64BE(at + 8)); head = 16; }
    if (size < head) break; out.push({ type, start: at, size, head }); at += size; // (size 0, "to the end", stops here too)
  }
  return out;
}
// the fragment index: where the fragments start and how long / big each one is (null for a nested index)
function sidx(buf, box) {
  const h = box.head || 8, b = buf.subarray(box.start, box.start + box.size); if (b.length < h + 24) return null;
  const ver = b[h]; let p = h + 4; const timescale = b.readUInt32BE(p + 4); p += 8;
  let firstOffset; if (ver === 0) { firstOffset = b.readUInt32BE(p + 4); p += 8; } else { firstOffset = Number(b.readBigUInt64BE(p + 8)); p += 16; }
  p += 2; const n = b.readUInt16BE(p); p += 2; const refs = [];
  for (let i = 0; i < n && p + 12 <= b.length; i++, p += 12) { const r = b.readUInt32BE(p); if (r >>> 31) return null; refs.push({ size: r & 0x7fffffff, dur: b.readUInt32BE(p + 4) / (timescale || 1) }); }
  return { first: box.start + box.size + firstOffset, refs };
}
// from the stream's first bytes: the header to keep (everything before the index) and the byte range of ~20 s of fragments
function plan(head, seconds = SECONDS) {
  const bs = boxes(head), ix = bs.find(b => b.type === 'sidx'), moov = bs.find(b => b.type === 'moov');
  if (!ix || !moov || moov.start > ix.start || ix.start + ix.size > head.length) return null;
  const s = sidx(head, ix); if (!s || !s.refs.length) return null;
  let end = s.first, t = 0; for (const r of s.refs) { if (t >= seconds || end - s.first + r.size > MAX_BYTES) break; end += r.size; t += r.dur; }
  if (end === s.first) return null;
  return { headEnd: ix.start, from: s.first, to: end, seconds: Math.round(t) };
}
const ranged = (url, a, b) => url + (url.includes('?') ? '&' : '?') + 'range=' + a + '-' + b;

// ---------- the queue ----------
// One clip is made at a time, newest ask first: the game you're resting on now goes ahead of ones you browsed past. At
// most 3 wait (older ones are dropped), and a job whose game wasn't asked for in the last 30 s is skipped.
// Failures: a video that's gone (removed, private, age-restricted) is asked again after 3 days (.none); any other failure
// waits 10 minutes for that video; no connection pauses all clips for 2 minutes; six failures in a row pause them for 30.
// Three non-network failures in a row: YouTube changed something, so the helper updates itself (between jobs, at most
// once a session and only if it's over a week old).
// (beta.11) Two at a time, so the game you're on starts at once even while a clip for one you passed is still being
// made. Asks marked low (the games either side, made ahead: preview:warm) wait behind every other ask, run only while
// nothing else does, and are the first dropped when too many wait.
const QMAX = 5, FRESH = 30e3, MAXRUN = 2;
const flights = new Map(), q = [], asked = new Map(), failAt = new Map();
let running = 0, fails = 0, updated = false, wantUpdate = false, pausedTill = 0;
const GONE = /video unavailable|this video is not available|private video|been removed|copyright|confirm your age|members[- ]only|no 480p stream|no usable stream|no fragment index/i;
const OFFLINE = /unable to download|getaddrinfo|ENOTFOUND|ENETUNREACH|ECONNRESET|ECONNREFUSED|EAI_AGAIN|timed out|socket hang up|HTTP 5\d\d/i;
function pump() {
  if (wantUpdate) { if (running) return; wantUpdate = false; running++; run(['-U'], 120000).then(() => log('Console trailers: helper updated')).catch(e => log('Console trailers: helper update failed:', e.message)).finally(() => { running--; pump(); }); return; }
  while (q.length && running < MAXRUN) {
    let i = -1; for (let k = q.length - 1; k >= 0; k--) if (!q[k].low) { i = k; break; }
    if (i < 0) { if (running) return; i = q.length - 1; }
    const job = q.splice(i, 1)[0]; running++; job.run().finally(() => { running--; pump(); });
  }
}
// (beta.9) clips are kept as <id>.hd.mp4 (made from the 720p stream). A 480p one kept from before (<id>.mp4) still plays
// at once (cached) while the 720p one is made in the background, and is removed the next time after that
const hdOf = id => path.join(clipDir(), id + '.hd.mp4'), oldOf = id => path.join(clipDir(), id + '.mp4');
// the clip for one YouTube video: its file, or null (no helper, no usable stream, offline)
// (beta.11) o.low: made ahead for a game beside the one you're on (see the queue above)
function clip(id, o = {}) {
  if (!supported() || !okId(id)) return Promise.resolve(null);
  const out = hdOf(id), none = path.join(clipDir(), id + '.none'), now = Date.now();
  if (isFile(out)) { try { const t = new Date(); fs.utimesSync(out, t, t); } catch {} return Promise.resolve(out); }
  if (isFile(none)) { try { if (now - fs.statSync(none).mtimeMs < 3 * 864e5) return Promise.resolve(null); } catch {} }
  if (!helperState().have || now < pausedTill || now - (failAt.get(id) || 0) < 10 * 60e3) return Promise.resolve(null);
  asked.set(id, now); if (asked.size > 200) asked.delete(asked.keys().next().value);
  if (flights.has(id)) { if (!o.low) { const j = q.find(x => x.id === id); if (j) j.low = false; } return flights.get(id); }
  const p = new Promise(resolve => {
    q.push({ id, low: !!o.low, run: () => (Date.now() - (asked.get(id) || 0) > FRESH ? Promise.resolve(null) : make(id, out, none)).then(resolve, () => resolve(null)), drop: () => resolve(null) });
    while (q.length > QMAX) { const k = q.findIndex(x => x.low), k2 = k >= 0 ? k : Math.max(0, q.findIndex(x => !x.sound)); q.splice(k2, 1)[0].drop(); } /* (beta.12: the sound you just turned on isn't the one dropped) */
  });
  flights.set(id, p); p.finally(() => flights.delete(id)); pump(); return p;
}
async function make(id, out, none) {
  try {
    fs.mkdirSync(clipDir(), { recursive: true });
    const st = await streamOf(id);
    let head = await fetch(ranged(st.url, 0, 65535), { headers: st.headers, cap: 1 << 20 }), pl = plan(head);
    if (!pl) { head = await fetch(ranged(st.url, 0, 524287), { headers: st.headers, cap: 2 << 20 }); pl = plan(head); }
    if (!pl) throw new Error('no fragment index (or a nested one) in the first 512 KB');
    const frags = await fetch(ranged(st.url, pl.from, pl.to - 1), { headers: st.headers, cap: MAX_BYTES + (1 << 20), timeout: 60000 });
    if (frags.length !== pl.to - pl.from) throw new Error('short read ' + frags.length + ' of ' + (pl.to - pl.from));
    const tmp = out + '.part'; fs.writeFileSync(tmp, Buffer.concat([head.subarray(0, pl.headEnd), frags])); fs.renameSync(tmp, out);
    fails = 0; failAt.delete(id); require('./previews').trim(); log('Console trailers: clip kept for', id, pl.seconds + ' s', Math.round(fs.statSync(out).size / 1024) + ' KB');
    return out;
  } catch (e) {
    const m = String(e && e.message || e); log('Console trailers:', id, 'failed:', m);
    if (GONE.test(m)) { try { fs.writeFileSync(none, m.slice(0, 200)); } catch {} return null; }
    if (OFFLINE.test(m)) { pausedTill = Date.now() + 2 * 60e3; return null; } // (offline: nothing is marked, nothing counts)
    failAt.set(id, Date.now()); fails++;
    if (fails >= 6) { pausedTill = Date.now() + 30 * 60e3; fails = 0; log('Console trailers: paused for 30 minutes after repeated failures'); }
    else if (fails >= 3 && !updated && Date.now() - helperState().at > 7 * 864e5) { updated = true; wantUpdate = true; }
    return null;
  }
}
// (beta.12) the clip's sound, <id>.m4a beside it: the clip itself is video only (small and quick), and Details' box plays this
// in step with it when sound is turned on. The same first fragments as the video (a few seconds more, so it never runs out
// before the picture). Made the first time sound is turned on for it (not with every clip: most are never heard, and each
// fetch is one more helper run), then kept; null when it can't be had
// It waits in the clips' queue (one more helper run, counted with them), only the newest one asked for waits (a game you've
// moved on from isn't fetched), and one that failed isn't asked again for 10 minutes (offline: everything pauses, as clips do)
const audioOf = id => path.join(clipDir(), id + '.m4a'), aFlights = new Map(), aFailAt = new Map();
function audio(id) {
  if (!supported() || !okId(id)) return Promise.resolve(null);
  const out = audioOf(id); if (isFile(out)) return Promise.resolve(out);
  const now = Date.now();
  if (!helperState().have || now < pausedTill || now - (aFailAt.get(id) || 0) < 10 * 60e3) return Promise.resolve(null);
  if (aFlights.has(id)) return aFlights.get(id);
  for (let k = q.length - 1; k >= 0; k--) if (q[k].sound) { const j = q.splice(k, 1)[0]; j.drop(); }
  const p = new Promise(resolve => { q.push({ id, sound: true, low: false, run: () => makeAudio(id, out).then(resolve, () => resolve(null)), drop: () => resolve(null) }); pump(); });
  aFlights.set(id, p); p.finally(() => aFlights.delete(id)); return p;
}
function makeAudio(id, out) {
  return (async () => {
    fs.mkdirSync(clipDir(), { recursive: true });
    const st = await streamOf(id, true);
    let head = await fetch(ranged(st.url, 0, 65535), { headers: st.headers, cap: 1 << 20 }), pl = plan(head, SECONDS + 5);
    if (!pl) { head = await fetch(ranged(st.url, 0, 524287), { headers: st.headers, cap: 2 << 20 }); pl = plan(head, SECONDS + 5); }
    if (!pl) throw new Error('no fragment index in the sound stream');
    const frags = await fetch(ranged(st.url, pl.from, pl.to - 1), { headers: st.headers, cap: MAX_BYTES + (1 << 20), timeout: 60000 });
    if (frags.length !== pl.to - pl.from) throw new Error('short read ' + frags.length + ' of ' + (pl.to - pl.from));
    const tmp = out + '.part'; fs.writeFileSync(tmp, Buffer.concat([head.subarray(0, pl.headEnd), frags])); fs.renameSync(tmp, out);
    aFailAt.delete(id); log('Console trailers: sound kept for', id, pl.seconds + ' s', Math.round(fs.statSync(out).size / 1024) + ' KB'); return out;
  })().catch(e => { const m = String(e && e.message || e); log('Console trailers: sound for', id, 'failed:', m);
    if (OFFLINE.test(m)) pausedTill = Date.now() + 2 * 60e3; else aFailAt.set(id, Date.now()); return null; });
}
// the YouTube id of a kept clip file (<id>.hd.mp4 / <id>.mp4 in the clips folder), else null: the screen asks for a clip's
// sound by its file, and only Boxshelf's own clips have one to fetch
function idOfClip(f) { try { if (path.resolve(path.dirname(String(f))).toLowerCase() !== path.resolve(clipDir()).toLowerCase()) return null; } catch { return null; }
  const m = /^([\w-]{6,20})(\.hd)?\.mp4$/.exec(path.basename(String(f))); return m ? m[1] : null; }
// a kept clip (marked as just shown, so the 400 MB limit drops the ones not seen for longest)
// (a 480p one from before: shown now, its 720p one made in the background for next time. The 480p file is removed the
// next time the clip is asked for, once the 720p one is there: never while it may still be playing)
function cached(id) { if (!okId(id)) return null; let f = hdOf(id);
  if (isFile(f)) { const old = oldOf(id); if (isFile(old)) { try { fs.unlinkSync(old); } catch {} } }
  else { f = oldOf(id); if (!isFile(f)) return null; clip(id).catch(() => {}); }
  try { const t = new Date(); fs.utimesSync(f, t, t); } catch {} return f; }
// (beta.11) the trailer link is gone (.none: private, removed) for this video
function gone(id) { if (!okId(id)) return false; const none = path.join(clipDir(), id + '.none'); try { return Date.now() - fs.statSync(none).mtimeMs < 3 * 864e5; } catch { return false; } }
// (beta.11) a game with no trailer link, or a dead one: YouTube is searched with the helper for "<title> <console> trailer"
// and the best result taken: most of the title's words in its title, "trailer" in it, 20 s to 10 min long, not a review,
// gameplay or reaction video. Remembered per game in previews\youtube\search.json (a miss is asked again after a week);
// one search at a time.
const STOP = /^(the|of|and|a|an|for|edition|usa|europe|japan|en|fr|de|es|it|rev|v\d.*|disc|\d)$/;
const twords = s => String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 1 && !STOP.test(w));
const NOT_TRAILER = /\b(review|gameplay|walkthrough|let'?s play|longplay|speedrun|reaction|unboxing|tier list|ranking|top \d+|comparison|vs\.?|mod|soundtrack|ost|music|full game|part \d+|episode)\b/i;
let sMemo = null, sChain = Promise.resolve(); const sFlights = new Map();
const sFile = () => path.join(clipDir(), 'search.json');
function sLoad() { if (sMemo) return sMemo; try { sMemo = JSON.parse(fs.readFileSync(sFile(), 'utf8')) || {}; } catch { sMemo = {}; } return sMemo; }
function sSave() { try { fs.mkdirSync(clipDir(), { recursive: true }); const t = sFile() + '.tmp'; fs.writeFileSync(t, JSON.stringify(sMemo)); fs.renameSync(t, sFile()); } catch {} }
const sKey = (title, sys) => (String(sys || '') + '|' + twords(title).join(' ')).slice(0, 200);
// (beta.11) every result that fits is kept, best first ({ id, alts }): YouTube refuses a few videos to the helper (only
// preview pictures: "This video is not available") though they're public and show in the search, so a video that
// can't be clipped (.none) is passed over for the next one
const memoIds = e => [e.id, ...(Array.isArray(e.alts) ? e.alts : [])].filter(x => x && okId(x) && !gone(x));
// what's known: a video id, null (searched, nothing fit or none could be clipped: not asked again for a week) or
// undefined (search: never searched, or every video remembered has turned out to be gone since; an entry from before
// beta.11's list kept only one)
function searchKnown(title, sys) { const e = sLoad()[sKey(title, sys)]; if (!e) return undefined; const ids = memoIds(e); if (ids.length) return ids[0]; if (!e.id && Date.now() - (e.at || 0) < 7 * 864e5) return null; return undefined; }
// the results that fit, best first (at most 5; none that's known to be gone)
function rankResults(lines, title) {
  const want = twords(title); if (!want.length) return []; const got = [];
  for (const l of lines) { const [id, t = '', dur = ''] = l.split('\t'); if (!okId(id) || gone(id) || got.some(x => x.id === id)) continue; const d = +dur || 0;
    if (NOT_TRAILER.test(t) || (d && (d < 20 || d > 600))) continue;
    const tw = new Set(twords(t)), hit = want.filter(w => tw.has(w)).length / want.length; if (hit < .6) continue;
    got.push({ id, s: hit + (/\btrailer\b/i.test(t) ? .5 : 0) + (/\b(official|launch|reveal|announce)/i.test(t) ? .2 : 0) }); }
  return got.sort((a, b) => b.s - a.s).slice(0, 5).map(x => x.id);
}
const pickResult = (lines, title) => rankResults(lines, title)[0] || null;
// the videos to try for a game, best first: what's remembered, else a search ([] for nothing)
function searchList(title, sys, sysName) {
  if (!supported() || !helperState().have || !twords(title).length) return Promise.resolve([]);
  const k = sKey(title, sys), known = searchKnown(title, sys);
  if (known === null) return Promise.resolve([]); if (known !== undefined) return Promise.resolve(memoIds(sLoad()[k]));
  if (sFlights.has(k)) return sFlights.get(k);
  const p = sChain = sChain.then(async () => {
    try {
      const q = `${String(title).replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s+/g, ' ').trim()} ${sysName || ''} trailer`.slice(0, 150);
      const out = await run(['--no-warnings', '--flat-playlist', '--print', '%(id)s\t%(title)s\t%(duration)s', '--', 'ytsearch6:' + q], 30000);
      const ids = rankResults(out.split(/\r?\n/).filter(Boolean), title);
      sLoad()[k] = { id: ids[0] || null, alts: ids.slice(1), at: Date.now() }; sSave(); log('Console trailers: searched', JSON.stringify(q), '→', ids.join(', ') || 'nothing that fits'); return ids;
    } catch (e) { log('Console trailers: search failed:', String(e && e.message || e).slice(0, 160)); return []; }
  });
  sFlights.set(k, p); p.finally(() => sFlights.delete(k)); return p;
}
function search(title, sys, sysName) { return searchList(title, sys, sysName).then(l => l[0] || null); }
// (beta.11) a clip for a game from the search: the first of up to three results that can be clipped (the one that
// worked is remembered first). { id, file } or null; stops at a failure that isn't the video's (offline, moved on)
async function clipFromSearch(title, sys, sysName, o = {}) {
  const ids = await searchList(title, sys, sysName);
  for (const id of ids.slice(0, 3)) {
    const file = await clip(id, o);
    if (file) { const e = sLoad()[sKey(title, sys)]; if (e && e.id !== id) { e.alts = [e.id, ...(e.alts || [])].filter(x => x && x !== id); e.id = id; sSave(); } return { id, file }; }
    if (!gone(id)) return null;
    log('Console trailers:', id, 'cannot be clipped, trying the next result');
  }
  // every result tried was refused: none for a week (searchKnown's null), not a fresh search on every visit
  if (ids.length) { const e = sLoad()[sKey(title, sys)]; if (e && !memoIds(e).length) { sLoad()[sKey(title, sys)] = { id: null, alts: [], at: Date.now() }; sSave(); } }
  return null;
}
function size() { try { return fs.readdirSync(clipDir()).filter(n => /\.(mp4|m4a)$/i.test(n)).reduce((a, n) => { try { if (/\.mp4$/i.test(n)) a.n++; a.bytes += fs.statSync(path.join(clipDir(), n)).size; } catch {} return a; }, { n: 0, bytes: 0 }); } catch { return { n: 0, bytes: 0 }; } } /* (beta.12: the clips' sound files count in the size) */
function clear() { try { fs.rmSync(clipDir(), { recursive: true, force: true }); } catch {} }
function status() { const h = helperState(); return { supported: supported(), helper: h.have, getting: !!helperFlight, ...size() }; }

module.exports = { init, supported, status, helperState, getHelper, clip, cached, audio, idOfClip, clear, size, plan, boxes, sidx, gone, search, searchList, clipFromSearch, searchKnown, pickResult, rankResults, _setRun: f => { run = f; }, _fetch: f => { fetch = f; }, _force: v => { force = !!v; }, _reset: () => { failAt.clear(); asked.clear(); fails = 0; pausedTill = 0; updated = false; wantUpdate = false; sMemo = null; } };
