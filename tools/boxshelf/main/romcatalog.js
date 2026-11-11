'use strict';
// ROM Catalog client — talks to the local Flask API (scripts/rom_web) and saves
// games into Boxshelf's ROMS\{folder} layout. Pattern mirrors main/romm.js
// (progress events, resumable .part files) but without RomM auth.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pipeline } = require('stream/promises');
const { createWriteStream } = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { CONSOLES } = require('./systems');
const execFileAsync = promisify(execFile);

let log = () => {};
let appRoot = '';
let baseUrl = 'http://127.0.0.1:5000';
let fetchImpl = null;
const active = new Map();
// Arcade / Neo Geo / DOS must stay as archives; other shelves that list zip/7z can play them as-is.
const KEEP_ARCHIVE = new Set(['arcade', 'neogeo', 'dos']);

function init(opts = {}) {
  if (typeof opts.log === 'function') log = opts.log;
  if (opts.appRoot) appRoot = opts.appRoot;
  if (opts.baseUrl) baseUrl = String(opts.baseUrl).replace(/\/+$/, '');
  fetchImpl = typeof opts.fetch === 'function' ? opts.fetch : (fetchImpl || globalThis.fetch);
  return { ok: true };
}

function setBaseUrl(url) {
  baseUrl = String(url || 'http://127.0.0.1:5000').trim().replace(/\/+$/, '') || 'http://127.0.0.1:5000';
  return { ok: true, baseUrl };
}

function status() {
  return {
    baseUrl,
    appRoot,
    downloads: [...active.keys()],
  };
}

async function api(pathname, opts = {}) {
  if (!fetchImpl) throw Object.assign(new Error('no fetch'), { code: 'offline' });
  const url = baseUrl + pathname;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeout || 60000);
  try {
    const r = await fetchImpl(url, {
      method: opts.method || 'GET',
      headers: { Accept: 'application/json', ...(opts.headers || {}) },
      body: opts.body,
      signal: ctl.signal,
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!r.ok) {
      const msg = (json && (json.error || json.message)) || (`http-${r.status}`);
      throw Object.assign(new Error(msg), { code: 'http-' + r.status, status: r.status });
    }
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('timeout'), { code: 'offline' });
    if (e.code) throw e;
    throw Object.assign(new Error('API not reachable: ' + (e.message || e)), { code: 'offline' });
  } finally {
    clearTimeout(t);
  }
}

async function health() {
  const h = await api('/api/health', { timeout: 8000 });
  return { ok: !!h && h.ok !== false, ...h };
}

async function systems() {
  const d = await api('/api/catalog/systems');
  return d.systems || [];
}

async function listRoms(boxshelfId, letter = '', provider = 'coolrom.com') {
  const q = new URLSearchParams({
    boxshelf_id: String(boxshelfId || ''),
    provider,
    letter: letter || '',
  });
  const d = await api('/api/roms?' + q.toString(), { timeout: 90000 });
  return { roms: d.roms || [], total: d.total || 0, provider: d.provider, system: d.system };
}

async function search(query, provider = 'all') {
  const q = new URLSearchParams({ q: query });
  if (provider && provider !== 'all') q.set('provider', provider);
  const d = await api('/api/search?' + q.toString(), { timeout: 120000 });
  return { roms: d.roms || [], total: d.total || 0, query: d.query };
}

async function resolveUrl(rom) {
  const provider = rom.provider || 'coolrom.com';
  if (provider.includes('romsfun')) {
    const q = new URLSearchParams({ provider: 'romsfun.com', rom_url: rom.url || rom.rom_url || rom.page_url || '' });
    return api('/api/url?' + q.toString(), { timeout: 90000 });
  }
  const q = new URLSearchParams({
    provider: 'coolrom.com',
    system: rom.system || '',
    id: String(rom.id || ''),
    name: rom.url_name || rom.name || '',
  });
  return api('/api/url?' + q.toString(), { timeout: 90000 });
}

function proxyDownloadUrl(rom) {
  const provider = rom.provider || 'coolrom.com';
  if (provider.includes('romsfun')) {
    const q = new URLSearchParams({ provider: 'romsfun.com', rom_url: rom.url || rom.rom_url || rom.page_url || '' });
    return baseUrl + '/download?' + q.toString();
  }
  const q = new URLSearchParams({
    provider: 'coolrom.com',
    system: rom.system || '',
    id: String(rom.id || ''),
    name: rom.url_name || rom.name || '',
  });
  return baseUrl + '/download?' + q.toString();
}

