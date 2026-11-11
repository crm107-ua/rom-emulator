// (beta.12) A pretend RomM server (RomM 5.4-style API) for the tests: four platforms (NES, SNES, GameCube and one
// Boxshelf has no shelf for), 30 ROMs (one made of several files, sent as a zip), the device-flow pairing (approved
// after two polls, with one slow_down first), the 8-digit code exchange, covers (tiny PNGs), downloads with Range,
// updated_after and rom_id_index, and switches to go offline, hang, or send corrupted bytes.
// const fake = await require('./fake-romm').start(); ... fake.state.log, fake.state.touch(id), await fake.stop()
'use strict';
const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf);
  let c = ~0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
  return ~c >>> 0;
}

// Deterministic bytes for a ROM.
function bytesFor(seed, size) {
  const b = Buffer.alloc(size);
  let x = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < size; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; b[i] = x & 0xff; }
  return b;
}

// A plain zip: the first entry stored, the rest deflated.
function makeZip(entries) {
  const locals = [], centrals = [];
  let off = 0;
  entries.forEach((e, i) => {
    const name = Buffer.from(e.name, 'utf8');
    const method = i === 0 ? 0 : 8;
    const data = method ? zlib.deflateRawSync(e.data) : e.data;
    const crc = crc32(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(off, 42);
    locals.push(lh, name, data);
    centrals.push(ch, name);
    off += 30 + name.length + data.length;
  });
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

const hashes = (buf, which) => ({
  crc_hash: which.includes('crc') ? crc32(buf).toString(16).padStart(8, '0') : '',
  md5_hash: which.includes('md5') ? crypto.createHash('md5').update(buf).digest('hex') : '',
  sha1_hash: which.includes('sha1') ? crypto.createHash('sha1').update(buf).digest('hex') : ''
});

function build(state) {
  const plats = [
    { id: 1, slug: 'nes', fs_slug: 'nes', name: 'Nintendo Entertainment System', ext: 'nes', n: 12 },
    { id: 2, slug: 'snes', fs_slug: 'snes', name: 'Super Nintendo Entertainment System', ext: 'sfc', n: 10 },
    { id: 3, slug: 'ngc', fs_slug: 'gc', name: 'Nintendo GameCube', ext: 'rvz', n: 6 },
    { id: 4, slug: 'philips-cd-i', fs_slug: 'cdi', name: 'Philips CD-i', ext: 'chd', n: 2 }
  ];
  state.platforms = plats.map(({ id, slug, fs_slug, name }) => ({ id, slug, fs_slug, name, display_name: name, custom_name: null, igdb_id: null, ss_id: null, ra_id: null, launchbox_id: null }));
  let id = 0;
  for (const p of plats) {
    for (let i = 1; i <= p.n; i++) {
      id++;
      const multi = p.id === 3 && i === p.n;
      const title = `${p.fs_slug.toUpperCase()} Game ${i}`;
      const rom = {
        id, platform_id: p.id, name: title, summary: `The story of ${title}.`, regions: ['USA'],
        metadatum: { genres: ['Action'], first_release_date: 631152000000 + id * 86400000 },
        url_cover: null, updated_at: new Date(state.clock).toISOString(), missing_from_fs: false
      };
      if (multi) {
        rom.fs_name = `${title} (USA)`;
        const cue = Buffer.from(`FILE "${title} (USA).bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n`);
        const bin = bytesFor(id, 150000);
        rom.parts = [{ name: `${title} (USA).cue`, data: cue }, { name: `${title} (USA).bin`, data: bin }];
        rom.files = rom.parts.map(f => ({ file_name: f.name, file_size_bytes: f.data.length, ...hashes(f.data, ['crc', 'md5', 'sha1']) }));
        rom.has_multiple_files = true;
        rom.zip = makeZip(rom.parts);
        rom.fs_size_bytes = cue.length + bin.length;
      } else {
        rom.fs_name = `${title} (USA).${p.ext}`;
        const size = id === 5 ? 3 * 1024 * 1024 : 40000 + id * 997;
        rom.data = bytesFor(id, size);
        const which = id === 3 ? ['crc'] : id === 4 ? ['md5'] : ['crc', 'md5', 'sha1'];
        rom.files = [{ file_name: rom.fs_name, file_size_bytes: size, ...hashes(rom.data, which) }];
        rom.has_multiple_files = false;
        rom.fs_size_bytes = size;
      }
      if (id % 5 !== 0) {
        const p2 = `roms/${p.id}/${id}/cover/big.png`;
        rom.path_cover_large = id % 2 ? `/assets/romm/resources/${p2}` : p2;
        rom.path_cover_small = rom.path_cover_large.replace('big', 'small');
      } else { rom.path_cover_large = ''; rom.path_cover_small = ''; }
      state.roms.set(id, rom);
    }
  }
}

function publicRom(r) {
  const { data, zip, parts, ...rest } = r;
  return { ...rest, fs_name_no_ext: r.fs_name.replace(/\.[a-z0-9]+$/i, ''), fs_extension: r.has_multiple_files ? '' : r.fs_name.split('.').pop() };
}

function start(opts = {}) {
  const state = {
    log: [], offline: false, hang: false, deny: false, corrupt: new Set(), chunkDelay: 0, interval: 5,
    tokens: new Set(), devices: new Map(), clock: Date.parse('2026-01-01T00:00:00.000Z'), roms: new Map(), platforms: [],
    touch(id, fields = {}) { const r = state.roms.get(id); state.clock += 60000; Object.assign(r, fields, { updated_at: new Date(state.clock).toISOString() }); return r; },
    remove(id) { state.roms.delete(id); },
    add(rom) { state.clock += 60000; const id = Math.max(...state.roms.keys()) + 1; const data = bytesFor(id, 30000); const r = { id, has_multiple_files: false, regions: [], metadatum: {}, missing_from_fs: false, path_cover_large: '', path_cover_small: '', url_cover: null, data, fs_size_bytes: data.length, ...rom, updated_at: new Date(state.clock).toISOString() }; r.files = [{ file_name: r.fs_name, file_size_bytes: data.length, ...hashes(data, ['crc', 'md5', 'sha1']) }]; state.roms.set(id, r); return r; },
    requests(pathPrefix) { return state.log.filter(l => l.path.startsWith(pathPrefix)); }
  };
  build(state);
  let devN = 0;

  const send = (res, code, obj, headers = {}) => {
    const body = Buffer.from(JSON.stringify(obj));
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': body.length, ...headers });
    res.end(body);
  };
  const authed = req => { const m = /^Bearer\s+(\S+)/.exec(req.headers.authorization || ''); return !!m && state.tokens.has(m[1]); };
  const readBody = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => { try { r(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch { r({}); } }); });

  async function stream(req, res, buf) {
    const total = buf.length;
    let start = 0, end = total - 1, code = 200;
    const range = req.headers.range;
    const head = { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes' };
    if (range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!m || +m[1] >= total) { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); return res.end(); }
      start = +m[1]; end = m[2] ? Math.min(+m[2], total - 1) : total - 1; code = 206;
      head['Content-Range'] = `bytes ${start}-${end}/${total}`;
    }
    head['Content-Length'] = end - start + 1;
    res.writeHead(code, head);
    if (req.method === 'HEAD') return res.end();
    for (let p = start; p <= end; p += 65536) {
      if (res.destroyed) return;
      res.write(buf.subarray(p, Math.min(end + 1, p + 65536)));
      if (state.chunkDelay) await new Promise(r => setTimeout(r, state.chunkDelay));
    }
    res.end();
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const entry = { t: Date.now(), method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), range: req.headers.range || null, auth: authed(req) };
    state.log.push(entry);
    if (state.offline) { req.socket.destroy(); return; }
    if (state.hang) return;
    const p = u.pathname;
    try {
      if (p === '/api/heartbeat') return send(res, 200, { SYSTEM: { VERSION: '5.4.1', SHOW_SETUP_WIZARD: false } });
      if (p === '/api/auth/device/init' && req.method === 'POST') {
        const b = await readBody(req);
        if (!b.client_device_identifier) return send(res, 422, { detail: 'client_device_identifier required' });
        const code = 'dev-' + (++devN);
        state.devices.set(code, { polls: 0, body: b });
        return send(res, 200, { device_code: code, user_code: 'WDJB-MJHT', verification_uri: '/pair', verification_path_complete: '/pair?user_code=WDJB-MJHT', expires_in: 600, interval: state.interval });
      }
      if (p === '/api/auth/device/token' && req.method === 'POST') {
        const b = await readBody(req);
        const d = state.devices.get(b.device_code);
        if (!d) return send(res, 400, { error: 'expired_token' });
        d.polls++;
        entry.poll = d.polls;
        if (state.deny) return send(res, 400, { error: 'access_denied' });
        if (d.polls === 1) return send(res, 400, { error: 'slow_down' });
        if (d.polls === 2) return send(res, 400, { detail: 'authorization_pending' });
        const tok = 'rmm_' + crypto.randomBytes(16).toString('hex');
        state.tokens.add(tok);
        state.devices.delete(b.device_code);
        return send(res, 200, { access_token: tok, token_type: 'bearer', device_id: 'd1', scopes: ['roms.read', 'platforms.read'], expires_at: null });
      }
      if (p === '/api/client-tokens/exchange' && req.method === 'POST') {
        const b = await readBody(req);
        if (String(b.code) !== '12345678') return send(res, 400, { detail: 'Invalid or expired code' });
        const tok = 'rmm_' + crypto.randomBytes(16).toString('hex');
        state.tokens.add(tok);
        return send(res, 200, { id: 7, name: 'Boxshelf', raw_token: tok, scopes: ['roms.read'] });
      }
      let m;
      if ((m = /^\/assets\/romm\/resources\/roms\/(\d+)\/(\d+)\/cover\/(big|small)\.png$/.exec(p))) {
        if (!state.roms.has(+m[2])) return send(res, 404, { detail: 'Not found' });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length });
        return res.end(PNG);
      }
      if (!p.startsWith('/api/')) return send(res, 404, { detail: 'Not found' });
      if (!authed(req)) return send(res, 401, { detail: 'Not authenticated' });
      if (p === '/api/platforms') {
        return send(res, 200, state.platforms.map(pl => ({ ...pl, rom_count: [...state.roms.values()].filter(r => r.platform_id === pl.id).length })));
      }
      if (p === '/api/roms') {
        const q = u.searchParams;
        let list = [...state.roms.values()];
        if (q.get('platform_ids')) { const ids = q.get('platform_ids').split(',').map(Number); list = list.filter(r => ids.includes(r.platform_id)); }
        if (q.get('updated_after')) { const t = Date.parse(q.get('updated_after')); list = list.filter(r => Date.parse(r.updated_at) > t); }
        list.sort((a, b) => a.name.localeCompare(b.name));
        const limit = Math.min(+q.get('limit') || 50, 10000), offset = +q.get('offset') || 0;
        const items = list.slice(offset, offset + limit).map(publicRom);
        entry.items = items.length;
        const body = { items, limit, offset };
        if (q.get('with_total') === 'true') body.total = list.length;
        if (q.get('with_rom_id_index') === 'true') body.rom_id_index = list.map(r => r.id);
        return send(res, 200, body);
      }
      if ((m = /^\/api\/roms\/(\d+)\/content\/(.+)$/.exec(p)) && (req.method === 'GET' || req.method === 'HEAD')) {
        const r = state.roms.get(+m[1]);
        if (!r || decodeURIComponent(m[2]) !== r.fs_name) return send(res, 404, { detail: 'Not found' });
        let buf = r.has_multiple_files ? r.zip : r.data;
        if (state.corrupt.has(r.id)) {
          if (r.has_multiple_files) buf = makeZip(r.parts.map((f, i) => (i === 1 ? { name: f.name, data: Buffer.concat([f.data.subarray(0, 100), Buffer.from([f.data[100] ^ 0xff]), f.data.subarray(101)]) } : f)));
          else { buf = Buffer.from(buf); buf[buf.length >> 1] ^= 0xff; }
        }
        return stream(req, res, buf);
      }
      return send(res, 404, { detail: 'Not found' });
    } catch (e) { if (!res.headersSent) send(res, 500, { detail: String(e.message) }); else res.destroy(); }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(opts.port || 0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      const stop = () => new Promise(r => { state.hang = false; if (server.closeAllConnections) server.closeAllConnections(); server.close(() => r()); });
      resolve({ url, stop, state });
    });
  });
}

module.exports = { start, makeZip, crc32 };
