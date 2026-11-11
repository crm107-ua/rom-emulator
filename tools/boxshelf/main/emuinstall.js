'use strict';
// PC emulator installer: downloads official builds into {appRoot}\{folder}
// next to Boxshelf.exe so detect.js / systems.js find them.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

let log = () => {};
let appRoot = '';
let baseUrl = 'http://127.0.0.1:5000';
let fetchImpl = null;
const active = new Map();

function init(opts = {}) {
  if (typeof opts.log === 'function') log = opts.log;
  if (opts.appRoot) appRoot = opts.appRoot;
  if (opts.baseUrl) baseUrl = String(opts.baseUrl).replace(/\/+$/, '');
  fetchImpl = typeof opts.fetch === 'function' ? opts.fetch : (fetchImpl || globalThis.fetch);
  return { ok: true };
}

function setBaseUrl(url) {
  baseUrl = String(url || 'http://127.0.0.1:5000').trim().replace(/\/+$/, '') || 'http://127.0.0.1:5000';
}

async function api(pathname) {
  const r = await fetchImpl(baseUrl + pathname, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || ('http-' + r.status));
  return j;
}

async function list(system) {
  const q = system ? ('?system=' + encodeURIComponent(system)) : '';
  const d = await api('/api/emulators' + q);
  return d.emulators || [];
}

function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

function detectInstalled(emu) {
  const folder = path.join(appRoot, emu.folder);
  const found = [];
  for (const name of emu.exe_names || []) {
    const p = path.join(folder, name);
    if (isFile(p)) found.push(p);
  }
  // shallow search one level
  if (!found.length && isDir(folder)) {
    try {
      for (const ent of fs.readdirSync(folder, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        for (const name of emu.exe_names || []) {
          const p = path.join(folder, ent.name, name);
          if (isFile(p)) found.push(p);
        }
      }
    } catch {}
  }
  return { folder, installed: found.length > 0, exe: found[0] || null, exes: found };
}

async function statusAll(system) {
  const emus = await list(system);
  return emus.map(e => ({ ...e, ...detectInstalled(e) }));
}

async function resolveGithubAsset(repo, hint) {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const r = await fetchImpl(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Boxshelf-EmuInstall' },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error('github http ' + r.status);
  const j = await r.json();
  const assets = j.assets || [];
  const hintL = String(hint || '').toLowerCase();
  let asset = null;
  if (hintL) asset = assets.find(a => String(a.name || '').toLowerCase().includes(hintL.replace(/\.[^.]+$/, '')) || String(a.name || '').toLowerCase().includes(hintL));
  if (!asset) asset = assets.find(a => /\.(zip|7z)$/i.test(a.name || '') && /win|windows|x64|64/i.test(a.name || ''));
  if (!asset) asset = assets.find(a => /\.(zip|7z)$/i.test(a.name || ''));
  if (!asset) throw new Error('no suitable release asset');
  return { url: asset.browser_download_url, name: asset.name, tag: j.tag_name };
}

async function downloadFile(url, dest, onProgress) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': 'Boxshelf-EmuInstall', Accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(600000),
  });
  if (!res.ok) throw new Error('download http ' + res.status);
  const total = Number(res.headers.get('content-length')) || null;
  let done = 0;
  const reader = res.body.getReader();
  const file = fs.createWriteStream(dest);
  try {
    while (true) {
      const { done: eof, value } = await reader.read();
      if (eof) break;
      done += value.byteLength;
      if (!file.write(Buffer.from(value))) await new Promise(r => file.once('drain', r));
      if (onProgress) onProgress({ bytes_done: done, bytes_total: total });
    }
    await new Promise((resolve, reject) => file.end(err => err ? reject(err) : resolve()));
  } catch (e) {
    file.destroy();
    try { await fsp.unlink(dest); } catch {}
    throw e;
  }
  return dest;
}

async function extractArchive(archive, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  const lower = archive.toLowerCase();
  if (lower.endsWith('.zip')) {
    // PowerShell Expand-Archive
    await execFileAsync('powershell.exe', [
      '-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ], { windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
    return;
  }
  if (lower.endsWith('.7z') || lower.endsWith('.rar')) {
    const bin = await resolve7z();
    await execFileAsync(bin, ['x', '-y', `-o${destDir}`, archive], { windowsHide: true, maxBuffer: 40 * 1024 * 1024 });
    return;
  }
  throw new Error('unsupported archive type');
}

async function resolve7z() {
  const candidates = [
    path.join(appRoot || '', 'data', '7zr.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip', '7z.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', '7-Zip', '7z.exe'),
    '7z',
  ];
  for (const bin of candidates) {
    if (!bin) continue;
    if (bin !== '7z' && !isFile(bin)) continue;
    try {
      await execFileAsync(bin, ['--help'], { windowsHide: true });
      return bin;
    } catch {}
  }
  // Descarga 7zr.exe (extra oficial, ~1.5 MB) junto a Boxshelf para descomprimir RetroArch etc.
  const dest = path.join(appRoot || process.cwd(), 'data', '7zr.exe');
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  if (!isFile(dest)) {
    log('Downloading 7zr.exe for .7z extracts…');
    await downloadFile('https://www.7-zip.org/a/7zr.exe', dest, null);
  }
  if (!isFile(dest)) throw new Error('need 7-Zip to extract .7z');
  return dest;
}

function flattenSingleRoot(dir) {
  // If archive extracted to a single subfolder, move contents up when no exe at root.
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

async function install(emuId, opts = {}) {
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  if (active.has(emuId)) throw Object.assign(new Error('install already running'), { code: 'busy' });
  const ctl = { abort: false };
  active.set(emuId, ctl);
  try {
    const emus = await list();
    const emu = emus.find(e => e.id === emuId);
    if (!emu) throw new Error('unknown emulator');
    const destFolder = path.join(appRoot, emu.folder);
    await fsp.mkdir(destFolder, { recursive: true });

    onProgress({ phase: 'resolve', id: emuId, name: emu.name });
    let downloadUrl = emu.download_url || null;
    let archiveName = null;
    if (!downloadUrl && emu.github) {
      const asset = await resolveGithubAsset(emu.github, emu.asset_hint);
      downloadUrl = asset.url;
      archiveName = asset.name;
      onProgress({ phase: 'resolve', id: emuId, tag: asset.tag, asset: asset.name });
    }
    if (!downloadUrl) {
      return {
        ok: false,
        openPage: true,
        page_url: emu.page_url,
        error: 'no automatic download URL — open the official page',
      };
    }

    const tmpDir = path.join(appRoot, 'data', 'emu-downloads');
    await fsp.mkdir(tmpDir, { recursive: true });
    const archPath = path.join(tmpDir, archiveName || (emuId + path.extname(new URL(downloadUrl).pathname) || '.zip'));
    onProgress({ phase: 'download', id: emuId, name: emu.name });
    await downloadFile(downloadUrl, archPath, p => onProgress({ phase: 'download', id: emuId, ...p }));

    onProgress({ phase: 'extract', id: emuId, name: emu.name });
    await extractArchive(archPath, destFolder);
    flattenSingleRoot(destFolder);

    const det = detectInstalled(emu);
    onProgress({ phase: 'done', id: emuId, ...det });
    return { ok: det.installed, ...det, archive: archPath };
  } finally {
    active.delete(emuId);
  }
}

function cancel(emuId) {
  if (!active.has(emuId)) return false;
  active.delete(emuId);
  return true;
}

module.exports = { init, setBaseUrl, list, statusAll, detectInstalled, install, cancel };