function romDirFor(romFolder) {
  const folder = romFolder || 'ROMs';
  return path.join(appRoot || process.cwd(), 'ROMS', folder);
}

function safeName(name) {
  return String(name || 'rom').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'rom';
}

async function downloadRom(rom, opts = {}) {
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const folder = rom.rom_folder || opts.romFolder || (rom.boxshelf_id && String(rom.boxshelf_id).toUpperCase()) || 'ROMs';
  const destDir = opts.destDir || romDirFor(folder);
  await fsp.mkdir(destDir, { recursive: true });

  const key = String(rom.boxshelf_id || rom.system || 'rom') + ':' + String(rom.id || rom.url || rom.name);
  if (active.has(key)) throw Object.assign(new Error('download already running'), { code: 'busy' });

  const ctl = new AbortController();
  active.set(key, ctl);
  try {
    onProgress({ phase: 'resolve', key, name: rom.name });
    // Prefer Flask /download proxy (keeps CoolROM/RomsFun session cookies → evita CDN 403).
    // Fallback: CDN directa con User-Agent de navegador si el proxy falla.
    let filename = safeName(rom.name) + '.zip';
    let url = proxyDownloadUrl(rom);
    let info = null;
    try {
      info = await resolveUrl(rom);
      if (info && info.download_url) {
        try {
          const u = new URL(info.download_url);
          const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
          if (last && last.includes('.')) filename = safeName(last);
        } catch {}
      }
    } catch (e) {
      log('resolve soft-fail', e && e.message);
    }

    let finalPath = path.join(destDir, filename);
    if (fs.existsSync(finalPath) && !opts.force) {
      onProgress({ phase: 'prepare', key, name: rom.name, path: finalPath, skipped: true, message: 'Already on disk — preparing…' });
      const prepared = await prepareDownloaded(finalPath, rom, d => onProgress({ ...d, key, name: rom.name }));
      onProgress({ phase: 'prepared', key, path: prepared.path, skipped: true, extracted: !!prepared.extracted, cover: prepared.cover || null, name: rom.name });
      return { ok: true, path: prepared.path, skipped: true, extracted: !!prepared.extracted, cover: prepared.cover || null, rom_folder: folder };
    }

    onProgress({ phase: 'download', key, name: rom.name, path: finalPath });
    const browserUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    let res = await fetchImpl(url, {
      headers: { Accept: '*/*', 'User-Agent': browserUA },
      signal: ctl.signal,
      redirect: 'follow',
    });
    // Proxy o CDN 403 → reintentar con la otra vía
    if (!res.ok || res.status === 403) {
      const alt = (info && info.download_url && info.download_url !== url) ? info.download_url : null;
      const viaProxy = String(url).includes('/download?');
      const retryUrl = alt || (viaProxy ? null : proxyDownloadUrl(rom));
      if (retryUrl) {
        const referer = (rom.provider || '').includes('romsfun') ? 'https://romsfun.com/' : 'https://coolrom.com/';
        res = await fetchImpl(retryUrl, {
          headers: { Accept: '*/*', 'User-Agent': browserUA, Referer: referer },
          signal: ctl.signal,
          redirect: 'follow',
        });
        url = retryUrl;
      }
    }
    if (!res.ok) throw Object.assign(new Error('download http ' + res.status + (res.status === 403 ? ' (provider blocked — retry later or switch provider)' : '')), { code: 'http-' + res.status });
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(cd);
    if (m) {
      try { filename = safeName(decodeURIComponent(m[1].replace(/"/g, ''))); } catch { filename = safeName(m[1]); }
      finalPath = path.join(destDir, filename);
    }
    const partPath = finalPath + '.part';

    const total = Number(res.headers.get('content-length')) || null;
    let done = 0;
    const reader = res.body.getReader();
    const file = createWriteStream(partPath);
    try {
      while (true) {
        const { done: eof, value } = await reader.read();
        if (eof) break;
        done += value.byteLength;
        if (!file.write(Buffer.from(value))) {
          await new Promise(r => file.once('drain', r));
        }
        onProgress({ phase: 'download', key, name: rom.name, bytes_done: done, bytes_total: total, path: finalPath });
      }
      await new Promise((resolve, reject) => file.end(err => err ? reject(err) : resolve()));
    } catch (e) {
      file.destroy();
      try { await fsp.unlink(partPath); } catch {}
      throw e;
    }
    await fsp.rename(partPath, finalPath);
    // Rechazar descargas vacías/truncadas (p.ej. CDN 200 con cuerpo vacío → ISO 0 bytes sin carátula)
    try {
      const st = await fsp.stat(finalPath);
      if (!st.size || st.size < 2048) {
        try { await fsp.unlink(finalPath); } catch {}
        throw Object.assign(new Error('download empty or truncated — try again or switch provider'), { code: 'empty' });
      }
    } catch (e) {
      if (e && e.code === 'empty') throw e;
      throw e;
    }
    onProgress({ phase: 'prepare', key, name: rom.name, path: finalPath, bytes_done: done, bytes_total: total || done, message: 'Preparing…' });
    const prepared = await prepareDownloaded(finalPath, rom, d => onProgress({ ...d, key, name: rom.name }));
    onProgress({
      phase: 'prepared', key, name: rom.name, path: prepared.path, bytes_done: done, bytes_total: total || done,
      extracted: !!prepared.extracted, extractError: prepared.extractError || null, cover: prepared.cover || null,
      message: prepared.extracted ? 'Extracted' : (prepared.cover ? 'Cover found in archive' : 'Saved'),
    });
    return { ok: true, path: prepared.path, bytes: done, extracted: !!prepared.extracted, extractError: prepared.extractError || null, cover: prepared.cover || null, rom_folder: folder };
  } finally {
    active.delete(key);
  }
}

function playableExts(systemId) {
  const s = CONSOLES.find(c => c.id === systemId);
  return new Set((s && s.extensions) || []);
}

function shouldExtract(archivePath, systemId) {
  const ext = path.extname(archivePath).toLowerCase().replace(/^\./, '');
  if (!['zip', '7z', 'rar'].includes(ext)) return false;
  if (KEEP_ARCHIVE.has(String(systemId || ''))) return false;
  const allowed = playableExts(systemId);
  if (allowed.has(ext)) return false; // RetroArch / shelf can boot the archive directly
  return true;
}

async function extractArchive(archive, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  const lower = archive.toLowerCase();
  if (lower.endsWith('.zip')) {
    await execFileAsync('powershell.exe', [
      '-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ], { windowsHide: true, maxBuffer: 40 * 1024 * 1024 });
    return;
  }
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip', '7z.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', '7-Zip', '7z.exe'),
    '7z',
  ];
  if (lower.endsWith('.7z') || lower.endsWith('.rar')) {
    let ok = false;
    for (const bin of candidates) {
      try {
        await execFileAsync(bin, ['x', '-y', `-o${destDir}`, archive], { windowsHide: true, maxBuffer: 40 * 1024 * 1024 });
        ok = true;
        break;
      } catch {}
    }
    if (!ok) throw new Error('need 7-Zip to extract .' + path.extname(archive).slice(1));
    return;
  }
  throw new Error('unsupported archive type');
}

function flattenSingleRoot(dir) {
  try {
    const ents = fs.readdirSync(dir, { withFileTypes: true });
    if (ents.length !== 1 || !ents[0].isDirectory()) return;
    const sub = path.join(dir, ents[0].name);
    for (const name of fs.readdirSync(sub)) {
      const from = path.join(sub, name);
      const to = path.join(dir, name);
      if (!fs.existsSync(to)) fs.renameSync(from, to);
    }
    try { fs.rmdirSync(sub); } catch {}
  } catch {}
}

function pickPlayable(dir, systemId) {
  const allowed = playableExts(systemId);
  let best = null;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('.') || f.endsWith('.part')) continue;
      const full = path.join(dir, f);
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile()) continue;
      const ext = path.extname(f).toLowerCase().replace(/^\./, '');
      if (allowed.size && allowed.has(ext)) {
        if (ext === 'cue' || ext === 'gdi' || ext === 'm3u' || ext === 'chd') return full;
        if (!best) best = full;
      }
    }
  } catch {}
  return best;
}

async function applyEmbeddedCover(archivePath, onProgress) {
  if (!archivePath || !/\.zip$/i.test(archivePath) || !fs.existsSync(archivePath)) return null;
  const base = path.basename(archivePath).replace(/\.[^.]+$/i, '');
  const destDir = path.dirname(archivePath);
  for (const ext of ['png', 'jpg', 'jpeg']) {
    const existing = path.join(destDir, base + '.' + ext);
    if (fs.existsSync(existing)) return existing;
  }
  if (typeof onProgress === 'function') onProgress({ phase: 'cover', name: base, message: 'Reading cover from archive…' });
  const tmp = path.join(destDir, '.wk_cover_' + Date.now());
  try {
    await fsp.mkdir(tmp, { recursive: true });
    await extractArchive(archivePath, tmp);
    flattenSingleRoot(tmp);
    const prefer = ['cover.png', 'cover.jpg', 'cover.jpeg', 'folder.png', 'folder.jpg', 'box.png', 'front.png', 'cover 2.png'];
    let found = null;
    for (const n of prefer) {
      const p = path.join(tmp, n);
      if (fs.existsSync(p)) { found = p; break; }
    }
    if (!found) {
      for (const f of await fsp.readdir(tmp)) {
        if (/\.(png|jpe?g)$/i.test(f) && !/emblem|icon|manual|readme/i.test(f)) { found = path.join(tmp, f); break; }
      }
    }
    if (!found) return null;
    const dest = path.join(destDir, base + (path.extname(found).toLowerCase() || '.png'));
    await fsp.copyFile(found, dest);
    return dest;
  } catch (e) {
    log('embedded cover:', e && e.message);
    return null;
  } finally {
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch {}
  }
}

// Libretro Named_Boxarts — fallback when the archive has no cover (hacks, .bin dumps, etc.)
const LIBRETRO_PLAT = {
  nes: 'Nintendo - Nintendo Entertainment System',
  snes: 'Nintendo - Super Nintendo Entertainment System',
  n64: 'Nintendo - Nintendo 64',
  gb: 'Nintendo - Game Boy',
  gbc: 'Nintendo - Game Boy Color',
  gba: 'Nintendo - Game Boy Advance',
  nds: 'Nintendo - Nintendo DS',
  megadrive: 'Sega - Mega Drive - Genesis',
  mastersystem: 'Sega - Master System - Mark III',
  gamegear: 'Sega - Game Gear',
  psx: 'Sony - PlayStation',
  arcade: 'FBNeo - Arcade Games',
  neogeo: 'SNK - Neo Geo',
};

function coverTitleCandidates(romName, fileBase) {
  const raw = String(romName || fileBase || '').replace(/\.[^.]+$/, '').trim();
  const strip = s => String(s || '')
    .replace(/\s*[-–—]\s*v?\d[\w.]*$/i, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const base = strip(raw);
  const beforeColon = strip(raw.split(/[:–—]/)[0] || '');
  const aliases = [];
  // Common hack/ROM-pack titles → official box art names
  const low = base.toLowerCase();
  if (/sonic.*hedgehog\s*2|fly with tails/i.test(raw)) aliases.push('Sonic The Hedgehog 2');
  else if (/sonic.*hedgehog/i.test(raw)) aliases.push('Sonic The Hedgehog');
  if (/super mario world/i.test(raw) && /advance/i.test(raw)) aliases.push('Super Mario Advance 2 - Super Mario World');
  else if (/super mario world/i.test(raw)) aliases.push('Super Mario World');
  if (/super mario bros/i.test(raw)) aliases.push('Super Mario Bros.');
  if (/zelda\s*ii|adventure of (link|mario)/i.test(raw)) aliases.push('Zelda II - The Adventure of Link');
  const cores = [...new Set([base, beforeColon, ...aliases].filter(Boolean))];
  const regions = ['(USA)', '(USA, Europe)', '(USA, Australia)', '(Europe)', '(World)', '(Japan)'];
  const out = [];
  for (const c of cores) {
    for (const r of regions) out.push(`${c} ${r}`);
    out.push(c);
  }
  return [...new Set(out)];
}

async function fetchLibretroCover(systemId, romName, destPath, onProgress) {
  const plat = LIBRETRO_PLAT[String(systemId || '')];
  if (!plat || !fetchImpl) return null;
  const destDir = path.dirname(destPath);
  const base = path.basename(destPath).replace(/\.[^.]+$/i, '');
  const png = path.join(destDir, base + '.png');
  for (const ext of ['png', 'jpg', 'jpeg']) {
    const existing = path.join(destDir, base + '.' + ext);
    if (fs.existsSync(existing)) return existing;
  }
  if (typeof onProgress === 'function') onProgress({ phase: 'cover', name: base, message: 'Fetching cover art…' });
  const names = coverTitleCandidates(romName, base);
  for (const name of names) {
    const url = 'https://thumbnails.libretro.com/' + encodeURIComponent(plat) + '/Named_Boxarts/' + encodeURIComponent(name) + '.png';
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: 'image/*,*/*', 'User-Agent': 'Mozilla/5.0 Boxshelf-Wanikoko' },
        redirect: 'follow',
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 2000) continue;
      await fsp.writeFile(png, buf);
      return png;
    } catch (e) {
      log('libretro cover miss', name, e && e.message);
    }
  }
  return null;
}

