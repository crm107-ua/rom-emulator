// (beta.11) Magazine downloads: a connection that crawls is dropped and picked up again from where it got to (byte ranges),
// and the whole file arrives intact; a small file is never dropped for being slow. Plain Node, a local server plays
// archive.org's storage server: its first connection trickles, later ones are fast.
// node android-app/ci/archive-speed-test.js  → exits 1 on a failure
'use strict';
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..', '..');
const archive = require(path.join(root, 'main', 'archive.js'));
let bad = 0; const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' ' + info}`); if (!ok) bad++; };

const SIZE = 24 * 1048576, data = crypto.randomBytes(SIZE), small = data.subarray(0, 3 * 1048576);
let conns = 0; const ranges = [];
const srv = http.createServer((q, s) => {
  const body = q.url.startsWith('/small') ? small : data, m = /bytes=(\d+)-/.exec(q.headers.range || ''), from = m ? +m[1] : 0;
  conns++; ranges.push(from); const first = conns === 1 || q.url.startsWith('/small');
  s.writeHead(m ? 206 : 200, { 'content-length': body.length - from, 'accept-ranges': 'bytes', ...(m ? { 'content-range': `bytes ${from}-${body.length - 1}/${body.length}` } : {}) });
  let i = from; const step = () => { if (i >= body.length || s.destroyed) return s.end(); const n = first ? 16384 : 1048576; s.write(body.subarray(i, i + n)); i += n; setTimeout(step, first ? 40 : 1); }; step();
});
srv.listen(0, async () => {
  const port = srv.address().port, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-arch-'));
  archive._setNet({ fetch: (u, o) => fetch(u, o) }); archive._setSlow(1 * 1048576, 1500); archive._setRetry(1);
  try {
    // a 24 MB file whose first connection trickles at ~0.4 MB/s
    const dest = path.join(dir, 'big.pdf'), t0 = Date.now(); let last = 0;
    const r = await archive._fetchRetry(`http://localhost:${port}/big.pdf`, dest, n => { last = n; }, SIZE, null);
    const ok = r.ok && fs.existsSync(dest) && crypto.createHash('sha1').update(fs.readFileSync(dest)).digest('hex') === crypto.createHash('sha1').update(data).digest('hex');
    check('a crawling connection is dropped and the download carries on from where it got to (byte range), whole and intact', ok && conns >= 2 && ranges[1] > 0, JSON.stringify({ r, conns, ranges: ranges.map(x => Math.round(x / 1024) + ' KB'), s: (Date.now() - t0) / 1000 }));
    check('progress counts up to the whole file', last === SIZE, String(last));
    // a small file (under 20 MB) is never dropped for being slow
    conns = 0; ranges.length = 0; const d2 = path.join(dir, 'small.pdf');
    const r2 = await archive._fetchRetry(`http://localhost:${port}/small.pdf`, d2, null, small.length, null);
    check('a small file downloads on its one connection, however slow', r2.ok && conns === 1 && fs.statSync(d2).size === small.length, JSON.stringify({ r2, conns }));
  } catch (e) { check('ran to the end', false, e.stack); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); srv.close(); }
  console.log(bad ? `archive-speed-test: ${bad} FAILED` : 'archive-speed-test: all passed'); process.exit(bad ? 1 : 0);
});
