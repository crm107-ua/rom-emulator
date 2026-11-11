'use strict';
// (beta.12) RomM server client (Node, the main process: RomM's CORS rules block the page).
// - Sign-in: QR pairing with the device flow (RomM 5.0+, /api/auth/device/*), or an 8-digit code (RomM 4.8-4.9,
//   /api/client-tokens/exchange). The token only lives in memory here: the caller keeps it (encrypted) and hands it
//   back with setToken() on the next start.
// - Library: every platform RomM has that matches a Boxshelf console. Incremental: only ROMs updated after the last
//   sync are fetched (updated_after), deletions are found with a light id sweep, and a saved copy (romm-library.json
//   in dataDir) answers when the server can't be reached.
// - Covers: downloaded once into dataDir/romm-covers/<romId>.<ext> and never again.
// - Downloads: resumable (a .part file and a Range request), checked with RomM's size and hashes (sha1, else md5, else
//   crc32). A game made of several files arrives as a zip, which is unpacked and each file checked.
// Every request has a timeout (an AbortController); nothing here blocks the event loop for long: pages are fetched
// one after another with a pause between, files are hashed and unpacked as streams.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { once } = require('events');
const { Transform, Writable } = require('stream');
const { pipeline } = require('stream/promises');

let dataDir = null;
let log = () => {};
let fetchImpl = null;
let base = '';
let origin = '';
let skipTls = false;
let dispatcher = null;
let token = null;
let pair = null;
let cache = null;
let syncing = null;
let timeScale = 1;
let deviceId = null;
const active = new Map();
const badCovers = new Set();
const T = { api: 15000, page: 30000, cover: 20000, connect: 20000, idle: 30000 };
const PAGE = 1000;
const PAGE_PAUSE = 40;
const COVER_MAX_BYTES = 8 * 1024 * 1024;

const err = (code, msg) => Object.assign(new Error(msg || code), { code });
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
const num = v => (typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && /^\d+$/.test(v) ? +v : null));

// ---------- set-up
function init(opts = {}) {
  if (opts.dataDir) dataDir = opts.dataDir;
  if (typeof opts.log === 'function') log = opts.log;
  fetchImpl = typeof opts.fetch === 'function' ? opts.fetch : (fetchImpl || globalThis.fetch);
  return { ok: true };
}

// (beta.12) an address typed without http:// or https://: https, except a server on the home network (a private or
// loopback IP, localhost, a .local / .lan / .home name or a one-word name), which is usually plain http
function withScheme(u) {
  u = String(u || '').trim(); if (!u || /^https?:\/\//i.test(u)) return u;
  const host = u.replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  const home = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host) || host === 'localhost' || host === '::1' || /\.(local|lan|home|internal)$/.test(host) || !host.includes('.');
  return (home ? 'http://' : 'https://') + u;
}
// the origin a server address leads to ('' when there's none): RomM's sign-in token is only ever sent to the origin it was paired with
function originOf(url) { try { const u = withScheme(url); return u ? new URL(u).origin : ''; } catch { return ''; } }
function setServer(url, opts = {}) {
  let u = String(url || '').trim();
  if (!u) { base = ''; origin = ''; pair = null; cache = null; return { ok: true, url: '' }; }
  u = withScheme(u);
  let p;
  try { p = new URL(u); } catch { return { ok: false, error: 'bad-url' }; }
  const nb = p.origin + p.pathname.replace(/\/+$/, '').replace(/\/api$/i, '');
  if (nb !== base) { pair = null; cache = null; }
  base = nb;
  origin = p.origin;
  skipTls = !!opts.skipTlsVerify;
  dispatcher = null;
  return { ok: true, url: base };
}

// (beta.12) a pairing in progress is only dropped when the token really changes (Test, or a Settings save, used to end it)
function setToken(t) { const nt = t ? String(t).trim() : null; if (nt !== token) pair = null; token = nt; }

function status() { return { server: base, hasToken: !!token, pairing: !!pair, syncing: !!syncing, downloads: [...active.keys()] }; }

const cacheFile = () => (dataDir ? path.join(dataDir, 'romm-library.json') : null);
const coversDir = () => (dataDir ? path.join(dataDir, 'romm-covers') : null);

// ---------- requests
// "Skip certificate check" (a home server with its own certificate): Node's fetch takes an undici dispatcher; the
// undici Agent class is reached through the global dispatcher Node creates on its first fetch.
async function getDispatcher() {
  if (!skipTls || fetchImpl !== globalThis.fetch) return undefined;
  if (dispatcher) return dispatcher;
  const sym = Symbol.for('undici.globalDispatcher.1');
  if (!globalThis[sym]) { try { await globalThis.fetch('http://127.0.0.1:9/', { signal: AbortSignal.timeout(300) }); } catch { } }
  const g = globalThis[sym];
  if (g && typeof g.constructor === 'function') {
    try { dispatcher = new g.constructor({ connect: { rejectUnauthorized: false } }); } catch (e) { log('romm: no certificate skip: ' + e.message); }
  }
  return dispatcher || undefined;
}

const sameServer = url => !!origin && (url === origin || url.startsWith(origin + '/'));

function linkSignal(ctl, signal) {
  if (!signal) return () => {};
  if (signal.aborted) { ctl.abort(signal.reason); return () => {}; }
  const on = () => ctl.abort(signal.reason);
  signal.addEventListener('abort', on, { once: true });
  return () => signal.removeEventListener('abort', on);
}