// Covers for the shelf come from Boxshelf's own downloadCovers (LaunchBox/Libretro), never sibling
// dump/hack PNGs next to the ROM — those look "non-original" and can confuse matching.
async function prepareDownloaded(finalPath, rom, onProgress) {
  const sid = rom.boxshelf_id || rom.system || '';
  if (!shouldExtract(finalPath, sid)) return { path: finalPath, extracted: false, cover: null };
  if (typeof onProgress === 'function') onProgress({ phase: 'extract', path: finalPath, message: 'Extracting for emulator…' });
  const destDir = path.dirname(finalPath);
  const tmp = path.join(destDir, '.wk_extract_' + Date.now());
  await fsp.mkdir(tmp, { recursive: true });
  try {
    await extractArchive(finalPath, tmp);
    flattenSingleRoot(tmp);
    for (const name of await fsp.readdir(tmp)) {
      const from = path.join(tmp, name);
      const to = path.join(destDir, name);
      // Never promote dump/hack images next to the ROM; Boxshelf covers go in covers\
      if (/\.(png|jpe?g|webp)$/i.test(name)) { try { await fsp.unlink(from); } catch {} continue; }
      if (!fs.existsSync(to)) await fsp.rename(from, to);
    }
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch {}
    try { await fsp.unlink(finalPath); } catch {}
    const play = pickPlayable(destDir, sid) || destDir;
    return { path: play, extracted: true, cover: null };
  } catch (e) {
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch {}
    log('Wanikoko extract failed, keeping archive:', e && e.message);
    return { path: finalPath, extracted: false, extractError: String(e && e.message || e), cover: null };
  }
}