function netError(e, signal) {
  if (signal && signal.aborted) return Object.assign(err('aborted', 'cancelled'), { name: 'AbortError' });
  if (e && e.code && /^(auth|not-found|hash-mismatch|no-space|http-\d+|offline|aborted|range)$/.test(e.code)) return e;
  if (e && e.code === 'ENOSPC') return err('no-space', 'the disk is full'); // (beta.12) a full disk isn't "RomM can't be reached"
  const why = (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || 'network';
  return err('offline', 'server not reachable: ' + why);
}

// One API call: JSON in and out (or the raw bytes with as:'buffer'). Throws {code:'offline'|'aborted'} on network
// trouble; an HTTP error comes back as {ok:false, status}.
async function call(p, o = {}) {
  if (!base) throw err('no-server');
  if (!fetchImpl) fetchImpl = globalThis.fetch;
  const url = /^https?:\/\//i.test(p) ? p : base + p;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(err('offline', 'timed out')), o.timeout || T.api);
  const unlink = linkSignal(ctl, o.signal);
  const headers = { Accept: o.as === 'buffer' ? '*/*' : 'application/json', ...(o.headers || {}) };
  if (o.auth !== false && token && sameServer(url)) headers.Authorization = 'Bearer ' + token;
  let body;
  if (o.json !== undefined) { body = JSON.stringify(o.json); headers['Content-Type'] = 'application/json'; }
  try {
    const res = await fetchImpl(url, { method: o.method || 'GET', headers, body, signal: ctl.signal, redirect: 'follow', dispatcher: await getDispatcher() });
    if (o.as === 'buffer') {
      const len = num(res.headers.get('content-length'));
      if (len && len > (o.maxBytes || Infinity)) { try { await res.body.cancel(); } catch { } return { status: res.status, ok: false, tooBig: true }; }
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, ok: res.ok, buf, headers: res.headers };
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { }
    return { status: res.status, ok: res.ok, json, headers: res.headers };
  } catch (e) { throw netError(e, o.signal); }
  finally { clearTimeout(timer); unlink(); }
}

// ---------- pairing
async function getDeviceId() {
  if (deviceId) return deviceId;
  const f = dataDir ? path.join(dataDir, 'romm-device.json') : null;
  if (f) { try { const o = JSON.parse(await fsp.readFile(f, 'utf8')); if (o && o.id) deviceId = String(o.id); } catch { } }
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    if (f) { try { await fsp.mkdir(dataDir, { recursive: true }); await fsp.writeFile(f, JSON.stringify({ id: deviceId })); } catch { } }
  }
  return deviceId;
}

function clientVersion() { try { return require('../package.json').version; } catch { return '0'; } }
function osName() { return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform; }

// The server's reason in an error answer: {"error":"slow_down"} (OAuth style) or {"detail":"slow_down"} (FastAPI).
function reasonOf(j) {
  if (!j || typeof j !== 'object') return '';
  const d = j.detail;
  return String(j.error || (d && typeof d === 'object' ? d.error || d.code || '' : d) || '').toLowerCase();
}

async function pairStart(opts = {}) {
  if (!base) return { ok: false, error: 'no-server' };
  let r;
  try {
    r = await call('/api/auth/device/init', {
      method: 'POST', auth: false, json: {
        client_device_identifier: await getDeviceId(), name: opts.name || 'Boxshelf', client: 'Boxshelf',
        platform: opts.platform || osName(), client_version: clientVersion(), requested_scopes: ['roms.read', 'platforms.read']
      }
    });
  } catch (e) { return { ok: false, error: e.code || 'offline' }; }
  if (r.status === 404 || r.status === 405) return { ok: false, error: 'unsupported', useCode: true };
  if (r.status === 429) return { ok: false, error: 'rate-limited' };
  const j = r.json || {};
  if (!r.ok || !j.device_code || !j.user_code) return { ok: false, error: 'http-' + r.status };
  const interval = Math.max(1, num(j.interval) || 5) * 1000;
  const now = Date.now();
  const vp = j.verification_path_complete || j.verification_uri_complete || j.verification_path || j.verification_uri || '';
  pair = { deviceCode: j.device_code, interval, nextAt: now + interval * timeScale, expiresAt: now + Math.max(30, num(j.expires_in) || 600) * 1000 };
  return { ok: true, userCode: j.user_code, qrUrl: /^https?:\/\//i.test(vp) ? vp : base + (vp.startsWith('/') ? vp : '/' + vp), expiresAt: pair.expiresAt, interval: interval / 1000 };
}

// One poll, never sooner than the server's interval (pending answers carry wait: ms until the next poll is due).
async function pairPoll() {
  const p = pair;
  if (!p) return { state: 'expired' };
  const now = Date.now();
  if (now >= p.expiresAt) { pair = null; return { state: 'expired' }; }
  if (now < p.nextAt) return { state: 'pending', wait: p.nextAt - now };
  let r;
  try { r = await call('/api/auth/device/token', { method: 'POST', auth: false, json: { device_code: p.deviceCode } }); }
  catch (e) { p.nextAt = Date.now() + p.interval * timeScale; return { state: 'pending', wait: p.interval * timeScale, error: e.code }; }
  if (pair !== p) return { state: 'expired' };
  const j = r.json || {};
  const tok = j.access_token || j.token || j.raw_token;
  if (r.ok && tok) {
    pair = null;
    token = String(tok);
    return { state: 'ok', token, expiresAt: j.expires_at || null, scopes: j.scopes || null, deviceId: j.device_id || null };
  }
  const why = reasonOf(j);
  if (why === 'slow_down' || r.status === 429) p.interval += 5000;
  if (why === 'access_denied') { pair = null; return { state: 'denied' }; }
  if (why === 'expired_token' || why === 'invalid_grant') { pair = null; return { state: 'expired' }; }
  p.nextAt = Date.now() + p.interval * timeScale;
  return { state: 'pending', wait: p.interval * timeScale };
}

// Polls until the pairing ends (or the signal stops it).
async function pairWait(opts = {}) {
  for (;;) {
    if (opts.signal && opts.signal.aborted) return { state: 'cancelled' };
    const r = await pairPoll();
    if (r.state !== 'pending') return r;
    await sleep(Math.min(r.wait || 1000, 60000));
  }
}

function pairCancel() { pair = null; }

async function pairWithCode(code) {
  if (!base) return { ok: false, error: 'no-server' };
  const c = String(code || '').replace(/[\s-]/g, '');
  if (!c) return { ok: false, error: 'bad-code' };
  let r;
  try { r = await call('/api/client-tokens/exchange', { method: 'POST', auth: false, json: { code: c } }); }
  catch (e) { return { ok: false, error: e.code || 'offline' }; }
  if (r.status === 404 || r.status === 405) return { ok: false, error: 'unsupported' };
  const j = r.json || {};
  const tok = typeof j === 'string' ? j : j.access_token || j.token || j.raw_token;
  if (!r.ok || !tok) return { ok: false, error: r.status === 429 ? 'rate-limited' : 'bad-code' };
  token = String(tok);
  return { ok: true, token };
}

// A cheap check: the server's version (no sign-in needed) and one signed-in call.
async function test() {
  if (!base) return { ok: false, error: 'no-server' };
  let version = null;
  try {
    const h = await call('/api/heartbeat', { auth: false });
    const j = h.json || {};
    version = (j.SYSTEM && j.SYSTEM.VERSION) || j.VERSION || j.version || null;
  } catch (e) { return { ok: false, error: e.code || 'offline' }; }
  if (!token) return { ok: false, version, error: 'no-token' };
  try {
    const r = await call('/api/platforms');
    if (r.status === 401 || r.status === 403) return { ok: false, version, error: 'auth' };
    if (!r.ok) return { ok: false, version, error: 'http-' + r.status };
    return { ok: true, version, platforms: Array.isArray(r.json) ? r.json.length : 0 };
  } catch (e) { return { ok: false, version, error: e.code || 'offline' }; }
}

// ---------- RomM platform -> Boxshelf console
// RomM's own slugs (IGDB-style) and the usual folder names. Anything not here is matched against the consoles' ROM
// folder names in systems.js; no match = skipped.
const SLUGS = {
  gc: ['ngc', 'gamecube', 'gc', 'gcn', 'nintendo-gamecube'],
  wii: ['wii'],
  wiiu: ['wiiu', 'wii-u'],
  sw: ['switch', 'nintendo-switch', 'nsw'],
  sw2: ['switch-2', 'switch2', 'nintendo-switch-2'],
  psp: ['psp', 'playstation-portable'],
  ps2: ['ps2', 'playstation-2'],
  ps3: ['ps3', 'playstation-3'],
  ps4: ['ps4', 'ps4--1', 'playstation-4'],
  ps5: ['ps5', 'playstation-5'],
  x360: ['xbox360', 'xbox-360', 'x360'],
  n3ds: ['3ds', 'n3ds', 'nintendo-3ds', 'new-nintendo-3ds'],
  psx: ['ps', 'psx', 'ps1', 'playstation', 'playstation-1'],
  nes: ['nes', 'famicom', 'fds', 'famicom-disk-system'],
  snes: ['snes', 'sfam', 'super-famicom', 'super-nintendo'],
  n64: ['n64', 'nintendo-64'],
  gb: ['gb', 'gameboy', 'game-boy'],
  gbc: ['gbc', 'gameboy-color', 'game-boy-color'],
  gba: ['gba', 'gameboy-advance', 'game-boy-advance'],
  nds: ['nds', 'nintendo-ds', 'nintendo-dsi', 'dsi'],
  megadrive: ['genesis-slash-megadrive', 'genesis', 'megadrive', 'mega-drive', 'md', 'sega-genesis'],
  mastersystem: ['sms', 'mastersystem', 'master-system', 'sega-master-system'],
  gamegear: ['gamegear', 'game-gear', 'gg', 'sega-game-gear'],
  dreamcast: ['dc', 'dreamcast', 'sega-dreamcast'],
  saturn: ['saturn', 'sega-saturn'],
  pcengine: ['turbografx16--1', 'turbografx-16-slash-pc-engine-cd', 'tg16', 'turbografx16', 'turbografx-16', 'pce', 'pcengine', 'pc-engine', 'pc-engine-cd', 'pcenginecd', 'tg-cd'],
  neogeo: ['neogeoaes', 'neogeomvs', 'neo-geo', 'neogeo', 'neo-geo-aes', 'neo-geo-mvs'],
  arcade: ['arcade', 'mame', 'fbneo', 'fba', 'cps1', 'cps2', 'cps3'],
  segacd: ['segacd', 'sega-cd', 'mega-cd', 'megacd', 'sega-cd-32x'],
  sega32x: ['sega32', 'sega32x', 'sega-32x', '32x'],
  atari2600: ['atari2600', 'atari-2600', 'a2600'],
  atarilynx: ['lynx', 'atari-lynx', 'atarilynx'],
  wonderswan: ['wonderswan', 'wonderswan-color', 'wonderswancolor', 'wsc', 'ws'],
  dos: ['dos', 'ms-dos', 'msdos', 'pc-dos']
};
let slugIndex = null;
let folderIndex = null;
const normSlug = s => String(s || '').toLowerCase().trim();
const normFolder = s => String(s || '').toLowerCase().replace(/[\s_\-.]+/g, '');

function mapSlug(p) {
  if (!slugIndex) { slugIndex = new Map(); for (const [id, list] of Object.entries(SLUGS)) for (const s of list) if (!slugIndex.has(s)) slugIndex.set(s, id); }
  if (!folderIndex) {
    folderIndex = new Map();
    try { for (const c of require('./systems').CONSOLES) for (const n of [c.id, ...(c.romFolderNames || [])]) { const k = normFolder(n); if (k && !folderIndex.has(k)) folderIndex.set(k, c.id); } } catch { }
  }
  if (!p) return null;
  const slug = normSlug(p.slug), fsSlug = normSlug(p.fs_slug);
  return slugIndex.get(slug) || slugIndex.get(fsSlug) || folderIndex.get(normFolder(slug)) || folderIndex.get(normFolder(fsSlug)) || null;
}

// ---------- library
const tsOf = s => { const t = Date.parse(s); return isFinite(t) ? t : 0; };

function coverUrlOf(it) {
  let p = it.path_cover_large || it.path_cover_small || '';
  if (p) {
    if (!/^https?:\/\//i.test(p)) {
      p = String(p).replace(/^\/+/, '');
      if (!/^assets\//i.test(p)) p = 'assets/romm/resources/' + p;
      p = base + '/' + p;
    }
    const ts = tsOf(it.updated_at);
    if (ts && !/[?&]ts=/.test(p)) p += (p.includes('?') ? '&' : '?') + 'ts=' + ts;
    return p;
  }
  const u = it.url_cover || '';
  return /^https?:\/\//i.test(u) ? u : (u.startsWith('//') ? 'https:' + u : null);
}

function dateOf(v) {
  let t = num(v);
  if (t == null && typeof v === 'string') t = Date.parse(v);
  if (!t || !isFinite(t)) return null;
  if (t < 1e11) t *= 1000;
  return new Date(t).toISOString().slice(0, 10);
}

function toGame(it, p, consoleId) {
  const md = it.metadatum || {};
  const files = (Array.isArray(it.files) ? it.files : []).map(f => ({
    name: f.file_name || f.name || '', size: num(f.file_size_bytes),
    crc: f.crc_hash || null, md5: f.md5_hash || null, sha1: f.sha1_hash || null
  }));
  const multi = typeof it.has_multiple_files === 'boolean' ? it.has_multiple_files : files.length > 1;
  if (!multi && !files.length) files.push({ name: it.fs_name, size: num(it.fs_size_bytes), crc: it.crc_hash || null, md5: it.md5_hash || null, sha1: it.sha1_hash || null });
  const title = it.name || String(it.fs_name_no_ext || it.fs_name || '').replace(/\.[a-z0-9]{1,5}$/i, '');
  return {
    id: 'romm-' + it.id, rommId: it.id, platformId: p.id, consoleId,
    title, file: it.fs_name, size: num(it.fs_size_bytes) || files.reduce((a, f) => a + (f.size || 0), 0) || null,
    files, multi, summary: it.summary || null,
    released: dateOf(md.first_release_date != null ? md.first_release_date : it.first_release_date),
    genres: Array.isArray(md.genres) ? md.genres : (Array.isArray(it.genres) ? it.genres : []),
    regions: Array.isArray(it.regions) ? it.regions : [],
    coverUrl: coverUrlOf(it), updatedAt: it.updated_at || null
  };
}

async function loadCache() {
  if (cache && cache.server === base) return cache;
  cache = null;
  const f = cacheFile();
  if (f) { try { const o = JSON.parse(await fsp.readFile(f, 'utf8')); if (o && o.v === 1 && o.server === base && o.games) cache = o; } catch { } }
  if (!cache) cache = { v: 1, server: base, at: null, platforms: {}, games: {}, skipped: null };
  return cache;
}

async function saveCache(c) {
  const f = cacheFile();
  if (!f) return;
  try {
    await fsp.mkdir(dataDir, { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(c));
    await fsp.rename(tmp, f);
  } catch (e) { log('romm: library not saved: ' + e.message); }
}

async function coverIndex() {
  const m = new Map();
  const d = coversDir();
  if (!d) return m;
  let names = [];
  try { names = await fsp.readdir(d); } catch { }
  for (const n of names) { const mm = /^(\d+)\.(png|jpe?g|webp|gif)$/i.exec(n); if (mm) m.set(mm[1], n); }
  return m;
}

async function out(c, extra = {}) {
  const covers = await coverIndex();
  const consoles = {};
  let count = 0;
  for (const g of Object.values(c.games || {})) {
    const f = covers.get(String(g.rommId));
    (consoles[g.consoleId] || (consoles[g.consoleId] = [])).push({ ...g, cover: f ? path.join(coversDir(), f) : null });
    count++;
  }
  for (const k of Object.keys(consoles)) consoles[k].sort((a, b) => a.title.localeCompare(b.title));
  return { consoles, skipped: c.skipped || { platforms: 0, games: 0, slugs: [] }, at: c.at, count, offline: false, ...extra };
}

async function cached() { if (!base) return { consoles: {}, skipped: { platforms: 0, games: 0, slugs: [] }, at: null, count: 0, error: 'no-server' }; return out(await loadCache()); }

async function library(opts = {}) {
  if (!base) return { consoles: {}, skipped: { platforms: 0, games: 0, slugs: [] }, at: null, count: 0, error: 'no-server' };
  const c = await loadCache();
  if (!token) return out(c, { error: 'no-token' });
  if (syncing) return syncing;
  syncing = sync(c, opts).finally(() => { syncing = null; });
  return syncing;
}

// Every page of a platform's ROMs (after `since` when given), one after another.
async function pages(p, since, signal, onPage) {
  for (let offset = 0, first = true; ; first = false) {
    const q = new URLSearchParams({
      platform_ids: String(p.id), limit: String(PAGE), offset: String(offset),
      with_char_index: 'false', with_filter_values: 'false', with_rom_id_index: 'false', with_total: first ? 'true' : 'false'
    });
    if (since) q.set('updated_after', since);
    const r = await call('/api/roms?' + q, { timeout: T.page, signal });
    if (r.status === 401 || r.status === 403) throw err('auth');
    if (!r.ok) throw err('http-' + r.status);
    const items = Array.isArray(r.json) ? r.json : (r.json && Array.isArray(r.json.items) ? r.json.items : []);
    onPage(items);
    offset += items.length;
    const total = r.json && typeof r.json.total === 'number' ? r.json.total : null;
    if (!items.length || items.length < PAGE || (total != null && offset >= total) || Array.isArray(r.json)) return;
    await sleep(PAGE_PAUSE);
  }
}

// All ROM ids of a platform in one light request (RomM's rom_id_index); null when the server doesn't give it.
async function idSweep(p, signal) {
  const q = new URLSearchParams({ platform_ids: String(p.id), limit: '1', offset: '0', with_char_index: 'false', with_filter_values: 'false', with_rom_id_index: 'true', with_total: 'false' });
  const r = await call('/api/roms?' + q, { timeout: T.page, signal });
  if (r.status === 401 || r.status === 403) throw err('auth');
  if (!r.ok || !r.json || !Array.isArray(r.json.rom_id_index)) return null;
  return new Set(r.json.rom_id_index.map(String));
}

async function sync(c, opts) {
  const so = signOuts, onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const signal = opts.signal;
  let plats;
  try {
    const r = await call('/api/platforms', { signal });
    if (r.status === 401 || r.status === 403) return out(c, { error: 'auth' });
    if (!r.ok || !Array.isArray(r.json)) return out(c, { offline: true, error: 'http-' + r.status });
    plats = r.json;
  } catch (e) {
    if (e.code === 'aborted') throw e;
    return out(c, { offline: true, error: e.code || 'offline' });
  }
  const games = { ...c.games };
  const platforms = {};
  const skipped = { platforms: 0, games: 0, slugs: [] };
  let fetched = 0, removed = 0;
  const mapped = [];
  for (const p of plats) {
    if (!p || p.id == null) continue;
    if (mapSlug(p)) { mapped.push(p); continue; }
    skipped.platforms++;
    skipped.games += num(p.rom_count) || 0;
    skipped.slugs.push(p.slug || p.fs_slug || String(p.id));
  }
  try {
    for (let i = 0; i < mapped.length; i++) {
      const p = mapped[i];
      const cid = mapSlug(p);
      const prev = c.platforms[p.id];
      const full = !prev || prev.consoleId !== cid || !prev.since;
      const mine = () => Object.keys(games).filter(k => games[k].platformId === p.id);
      onProgress({ phase: 'platform', platform: p.display_name || p.custom_name || p.name || p.slug, index: i, of: mapped.length, fetched });
      let since = full ? null : prev.since;
      const seen = full ? new Set() : null;
      const take = items => {
        for (const it of items) {
          if (!it || it.id == null) continue;
          if (seen) seen.add(String(it.id));
          if (it.missing_from_fs === true) { if (games[it.id]) { delete games[it.id]; removed++; } continue; }
          games[it.id] = toGame(it, p, cid);
          fetched++;
          if (it.updated_at && (!since || tsOf(it.updated_at) > tsOf(since))) since = it.updated_at;
        }
        onProgress({ phase: 'roms', platform: p.name || p.slug, index: i, of: mapped.length, fetched });
      };
      if (full && num(p.rom_count) === 0) {
        for (const k of mine()) { delete games[k]; removed++; }
      } else {
        await pages(p, full ? null : prev.since, signal, take);
        if (full) {
          for (const k of mine()) if (!seen.has(k)) { delete games[k]; removed++; }
        } else {
          await sleep(PAGE_PAUSE);
          const ids = await idSweep(p, signal);
          if (ids) {
            for (const k of mine()) if (!ids.has(k)) { delete games[k]; removed++; }
          } else if (num(p.rom_count) != null && num(p.rom_count) !== mine().length) {
            const all = new Set();
            await pages(p, null, signal, items => { for (const it of items) if (it && it.id != null) all.add(String(it.id)); take(items); });
            for (const k of mine()) if (!all.has(k)) { delete games[k]; removed++; }
          }
        }
      }
      platforms[p.id] = { id: p.id, slug: p.slug || null, fsSlug: p.fs_slug || null, name: p.display_name || p.custom_name || p.name || null, consoleId: cid, since, count: mine().length };
      if (i < mapped.length - 1) await sleep(PAGE_PAUSE);
    }
  } catch (e) {
    if (e.code === 'aborted') throw e;
    log('romm: sync stopped: ' + (e.code || e.message));
    return out(c, { offline: e.code === 'offline', error: e.code || 'error' });
  }
  for (const k of Object.keys(games)) if (!platforms[games[k].platformId]) { delete games[k]; removed++; }
  c.games = games;
  c.platforms = platforms;
  c.skipped = skipped;
  c.at = new Date().toISOString();
  if (so !== signOuts) { log('romm: signed out during the sync: nothing saved'); return out(c, { error: 'signed-out' }); }
  await saveCache(c);
  onProgress({ phase: 'done', fetched, removed });
  return out(c, { fetched, removed });
}

// ---------- covers
function imageExt(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  return null;
}

async function covers(games, opts = {}) {
  const max = num(opts.max) != null ? num(opts.max) : Infinity;
  const conc = Math.max(1, Math.min(6, num(opts.concurrency) || 3));
  const dir = coversDir();
  const paths = {};
  if (!dir) return { paths, downloaded: 0, failed: 0 };
  await fsp.mkdir(dir, { recursive: true });
  const have = await coverIndex();
  const todo = [];
  for (const g of games || []) {
    if (!g || g.rommId == null) continue;
    const f = have.get(String(g.rommId));
    if (f) paths[g.id] = path.join(dir, f);
    else if (g.coverUrl && !badCovers.has(g.coverUrl) && todo.length < max) todo.push(g);
  }
  let downloaded = 0, failed = 0, next = 0; const so = signOuts;
  const worker = async () => {
    while (next < todo.length) {
      if ((opts.signal && opts.signal.aborted) || so !== signOuts) return; // (signed out meanwhile: no covers written back)
      const g = todo[next++];
      try {
        const r = await call(g.coverUrl, { as: 'buffer', auth: false, timeout: T.cover, signal: opts.signal, maxBytes: COVER_MAX_BYTES });
        if (so !== signOuts) return;
        const ext = r.ok ? imageExt(r.buf) : null;
        if (!ext) { failed++; badCovers.add(g.coverUrl); continue; }
        const file = path.join(dir, `${g.rommId}.${ext}`);
        const tmp = `${file}.${process.pid}.tmp`;
        await fsp.writeFile(tmp, r.buf);
        await fsp.rename(tmp, file);
        paths[g.id] = file;
        downloaded++;
      } catch (e) {
        if (e.code === 'aborted') return;
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, todo.length) }, worker));
  return { paths, downloaded, failed };
}

// ---------- hashes
let CRC_T = null;
function crc32Table(buf, prev = 0) {
  if (!CRC_T) {
    CRC_T = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c; }
  }
  let c = ~prev;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
const crc32 = (buf, prev = 0) => (typeof zlib.crc32 === 'function' ? zlib.crc32(buf, prev) : crc32Table(buf, prev));

// The strongest hash RomM gave for a file: sha1, else md5, else crc32 (one pass, one hash).
const algoFor = want => (want && want.sha1 ? 'sha1' : want && want.md5 ? 'md5' : want && want.crc ? 'crc' : null);

function hasher(algo) {
  const st = { size: 0, crc: 0, h: algo === 'sha1' || algo === 'md5' ? crypto.createHash(algo) : null };
  const t = new Transform({
    transform(chunk, enc, cb) {
      st.size += chunk.length;
      if (algo === 'crc') st.crc = crc32(chunk, st.crc);
      else if (st.h) st.h.update(chunk);
      cb(null, chunk);
    }
  });
  t.result = () => ({ size: st.size, algo, value: algo === 'crc' ? st.crc.toString(16).padStart(8, '0') : st.h ? st.h.digest('hex') : null });
  return t;
}

function matches(want, got) {
  if (want.size != null && got.size !== want.size) return false;
  if (!got.algo) return true;
  const w = String(want[got.algo] || '').toLowerCase().trim();
  if (got.algo === 'crc') return (parseInt(w, 16) >>> 0) === (parseInt(got.value, 16) >>> 0);
  return w === got.value;
}

const sink = () => new Writable({ write(chunk, enc, cb) { cb(); } });

async function hashFile(file, algo, signal) {
  const h = hasher(algo);
  await pipeline(fs.createReadStream(file, { highWaterMark: 1 << 20 }), h, sink(), { signal });
  return h.result();
}

// ---------- zip (RomM sends a game made of several files as one zip)
async function readAt(fh, pos, len) {
  const b = Buffer.alloc(len);
  let got = 0;
  while (got < len) { const { bytesRead } = await fh.read(b, got, len - got, pos + got); if (!bytesRead) break; got += bytesRead; }
  if (got !== len) throw err('zip-bad', 'zip: short read');
  return b;
}

async function zipEntries(zipPath) {
  const fh = await fsp.open(zipPath, 'r');
  try {
    const size = (await fh.stat()).size;
    const tailLen = Math.min(size, 65557);
    const tail = await readAt(fh, size - tailLen, tailLen);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw err('zip-bad', 'zip: no directory');
    let count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
      const loc = e - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw err('zip-bad', 'zip64: no locator');
      const z64 = await readAt(fh, Number(tail.readBigUInt64LE(loc + 8)), 56);
      if (z64.readUInt32LE(0) !== 0x06064b50) throw err('zip-bad', 'zip64: no directory');
      count = Number(z64.readBigUInt64LE(32)); cdSize = Number(z64.readBigUInt64LE(40)); cdOff = Number(z64.readBigUInt64LE(48));
    }
    const cd = await readAt(fh, cdOff, cdSize);
    const list = [];
    for (let i = 0, p = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw err('zip-bad', 'zip: bad entry');
      const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16);
      let comp = cd.readUInt32LE(p + 20), unc = cd.readUInt32LE(p + 24);
      const nLen = cd.readUInt16LE(p + 28), xLen = cd.readUInt16LE(p + 30), cLen = cd.readUInt16LE(p + 32);
      let local = cd.readUInt32LE(p + 42);
      const name = cd.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nLen);
      for (let x = p + 46 + nLen, end = x + xLen; x + 4 <= end;) {
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          if (unc === 0xffffffff) { unc = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (comp === 0xffffffff) { comp = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (local === 0xffffffff) { local = Number(cd.readBigUInt64LE(q)); q += 8; }
        }
        x += 4 + len;
      }
      list.push({ name, method, crc, comp, unc, local, encrypted: !!(flags & 1) });
      p += 46 + nLen + xLen + cLen;
    }
    for (const en of list) {
      const lh = await readAt(fh, en.local, 30);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw err('zip-bad', 'zip: bad local header');
      en.data = en.local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    }
    return list;
  } finally { await fh.close(); }
}