function cancel(key) {
  const ctl = active.get(key);
  if (!ctl) return false;
  ctl.abort();
  active.delete(key);
  return true;
}

function romKey(rom) {
  return String(rom.boxshelf_id || rom.system || 'rom') + ':' + String(rom.id || rom.url || rom.name || '');
}

function normalizeToken(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findOnDisk(rom) {
  const folder = rom.rom_folder || 'ROMs';
  const dir = romDirFor(folder);
  if (!fs.existsSync(dir)) return { onDisk: false, path: null, rom_folder: folder, dir };
  const needle = normalizeToken(rom.name || rom.url_name || '');
  let best = null;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.part')) continue;
      const base = normalizeToken(f.replace(/\.(zip|7z|rar|iso|chd|bin|cue|cdi|gdi|nkit\.iso)$/i, ''));
      if (!needle || !base) continue;
      if (base === needle || base.includes(needle) || needle.includes(base)) {
        best = path.join(dir, f);
        break;
      }
      if (!best && needle.length >= 6 && base.includes(needle.slice(0, 8))) best = path.join(dir, f);
    }
  } catch {}
  return { onDisk: !!best, path: best, rom_folder: folder, dir };
}

async function localStatus(roms) {
  const list = Array.isArray(roms) ? roms : [];
  return list.map(rom => {
    const disk = findOnDisk(rom || {});
    return { key: romKey(rom || {}), ...disk };
  });
}

function openFolder(romFolder) {
  const dir = romDirFor(romFolder || 'ROMs');
  fs.mkdirSync(dir, { recursive: true });
  return { ok: true, path: dir };
}

module.exports = {
  init, setBaseUrl, status, health, systems, listRoms, search, resolveUrl,
  downloadRom, cancel, romDirFor, localStatus, findOnDisk, romKey, openFolder,
  prepareDownloaded, shouldExtract, applyEmbeddedCover, fetchLibretroCover,
};