// Unpacks into outDir (nothing outside it), hashing each file on the way. Returns [{name, file, size, algo, value}].
async function unzip(zipPath, outDir, wantFor, onProgress, signal) {
  const list = await zipEntries(zipPath);
  const root = path.resolve(outDir);
  const total = list.reduce((a, e) => a + e.unc, 0);
  let doneBytes = 0;
  const outFiles = [];
  for (const en of list) {
    if (signal && signal.aborted) throw Object.assign(err('aborted', 'cancelled'), { name: 'AbortError' });
    const rel = en.name.replace(/\\/g, '/');
    if (rel.endsWith('/')) continue;
    const parts = rel.split('/').filter(s => s && s !== '.');
    if (!parts.length || parts.some(s => s === '..') || /^[a-z]:/i.test(parts[0])) throw err('zip-bad', 'zip: unsafe path');
    const dest = path.resolve(root, ...parts.map(safeName));
    if (!dest.startsWith(root + path.sep)) throw err('zip-bad', 'zip: unsafe path');
    if (en.encrypted || (en.method !== 0 && en.method !== 8)) throw err('zip-unsupported', 'zip: method ' + en.method);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const want = wantFor(parts[parts.length - 1]);
    const h = hasher(algoFor(want) || 'crc');
    const src = en.comp > 0 ? fs.createReadStream(zipPath, { start: en.data, end: en.data + en.comp - 1, highWaterMark: 1 << 20 }) : null;
    const steps = [];
    if (src) steps.push(src); else steps.push(require('stream').Readable.from([]));
    if (en.method === 8 && src) steps.push(zlib.createInflateRaw());
    let lastTick = 0;
    steps.push(new Transform({ transform(chunk, enc, cb) { doneBytes += chunk.length; const n = Date.now(); if (n - lastTick > 200) { lastTick = n; onProgress({ phase: 'extract', received: doneBytes, total, fraction: total ? doneBytes / total : null }); } cb(null, chunk); } }));
    steps.push(h, fs.createWriteStream(dest));
    await pipeline(...steps, { signal });
    const res = h.result();
    if (res.size !== en.unc) throw err('zip-bad', 'zip: size differs');
    outFiles.push({ name: parts.join('/'), file: dest, ...res });
  }
  onProgress({ phase: 'extract', received: total, total, fraction: 1 });
  return outFiles;
}

// ---------- downloads
function safeName(n) {
  let s = path.basename(String(n || '').replace(/\\/g, '/')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  if (!s || s === '.' || s === '..') s = 'game';
  return s;
}

async function sizeOf(f) { try { return (await fsp.stat(f)).size; } catch { return -1; } }

// HEAD: the file's full size (when a resume asks for more than there is).
async function headSize(url, signal) {
  try {
    const r = await call(url, { method: 'HEAD', signal, timeout: T.api, headers: { 'Accept-Encoding': 'identity' } });
    return r.ok ? num(r.headers.get('content-length')) : null;
  } catch { return null; }
}

// Downloads url into `part`, carrying on from what's already there (Range). Resolves when the server's bytes are all in.
async function fetchToPart(url, part, expect, onProgress, signal) {
  let have = await sizeOf(part);
  if (have < 0) have = 0;
  if (expect && have > expect) { await fsp.rm(part, { force: true }); have = 0; }
  if (expect && have === expect) return { total: expect, resumed: true };
  if (!fetchImpl) fetchImpl = globalThis.fetch;
  const ctl = new AbortController();
  const unlink = linkSignal(ctl, signal);
  const timer = setTimeout(() => ctl.abort(err('offline', 'timed out')), T.connect);
  let idle = null;
  const headers = { Accept: '*/*', 'Accept-Encoding': 'identity' };
  if (token && sameServer(url)) headers.Authorization = 'Bearer ' + token;
  if (have > 0) headers.Range = `bytes=${have}-`;
  let res;
  try {
    res = await fetchImpl(url, { headers, signal: ctl.signal, redirect: 'follow', dispatcher: await getDispatcher() });
  } catch (e) { clearTimeout(timer); unlink(); throw netError(e, signal); }
  clearTimeout(timer);
  const drop = async () => { try { await res.body.cancel(); } catch { } };
  try {
    if (res.status === 416 && have > 0) {
      await drop();
      const full = await headSize(url, signal);
      if (full && full === have) return { total: full, resumed: true };
      await fsp.rm(part, { force: true });
      throw err('range', 'resume refused');
    }
    if (res.status === 401 || res.status === 403) { await drop(); throw err('auth'); }
    if (res.status === 404) { await drop(); throw err('not-found'); }
    if (!res.ok) { await drop(); throw err('http-' + res.status); }
    let append = false, total = null;
    if (res.status === 206 && have > 0) {
      const m = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(res.headers.get('content-range') || '');
      if (!m || +m[1] !== have) { await drop(); await fsp.rm(part, { force: true }); throw err('range', 'resume answered with other bytes'); }
      append = true;
      total = m[3] === '*' ? null : +m[3];
    } else {
      have = 0;
      total = num(res.headers.get('content-length')) || expect || null;
    }
    const out = fs.createWriteStream(part, { flags: append ? 'a' : 'w' });
    const outDone = new Promise((resolve, reject) => { out.on('close', resolve); out.on('error', reject); });
    let received = have, last = Date.now(), tick = 0;
    idle = setInterval(() => { if (Date.now() - last > T.idle) ctl.abort(err('offline', 'stalled')); }, Math.max(50, Math.min(1000, T.idle / 2)));
    const report = force => { const n = Date.now(); if (force || n - tick > 200) { tick = n; onProgress({ phase: 'download', received, total, fraction: total ? received / total : null }); } };
    report(true);
    try {
      for await (const chunk of res.body) {
        last = Date.now();
        received += chunk.length;
        if (!out.write(chunk)) await once(out, 'drain');
        report(false);
      }
    } catch (e) {
      out.end();
      try { await outDone; } catch { }
      throw netError(e && e.code ? e : (ctl.signal.reason && ctl.signal.reason.code ? ctl.signal.reason : e), signal);
    }
    out.end();
    await outDone;
    report(true);
    if (total && received !== total) throw err('offline', `short download (${received} of ${total})`);
    return { total: received, resumed: append };
  } finally { if (idle) clearInterval(idle); unlink(); }
}

function launchFile(files) {
  const order = ['m3u', 'cue', 'gdi', 'ccd', 'cdi', 'chd', 'iso', 'rvz', 'wbfs', 'wua', 'nsp', 'xci'];
  const ext = f => path.extname(f.file).slice(1).toLowerCase();
  for (const e of order) { const hit = files.find(f => ext(f) === e && !f.name.includes('/')); if (hit) return hit.file; }
  return files.slice().sort((a, b) => b.size - a.size)[0].file;
}

async function multiDone(game, outDir) {
  if (!game.files || !game.files.length) return null;
  const out = [];
  for (const f of game.files) {
    const p = path.join(outDir, safeName(f.name));
    const s = await sizeOf(p);
    if (s < 0 || (f.size != null && s !== f.size)) return null;
    out.push({ name: f.name, file: p, size: s });
  }
  return out;
}

async function freeSpaceOk(dir, need) {
  if (!need || typeof fsp.statfs !== 'function') return true;
  try { const s = await fsp.statfs(dir); return s.bavail * s.bsize > need + 64 * 1024 * 1024; } catch { return true; }
}

function download(game, destDir, opts = {}) {
  if (!game || game.rommId == null || !game.file) return Promise.reject(err('bad-game'));
  if (!base) return Promise.reject(err('no-server'));
  if (!token) return Promise.reject(err('no-token'));
  const key = String(game.rommId);
  if (active.has(key)) return active.get(key);
  const p = doDownload(game, destDir, opts).finally(() => active.delete(key));
  active.set(key, p);
  return p;
}

async function doDownload(game, destDir, opts) {
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const signal = opts.signal;
  await fsp.mkdir(destDir, { recursive: true });
  const name = safeName(game.file);
  const multi = !!game.multi;
  const final = path.join(destDir, multi ? name + '.zip' : name);
  const outDir = multi ? path.join(destDir, name) : null;
  if (!multi && game.size && await sizeOf(final) === game.size) return { file: final, files: [final], multi: false, already: true };
  // (beta.12) a different file of yours with that name is never replaced: RomM's copy is saved beside it as "Name (RomM).ext"
  const altFinal = !multi ? path.join(destDir, path.basename(name, path.extname(name)) + ' (RomM)' + path.extname(name)) : null;
  if (altFinal && game.size && await sizeOf(altFinal) === game.size) return { file: altFinal, files: [altFinal], multi: false, already: true };
  if (multi) { const done = await multiDone(game, outDir); if (done) return { file: launchFile(done), dir: outDir, files: done.map(f => f.file), multi: true, extracted: true, already: true }; }
  if (!(await freeSpaceOk(destDir, (game.size || 0) * (multi ? 2 : 1)))) throw err('no-space');
  const url = base + '/api/roms/' + encodeURIComponent(game.rommId) + '/content/' + encodeURIComponent(game.file);
  const part = final + '.part';
  const expect = multi ? null : game.size || null;
  let resumed = false;
  for (let attempt = 0; ; attempt++) {
    try { const r = await fetchToPart(url, part, expect, onProgress, signal); resumed = resumed || r.resumed; break; }
    catch (e) {
      if (signal && signal.aborted) throw Object.assign(err('aborted', 'cancelled'), { name: 'AbortError' });
      if (attempt >= 2 || (e.code !== 'offline' && e.code !== 'range')) throw e;
      log(`romm: download of ${game.rommId} interrupted (${e.message}); trying again`);
      await sleep(1000 * timeScale);
    }
  }
  if (!multi) {
    const want = game.files && game.files.length === 1 ? { ...game.files[0], size: game.files[0].size != null ? game.files[0].size : game.size } : { size: game.size };
    onProgress({ phase: 'verify', received: 0, total: null, fraction: null });
    const got = await hashFile(part, algoFor(want), signal);
    if (!matches(want, got)) {
      await fsp.rm(part, { force: true });
      throw err('hash-mismatch', `the download doesn't match RomM's ${got.algo || 'size'}`);
    }
    let dest = final;
    if (await sizeOf(final) >= 0) { dest = altFinal; log('romm: a different file named ' + path.basename(final) + ' is already there: saved as ' + path.basename(dest)); await fsp.rm(dest, { force: true }); }
    await fsp.rename(part, dest);
    return { file: dest, files: [dest], multi: false, verified: got.algo || 'size', resumed };
  }
  await fsp.rm(final, { force: true });
  await fsp.rename(part, final);
  const byName = new Map((game.files || []).map(f => [safeName(f.name).toLowerCase(), f]));
  const tmp = outDir + '.unpacking';
  await fsp.rm(tmp, { recursive: true, force: true });
  let got;
  try { got = await unzip(final, tmp, n => byName.get(safeName(n).toLowerCase()) || null, onProgress, signal); }
  catch (e) {
    await fsp.rm(tmp, { recursive: true, force: true });
    if (e.code === 'aborted' || (signal && signal.aborted)) throw Object.assign(err('aborted', 'cancelled'), { name: 'AbortError' });
    log('romm: zip kept, not unpacked: ' + e.message);
    return { file: final, zip: final, files: [final], multi: true, extracted: false, note: 'kept as a zip: it could not be unpacked (' + (e.code || e.message) + ')', resumed };
  }
  for (const f of got) {
    const want = byName.get(safeName(f.name).toLowerCase());
    if (want && !matches(want, f)) {
      await fsp.rm(tmp, { recursive: true, force: true });
      await fsp.rm(final, { force: true });
      throw err('hash-mismatch', `${f.name} doesn't match RomM's ${f.algo}`);
    }
  }
  const files = [];
  for (const f of got) {
    const dest = path.join(outDir, path.relative(tmp, f.file));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rm(dest, { force: true });
    await fsp.rename(f.file, dest);
    files.push({ ...f, file: dest });
  }
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.rm(final, { force: true });
  return { file: launchFile(files), dir: outDir, files: files.map(f => f.file), multi: true, extracted: true, verified: files.some(f => byName.has(safeName(f.name).toLowerCase())) ? 'files' : 'zip', resumed };
}

// ---------- sign out
// (beta.12) signOuts: a sync or cover download still running when you sign out mustn't write the library or covers back
let signOuts = 0;
async function forget() {
  signOuts++;
  token = null;
  pair = null;
  cache = null;
  badCovers.clear();
  const f = cacheFile(), d = coversDir();
  if (f) await fsp.rm(f, { force: true }).catch(() => {});
  if (d) await fsp.rm(d, { recursive: true, force: true }).catch(() => {});
  return { ok: true };
}

module.exports = {
  init, setServer, setToken, status, test, originOf,
  pairStart, pairPoll, pairWait, pairCancel, pairWithCode,
  library, cached, covers, download, forget,
  mapSlug, SLUGS,
  _crc32Table: crc32Table, _unzip: unzip,
  _setTimeScale: f => { timeScale = f; },
  _setTimeouts: o => { Object.assign(T, o); },
  _reset: () => { token = null; pair = null; cache = null; syncing = null; base = ''; origin = ''; deviceId = null; badCovers.clear(); active.clear(); }
};
